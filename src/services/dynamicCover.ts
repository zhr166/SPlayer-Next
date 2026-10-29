/**
 * 动态封面统一解析
 *
 * 网易云走站内动态封面接口（mp4）；其余来源借用 Apple Music 的 editorialVideo
 * 动效封面（HLS），按标题与歌手匹配，命中后按曲目缓存
 */
import * as neteaseSearch from "@/apis/search/netease";
import { getDynamicCover } from "@/apis/song/netease";
import type { Track } from "@shared/types/player";

export interface DynamicCoverResult {
  /** 视频地址 */
  url: string;
  /** 视频格式：mp4 可直接播放，hls 需要 MSE */
  format: "mp4" | "hls";
}

const CACHE_LIMIT = 60;
const cache = new Map<string, DynamicCoverResult | null>();

/**
 * 写入缓存并淘汰最旧条目
 * @param key - 曲目缓存键
 * @param value - 解析结果
 * @returns 原样返回解析结果
 */
const remember = (key: string, value: DynamicCoverResult | null): DynamicCoverResult | null => {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
  return value;
};

/** 归一化文本：去掉空格、标点与括号内容，便于比较曲名 */
const normalize = (text: string): string =>
  (text ?? "")
    .toLowerCase()
    .replace(/[(（\[【].*?[)）\]】]/g, "")
    .replace(
      /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}a-z0-9]/gu,
      "",
    );

/** 版本标记词：remix / live / cover 等，归一化会去掉括号，需要单独比较 */
const VARIANT_RE =
  /(remix|live|cover|instrumental|karaoke|acoustic|version|edit|mix|sped ?up|nightcore|tribute|piano)/i;

/**
 * 提取曲名里的版本标记
 * @param text - 曲名原文
 * @returns 标记词集合（小写）
 */
const variantsOf = (text: string): Set<string> =>
  new Set(
    (text.toLowerCase().match(new RegExp(VARIANT_RE.source, "gi")) ?? []).map((one) =>
      one.toLowerCase(),
    ),
  );

/**
 * 按曲名与歌手在网易云找同一首歌
 *
 * 网易云的动态封面只接受站内歌曲 ID，非网易云来源需要先匹配到对应曲目
 *
 * @param track - 当前曲目
 * @returns 命中返回网易云歌曲 ID，否则返回 null
 */
const findNeteaseSongId = async (track: Track): Promise<string | null> => {
  const artist = track.artists
    ?.map((item) => item.name)
    .filter(Boolean)
    .join(" ");
  const keyword = `${track.title} ${artist ?? ""}`.trim();
  if (!keyword) return null;
  try {
    const result = await neteaseSearch.songs(keyword, 0, 10);
    const title = normalize(track.title);
    const targetArtist = normalize(artist ?? "");
    const matched = result.items.find((item) => {
      const name = normalize(item.title);
      if (!name || name !== title) return false;
      // 版本标记必须一致，否则会拿到 remix / live 等其他封面的动态封面
      const itemVariants = variantsOf(item.title);
      for (const variant of variantsOf(track.title)) {
        if (!itemVariants.has(variant)) return false;
      }
      const names = normalize(item.artists?.map((one) => one.name).join(" "));
      if (
        targetArtist &&
        !(names === targetArtist || names.includes(targetArtist) || targetArtist.includes(names))
      )
        return false;
      const albumName = normalize(item.album?.name ?? "");
      const targetAlbum = normalize(track.album?.name ?? "");
      if (
        albumName &&
        targetAlbum &&
        !(
          albumName === targetAlbum ||
          albumName.includes(targetAlbum) ||
          targetAlbum.includes(albumName)
        )
      )
        return false;
      return true;
    });
    return matched?.id ?? null;
  } catch {
    return null;
  }
};

/**
 * 解析曲目的动态封面
 * @param track - 当前曲目
 * @param storefront - Apple Music 商店地区
 * @param allowNetease - 是否允许查询网易云站内动态封面
 * @returns 命中返回地址与格式，未命中返回 null
 */
export const resolveDynamicCover = async (
  track: Track,
  storefront: string,
  allowNetease: boolean,
): Promise<DynamicCoverResult | null> => {
  const key = `${track.source}:${track.id}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  // 网易云站内动态封面优先；非网易云来源先按歌名匹配到网易云曲目再取
  if (allowNetease) {
    const neteaseId = track.source === "netease" ? track.id : await findNeteaseSongId(track);
    if (neteaseId) {
      const url = await getDynamicCover(neteaseId);
      if (url) return remember(key, { url, format: "mp4" });
    }
  }

  const artist = track.artists
    ?.map((item) => item.name)
    .filter(Boolean)
    .join(" ");
  const motion = await window.api.appleMusic.motion({
    title: track.title,
    artist: artist ?? "",
    album: track.album?.name,
    songId: track.source === "appleMusic" ? track.id : undefined,
    storefront,
  });
  return remember(key, motion ? { url: motion.url, format: "hls" } : null);
};

/** 清空缓存（切换账号或强制刷新时使用） */
export const clearDynamicCoverCache = (): void => cache.clear();
