/**
 * lyric-kit 兼容层
 *
 * 上游 fork 通过补丁给 lyric-kit 增加了若干解析工具，本 fork 不使用该补丁，
 * 因此在 shared 层提供同名实现，供主进程歌词接口复用。
 */
import type { LyricFormat, LyricLine, LyricWord } from "./../types/lyrics";

/** 行头时间戳：[mm:ss.xxx] 或 [mm:ss:xxx] */
const LINE_HEADER_RE = /^\[(\d+):(\d+)[.:](\d{1,3})\]/;

/** 行内逐字：<offset,dur>字 */
const WORD_RE = /<(\d+),(\d+)>([^<]*)/g;

/**
 * 按内容猜测歌词格式
 * @param text - 歌词原文
 * @returns 猜测出的格式
 */
export const detectFormat = (text: string): LyricFormat => {
  const head = text.slice(0, 4096);
  if (/<tt\b/i.test(head) || /xmlns="http:\/\/www\.w3\.org\/ns\/ttml"/i.test(head)) return "ttml";
  if (/^\[Lyrics Next\]/im.test(head)) return "lrcn";
  if (/^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->/m.test(head)) return "srt";
  if (/^\[Script Info\]/m.test(head) || /^Dialogue:/m.test(head)) return "ass";
  if (/\[\d+,\d+\]\((\d+),(\d+),\d+\)/.test(head)) return "yrc";
  if (/\[\d+,\d+\][^\n]*\(\d+,\d+\)/.test(head)) return "qrc";
  if (/\[\d+:\d+[.:]\d{1,3}\][^<\n]*<\d+,\d+>/.test(head)) return "krc";
  if (/\[\d+:\d+[.:]\d{1,3}\]/.test(head)) return "lrc";
  if (/^\[[a-zA-Z]+:[^\]]*\]/m.test(head)) return "lrc";
  return "lrc";
};

/**
 * 把毫秒格式化为 LRC 时间戳
 * @param ms - 毫秒时间
 * @returns 形如 `[mm:ss.xxx]` 的时间戳
 */
export const formatLrcTime = (ms: number): string => {
  const safe = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}]`;
};

/**
 * 解析 KRC 逐字歌词
 *
 * 行头为 `[mm:ss.xxx]`，行内为 `<相对行首偏移,时长>字`，偏移需累加到行首时间
 *
 * @param text - KRC 原文（已解密）
 * @param detectBackground - 是否识别背景行
 * @returns 歌词行数组
 */
export const parseKRC = (text: string, detectBackground = true): LyricLine[] => {
  const lines: LyricLine[] = [];
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const header = LINE_HEADER_RE.exec(trimmed);
    if (!header) continue;
    const lineStart =
      Number(header[1]) * 60000 + Number(header[2]) * 1000 + Number(header[3].padEnd(3, "0"));
    const body = trimmed.slice(header[0].length);
    const words: LyricWord[] = [];
    let wordCount = 0;
    WORD_RE.lastIndex = 0;
    let match = WORD_RE.exec(body);
    while (match) {
      const offset = Number(match[1]);
      const duration = Number(match[2]);
      const word = match[3].trim();
      if (word) {
        words.push({
          word,
          startTime: lineStart + offset,
          endTime: lineStart + offset + duration,
        });
        wordCount++;
      }
      match = WORD_RE.exec(body);
    }
    if (words.length === 0) continue;
    lines.push({
      language: "und-Hani",
      words,
      startTime: words[0].startTime,
      endTime: words[words.length - 1].endTime,
      isBG: detectBackground ? /^\s*[((]/.test(words[0].word) : false,
    } as LyricLine);
  }
  return lines;
};

/**
 * 把歌词行转换为 LRC 文本
 * @param lines - 歌词行
 * @returns LRC 文本
 */
export const toLRC = (lines: readonly LyricLine[]): string =>
  lines
    .map((line) => {
      const text = line.words.map((word) => word.word).join("");
      return `${formatLrcTime(line.startTime)}${text}`;
    })
    .join("\n");
