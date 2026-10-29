/**
 * 动态封面统一解析
 *
 * 网易云走站内动态封面接口（mp4）；其余来源借用 Apple Music 的 editorialVideo
 * 动效封面（HLS），按标题与歌手匹配，命中后按曲目缓存
 */
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

/**
 * 解析曲目的动态封面
 * @param track - 当前曲目
 * @param storefront - Apple Music 商店地区
 * @returns 命中返回地址与格式，未命中返回 null
 */
export const resolveDynamicCover = async (
  track: Track,
  storefront: string,
): Promise<DynamicCoverResult | null> => {
  const key = `${track.source}:${track.id}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  if (track.source === "netease") {
    const url = await getDynamicCover(track.id);
    return remember(key, url ? { url, format: "mp4" } : null);
  }

  const artist = track.artists
    ?.map((item) => item.name)
    .filter(Boolean)
    .join(" ");
  const motion = await window.api.appleMusic.motion({
    title: track.title,
    artist: artist ?? "",
    songId: track.source === "appleMusic" ? track.id : undefined,
    storefront,
  });
  return remember(key, motion ? { url: motion.url, format: "hls" } : null);
};

/** 清空缓存（切换账号或强制刷新时使用） */
export const clearDynamicCoverCache = (): void => cache.clear();
