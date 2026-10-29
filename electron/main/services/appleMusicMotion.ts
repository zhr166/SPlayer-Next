/**
 * Apple Music 动态封面（editorialVideo motion artwork）
 *
 * 直接从 AMP API 取专辑的动效封面 HLS 地址，供非网易云来源的曲目借用，
 * 查询顺序为给定地区 → us → jp → cn，命中后按曲目元信息缓存
 */
import { coreLog } from "@main/utils/logger";
import type { AppleMusicMotionParams, AppleMusicMotionResult } from "@shared/types/appleMusic";
import { getDeveloperToken } from "./appleMusicLyrics";

const AMP_API = "https://amp-api.music.apple.com/v1";
const TIMEOUT_MS = 15_000;
const CACHE_LIMIT = 100;
/** 地区回退顺序：AM 各区曲库差异较大，中文曲常只在 cn 有动效封面 */
const FALLBACK_STOREFRONTS = ["us", "jp", "cn"];

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
 * 在指定地区查询曲目所属专辑的动效封面
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
  const songsPath = params.songId
    ? `/catalog/${storefront}/songs/${params.songId}?include=albums&extend=editorialVideo`
    : null;
  if (songsPath) {
    const data = await requestAmp(songsPath, token);
    const album = data?.data?.[0]?.relationships?.albums?.data?.[0];
    const url = readMotionUrl(album);
    if (url) return url;
  }

  const term = `${params.title} ${params.artist}`.trim();
  if (!term) return null;
  const search = await requestAmp(
    `/catalog/${storefront}/search?term=${encodeURIComponent(term)}&types=songs&limit=5`,
    token,
  );
  const songs: any[] = search?.results?.songs?.data ?? [];
  for (const song of songs) {
    const albumId = song?.relationships?.albums?.data?.[0]?.id ?? song?.attributes?.albumId;
    if (!albumId) continue;
    const album = await requestAmp(
      `/catalog/${storefront}/albums/${albumId}?extend=editorialVideo`,
      token,
    );
    const url = readMotionUrl(album?.data?.[0]);
    if (url) return url;
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
    const storefronts = [params.storefront, ...FALLBACK_STOREFRONTS].filter(
      (value, index, list) => Boolean(value) && list.indexOf(value) === index,
    );
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
