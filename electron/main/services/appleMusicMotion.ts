/**
 * Apple Music 动态封面（editorialVideo motion artwork）
 *
 * 直接从 AMP API 取专辑的动效封面 HLS 地址，供非网易云来源的曲目借用，
 * 查询顺序为给定地区 → us → jp → cn，命中后按曲目元信息缓存
 */
import { coreLog } from "@main/utils/logger";
import type { AppleMusicMotionParams, AppleMusicMotionResult } from "@shared/types/appleMusic";
import { convertText } from "@main/services/opencc";
import { getDeveloperToken } from "./appleMusicLyrics";

const AMP_API = "https://amp-api.music.apple.com/v1";
const TIMEOUT_MS = 15_000;
const CACHE_LIMIT = 100;
/** 假名：日文曲目的判定依据 */
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}\u30FC\uFF66-\uFF9F]/u;
/** 谚文：韩文曲目的判定依据 */
const HANGUL_RE = /[\p{Script=Hangul}]/u;
/** 汉字：中文曲目的判定依据 */
const HAN_RE = /\p{Script=Han}/u;
/** 日文新字体（中文不使用）：出现即可判定为日文汉字曲目 */
const JA_SHINJITAI_RE = /[楽図広気売駅円芸転伝沢浜桜鉄県検険厳塩縁剤斎徳]/u;

/** 日文曲目优先日本区，其次韩国区（两地日文曲库与动效封面覆盖更全） */
const KANA_STOREFRONTS = ["jp", "kr", "tw", "hk", "us"];
/** 中文曲目优先港台区，中文发行在港台区收录更全 */
const HAN_STOREFRONTS = ["cn", "tw", "hk", "sg", "us", "jp"];
/** 西文曲目优先美加区：日区会把英文曲名本土化成片假名，反而不易命中 */
const LATIN_STOREFRONTS = ["us", "ca", "jp", "tw", "hk"];

/**
 * 按曲目文字种类决定地区回退顺序
 * @param title - 曲目名
 * @param artist - 歌手名
 * @returns 地区回退顺序
 */
const resolveStorefrontOrder = (title: string, artist: string): string[] => {
  const text = `${title}${artist}`;
  if (KANA_RE.test(text)) return KANA_STOREFRONTS;
  if (HANGUL_RE.test(text)) return KANA_STOREFRONTS;
  // 纯汉字标题也可能来自日文，命中日文新字体时优先日本区
  if (JA_SHINJITAI_RE.test(text)) return KANA_STOREFRONTS;
  if (HAN_RE.test(text)) return HAN_STOREFRONTS;
  return LATIN_STOREFRONTS;
};

const cache = new Map<string, AppleMusicMotionResult | null>();

/**
 * 写入缓存并淘汰最旧条目
 * @param key - 曲目缓存键
 * @param value - 查询结果
 * @returns 原样返回查询结果
 */
const remember = (
  key: string,
  value: AppleMusicMotionResult | null,
): AppleMusicMotionResult | null => {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
  return value;
};

/**
 * 请求 AMP API 并解析 JSON
 * @param path - 相对 v1 的路径
 * @param token - 开发者令牌
 * @returns 解析后的响应体
 */
