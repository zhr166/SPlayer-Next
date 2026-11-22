/**
 * 静态封面搜索与手动指定
 *
 * 网易云走 cloudsearch 的专辑图，Apple Music 走 iTunes Search 的 artworkUrl
 */

import { net } from "electron";
import { callNetease } from "@main/apis/netease";
import { searchAmSongs } from "@main/services/motionCover";
import {
  clearStaticCoverManual,
  getStaticCoverManual,
  setStaticCoverManual,
} from "@main/database/staticCoverManual";
import { getDb } from "@main/database/index";
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
  // 仅国内商店改走 AMP，其它区维持 iTunes Search
  if (storefront === "cn" || storefront === "kr") {
    try {
      const songs = await searchAmSongs(term, storefront);
      if (songs.length > 0) {
        return songs.map((song) => ({
          id: song.id,
          source: "am" as const,
          title: song.title,
          artist: song.artist,
          album: song.album,
          cover: song.cover ?? "",
          coverLarge: song.cover?.replace(/\/\d+x\d+bb\./, "/1200x1200bb.") ?? song.cover ?? "",
        }));
      }
    } catch {
      // AMP 不可用时回退 iTunes Search
    }
  }
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
  // 重复应用时保留第一次记录的原始封面，避免把上一次的手动图当成原版
  const existing = getStaticCoverManual(track);
  const record: StaticCoverManualRecord = {
    source: candidate.source,
    url: candidate.coverLarge,
    thumbUrl: candidate.cover,
    originalCover: existing?.originalCover ?? track.cover,
    originalCoverOriginal: existing?.originalCoverOriginal ?? track.coverOriginal,
    updatedAt: Date.now(),
  };
  setStaticCoverManual(track, record);
  return record;
};

/**
 * 恢复静态封面，并修正播放历史里被写成手动图的记录
 * @param track - 目标曲目
 * @returns 可信的原始封面，未指定手动封面时为 null
 */
export const restoreStaticCover = (
  track: Track,
): { cover?: string; coverOriginal?: string } | null => {
  const record = getStaticCoverManual(track);
  if (!record) return null;
  const manualUrls = new Set([record.thumbUrl, record.url].filter(Boolean));
  let trusted: { cover?: string; coverOriginal?: string } | null = null;

  if (record.originalCover && !manualUrls.has(record.originalCover)) {
    trusted = {
      cover: record.originalCover,
      coverOriginal:
        record.originalCoverOriginal && !manualUrls.has(record.originalCoverOriginal)
          ? record.originalCoverOriginal
          : record.originalCover,
    };
  }

  // 记录的原始封面也可能被旧版本写成了手动图，从播放历史里找真正的原图
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, track_json FROM play_history WHERE track_id = ? AND source = ? ORDER BY id DESC LIMIT 50",
    )
    .all(track.id, track.source) as { id: number; track_json: string | null }[];
  const parsed = rows.flatMap((row) => {
    if (!row.track_json) return [];
    try {
      return [{ id: row.id, track: JSON.parse(row.track_json) as Track }];
    } catch {
      return [];
    }
  });
  if (!trusted) {
    const found = parsed.find((row) => row.track.cover && !manualUrls.has(row.track.cover));
    if (found) {
      trusted = {
        cover: found.track.cover,
        coverOriginal: found.track.coverOriginal ?? found.track.cover,
      };
    }
  }

  const fallback = trusted;
  // 把历史里被手动图覆盖的记录改回真实原图
  const update = db.prepare("UPDATE play_history SET track_json = ? WHERE id = ?");
  if (!fallback) {
    clearStaticCoverManual(track);
    return null;
  }
  for (const row of parsed) {
    const cover = row.track.cover;
    if (!cover || !manualUrls.has(cover)) continue;
    update.run(JSON.stringify({ ...row.track, ...fallback }), row.id);
  }

  clearStaticCoverManual(track);
  return fallback;
};
