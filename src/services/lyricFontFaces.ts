/**
 * 歌词混排字体
 *
 * 设置里的字体是按语种分开的（拉丁 / 中文 / 日文 / 韩文），但一行歌词里经常
 * 中英混排。这里用 unicode-range 的 @font-face 把可区分的文字（拉丁、假名、
 * 谚文）分别绑定到对应字体；汉字无法从码位区分语种，继续跟随行级 :lang() 的
 * 字体设置。
 */
import type { LyricSettings } from "@/types/settings";

const STYLE_ID = "splayer-lyric-font-faces";

/** 混排字体族名，CSS 里排在行级语言字体之前 */
export const LYRIC_MIXED_FONT_FAMILY = "SPlayerLyricMixed";

/** 拉丁字母与数字（不含通用标点，避免把中文引号也交给西文字体） */
const LATIN_RANGES = "U+0000-024F,U+1E00-1EFF";
/** 平假名 / 片假名 / 半角片假名 */
const JAPANESE_RANGES = "U+3040-30FF,U+31F0-31FF,U+FF66-FF9F";
/** 谚文（含字母与音节） */
const KOREAN_RANGES = "U+1100-11FF,U+3130-318F,U+AC00-D7AF";

/**
 * 转义 CSS 字体名里的引号与反斜杠
 * @param name - 字体名
 * @returns 可直接放进 local() 的字符串
 */
const escapeFontName = (name: string): string => name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * 按当前歌词字体设置生成混排 @font-face 规则
 * @param lyric - 歌词字体设置
 */
export const applyLyricFontFaces = (lyric: LyricSettings): void => {
  if (typeof document === "undefined") return;

  const rules: string[] = [];
  const addRule = (font: string, ranges: string): void => {
    const name = font?.trim();
    if (!name) return;
    rules.push(
      `@font-face{font-family:"${LYRIC_MIXED_FONT_FAMILY}";src:local("${escapeFontName(name)}");unicode-range:${ranges};}`,
    );
  };

  addRule(lyric.fontFamilyLatin, LATIN_RANGES);
  addRule(lyric.fontFamilyJapanese, JAPANESE_RANGES);
  addRule(lyric.fontFamilyKorean, KOREAN_RANGES);

  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = rules.join("\n");
};