const requestAmp = async (path: string, token: string): Promise<any> => {
  const response = await fetch(`${AMP_API}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      Origin: "https://music.apple.com",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`AMP ${response.status}`);
  return response.json();
};

/**
 * 从专辑属性里取方图动效封面地址
 * @param album - 专辑资源
 * @returns HLS 地址，缺失时返回 null
 */
const readMotionUrl = (album: any): string | null => {
  const video = album?.attributes?.editorialVideo;
  return video?.motionDetailSquare?.video ?? video?.motionSquareVideo1x1?.video ?? null;
};

/**
 * 在候选专辑里挑选与曲目专辑名最接近的一个
 * @param albums - 带动效封面的候选专辑
 * @param albumName - 曲目所属专辑名
 * @returns 命中的专辑，缺失时返回第一个候选
 */
const pickAlbum = (albums: any[], albumName?: string): any => {
  const target = (albumName ?? "").trim().toLowerCase();
  if (!target) return albums[0];
  const exact = albums.find(
    (album) => (album?.attributes?.name ?? "").trim().toLowerCase() === target,
  );
  if (exact) return exact;
  const partial = albums.find((album) => {
    const name = (album?.attributes?.name ?? "").toLowerCase();
    return name.includes(target) || target.includes(name);
  });
  return partial ?? albums[0];
};

/**
 * 按地区生成候选检索词
 *
 * 港台区曲库多用繁体标题、大陆区为简体，直接用元数据原文常常匹配不到，
 * 因此在原文未命中时补一次简繁转换后的检索
 *
 * @param term - 原始检索词
 * @param storefront - 商店地区
 * @returns 依次尝试的检索词
 */
const searchTerms = (term: string, storefront: string): string[] => {
  const mode =
    storefront === "tw"
      ? "s2tw"
      : storefront === "hk"
        ? "s2hk"
        : storefront === "cn" || storefront === "sg"
          ? "t2s"
          : null;
  if (!mode) return [term];
  const converted = convertText(term, mode);
  return converted && converted !== term ? [term, converted] : [term];
};

/**
 * 在指定地区查询曲目所属专辑的动效封面
 *
 * 搜索接口不返回 relationships，因此已知歌曲 ID 时直接查歌曲的专辑关系，
 * 其他情况按专辑类型搜索，再按专辑名在候选里挑选。
 *
 * @param storefront - 商店地区
 * @param params - 曲目元信息
 * @param token - 开发者令牌
 * @returns HLS 地址，未命中返回 null
 */
const lookupInStorefront = async (
  storefront: string,
  params: AppleMusicMotionParams,
  token: string,
): Promise<string | null> => {
  if (params.songId) {
    const data = await requestAmp(
      `/catalog/${storefront}/songs/${params.songId}?include=albums&extend=editorialVideo`,
      token,
    );
    const url = readMotionUrl(data?.data?.[0]?.relationships?.albums?.data?.[0]);
    if (url) return url;
  }

  const term = `${params.title} ${params.artist}`.trim();
  if (!term) return null;
  for (const searchTerm of searchTerms(term, storefront)) {
    const search = await requestAmp(
      `/catalog/${storefront}/search?term=${encodeURIComponent(searchTerm)}&types=albums&limit=10&extend=editorialVideo`,
      token,
    );
    const albums: any[] = (search?.results?.albums?.data ?? []).filter((album) =>
      readMotionUrl(album),
    );
    if (albums.length > 0) return readMotionUrl(pickAlbum(albums, params.album));
  }
  return null;
};

/**
 * 查询曲目的动态封面
 * @param params - 曲目元信息与商店地区
 * @returns 命中返回 HLS 地址，未命中返回 null
 */
export const getAppleMusicMotionCover = async (
  params: AppleMusicMotionParams,
): Promise<AppleMusicMotionResult | null> => {
  const key = `${params.storefront}|${params.songId ?? ""}|${params.title}|${params.artist}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  try {
    const token = await getDeveloperToken();
    const storefronts = [
      params.storefront,
      ...resolveStorefrontOrder(params.title, params.artist),
    ].filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
    for (const storefront of storefronts) {
      const url = await lookupInStorefront(storefront, params, token);
      if (url) {
        coreLog.info(`[am-motion] hit ${storefront} ${params.title} → ${url.slice(0, 80)}`);
        return remember(key, { url });
      }
    }
    coreLog.info(`[am-motion] miss ${params.title} - ${params.artist}`);
    return remember(key, null);
  } catch (error) {
    coreLog.warn(`[am-motion] failed ${params.title}: ${(error as Error).message}`);
    return remember(key, null);
  }
};
