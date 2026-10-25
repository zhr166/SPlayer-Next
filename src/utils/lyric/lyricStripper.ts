/**
 * 元数据行清理器
 *
 * 用于清理歌词中开头和结尾的元数据行，例如：
 *
 * (歌曲名) - (歌手名)
 * 词：...
 * 曲：...
 * 编曲：...
 * 制作人：...
 * 真正的歌词行 1
 * 真正的歌词行 2
 */

import type { LyricLine } from "@shared/types/lyrics";

import type { Track } from "@shared/types/player";
import { useSettingsStore } from "@/stores/settings";
import { stripLyricMetadata } from "lyric-kit";

/**
 * 清理歌词元数据行
 * @param lines 解析后的歌词行
 * @param track 当前歌曲（用于检测「歌曲 - 歌手」首行）
 * @returns 过滤元数据后的歌词行数组
 */
export const applyLyricExclude = (lines: LyricLine[], track: Track | null): LyricLine[] => {
  if (lines.length === 0) return lines;

  const settings = useSettingsStore().lyric;
  if (!settings.enableExcludeLyrics) return lines;

  const artistNames = track?.artists?.map((a) => a.name).filter(Boolean) ?? [];

  // 本地歌词类型比 lyric-kit 多几种语言，运行时结构一致
  return stripLyricMetadata(lines as unknown as Parameters<typeof stripLyricMetadata>[0], {
    useDefaultRules: true,
    keywords: settings.excludeLyricsUserKeywords,
    regexPatterns: settings.excludeLyricsUserRegexes,
    matchMetadata: {
      title: track?.title || undefined,
      artists: artistNames,
    },
  });
};
