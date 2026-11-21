/**
 * 手动指定的静态封面
 *
 * 表：static_cover_manual(track_key, source, payload, updated_at)
 */

import type { StaticCoverManualRecord, Track } from "@shared/types/player";
import { getDb } from "./index";
import { manualTrackKey } from "./motionCoverManual";

/**
 * 读取曲目手动指定的静态封面
 * @param track - 曲目
 * @returns 手动记录，未指定时为 null
 */
export const getStaticCoverManual = (track: Track): StaticCoverManualRecord | null => {
  const row = getDb()
    .prepare("SELECT source, payload FROM static_cover_manual WHERE track_key = ?")
    .get(manualTrackKey(track)) as { source: string; payload: string } | undefined;
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as Omit<StaticCoverManualRecord, "source">;
    return { ...payload, source: row.source as StaticCoverManualRecord["source"] };
  } catch {
    return null;
  }
};

/**
 * 保存手动指定的静态封面
 * @param track - 曲目
 * @param record - 手动记录
 */
export const setStaticCoverManual = (track: Track, record: StaticCoverManualRecord): void => {
  const { source, ...payload } = record;
  getDb()
    .prepare(
      `INSERT INTO static_cover_manual (track_key, source, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(track_key) DO UPDATE SET
         source = excluded.source,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    )
    .run(manualTrackKey(track), source, JSON.stringify(payload), record.updatedAt);
};

/**
 * 清除手动指定的静态封面
 * @param track - 曲目
 */
export const clearStaticCoverManual = (track: Track): void => {
  getDb().prepare("DELETE FROM static_cover_manual WHERE track_key = ?").run(manualTrackKey(track));
};
