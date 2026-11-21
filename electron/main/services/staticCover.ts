/**
 * 静态封面搜索与手动指定
 *
 * 网易云走 cloudsearch 的专辑图，Apple Music 走 iTunes Search 的 artworkUrl
 */

import { net } from "electron";
import { callNetease } from "@main/apis/netease";
import { setStaticCoverManual } from "@main/database/staticCoverManual";
import type {
  StaticCoverManualRecord,
  StaticCoverSearchCandidate,
  Track,
} from "@shared/types/player";

/** 把封面地址里的尺寸段替换为目标尺寸 */
const sizedCover = (url: string | undefined, size: number): string => {
  if (!url) return "";
  return url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
};

/**
 * 搜索网易云静态封面候选
 * @param keyword - 搜索关键词
 * @returns 候选列表
 */
export const searchNcmStaticCovers = async (
  keyword: string,
): Promise<StaticCoverSearchCandidate[]> => {
  const term = keyword.trim();
  if (!term) return [];
  const { body } = await callNetease("cloudsearch", { keywords: term, type: 1, limit: 20 });
  const songs =
    (
      body as {
        result?: {
          songs?: {
            id: number;
            name: string;
            ar?: { name: string }[];
            al?: { name?: string; picUrl?: string };
          }[];
        };
      }
    )?.result?.songs ?? [];
  return songs
    .filter((song) => song.al?.picUrl)
    .map((song) => ({
      id: String(song.id),
      source: "ncm" as const,
      title: song.name,
      artist: (song.ar ?? []).map((artist) => artist.name).join(" / "),
      album: song.al?.name,
      cover: `${song.al!.picUrl}?param=300y300`,
      coverLarge: `${song.al!.picUrl}?param=1200y1200`,
    }));
};

/**
 * 搜索 Apple Music 静态封面候选
 * @param keyword - 搜索关键词
 * @param storefront - 商店地区
 * @returns 候选列表
 */
export const searchAmStaticCovers = async (
  keyword: string,
  storefront: string,
): Promise<StaticCoverSearchCandidate[]> => {
  const term = keyword.trim();
  if (!term) return [];
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", term);
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "20");
  url.searchParams.set("country", storefront);
  const resp = await net.fetch(url.toString());
  if (!resp.ok) throw new Error(`iTunes search ${resp.status}`);
  const data = (await resp.json()) as {
    results?: {
      trackId?: number;
      trackName?: string;
      artistName?: string;
      collectionName?: string;
      artworkUrl100?: string;
    }[];
  };
  return (data.results ?? [])
    .filter((song) => song.artworkUrl100)
    .map((song) => ({
      id: String(song.trackId ?? song.artworkUrl100),
      source: "am" as const,
      title: song.trackName ?? "",
      artist: song.artistName ?? "",
      album: song.collectionName,
      cover: sizedCover(song.artworkUrl100, 300),
      coverLarge: sizedCover(song.artworkUrl100, 1200),
    }));
};

/**
 * 应用手动静态封面，记录原始封面用于恢复原版
 * @param track - 目标曲目
 * @param candidate - 封面候选
 * @returns 已保存的手动记录
 */
export const applyStaticCover = (
  track: Track,
  candidate: StaticCoverSearchCandidate,
): StaticCoverManualRecord => {
  const record: StaticCoverManualRecord = {
    source: candidate.source,
    url: candidate.coverLarge,
    thumbUrl: candidate.cover,
    originalCover: track.cover,
    originalCoverOriginal: track.coverOriginal,
    updatedAt: Date.now(),
  };
  setStaticCoverManual(track, record);
  return record;
};
