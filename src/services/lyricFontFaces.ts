/**
 * 歌词分文字种类字体
 *
 * 西文、假名、谚文、汉字各自绑定到对应语种字体设置，与歌词行语言无关：
 * 汉字一律用中文字体（苹方），不因这一行是日语就换成日文字体
 */
import type { LyricSettings } from "@/types/settings";

const STYLE_ID = "splayer-lyric-script-faces";

/** 分文字种类字体族名，排在所有歌词行字体列表最前 */
export const LYRIC_SCRIPT_FONT_FAMILY = "SPlayerLyricScript";

/** 拉丁字母、数字与西文标点 */
const LATIN_RANGES = "U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F";
/** 平假名、片假名与半角片假名 */
const JAPANESE_RANGES = "U+3040-30FF,U+31F0-31FF,U+FF66-FF9F";
/** 谚文（字母、兼容字母与音节） */
const KOREAN_RANGES = "U+1100-11FF,U+3130-318F,U+AC00-D7AF";
/** 汉字与中文标点：简体、繁体、扩展 A、兼容区、全角符号 */
const CHINESE_RANGES = "U+3000-303F,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+FF00-FF65";

/**
 * 解析字体链字符串为字体名数组
 * @param value - 形如 `"PingFang SC", "SF Pro"` 的字体链
 * @returns 去引号、去空白后的字体名数组
 */
const parseFontChain = (value: string): string[] =>
  (value ?? "")
    .split(",")
    .map((name) => name.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

/**
 * 转义 CSS 字体名里的引号与反斜杠
 * @param name - 字体名
 * @returns 可直接放进 local() 的字符串
 */
const escapeFontName = (name: string): string => name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * 按当前字体设置生成分文字种类的 @font-face 规则
 * @param lyric - 歌词字体设置
 */
export const applyLyricFontFaces = (lyric: LyricSettings): void => {
  if (typeof document === "undefined") return;

  const rules: string[] = [];
  // 字体链里每个字体各生成一条规则，浏览器按顺序取第一个能解析的
  const addRule = (fonts: string, ranges: string): void => {
    for (const name of parseFontChain(fonts)) {
      rules.push(
        `@font-face{font-family:"${LYRIC_SCRIPT_FONT_FAMILY}";src:local("${escapeFontName(name)}");unicode-range:${ranges};}`,
      );
    }
  };

  addRule(lyric.fontFamilyLatin, LATIN_RANGES);
  addRule(lyric.fontFamilyJapanese, JAPANESE_RANGES);
  addRule(lyric.fontFamilyKorean, KOREAN_RANGES);
  addRule(lyric.fontFamilyChinese, CHINESE_RANGES);

  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = rules.join("\n");
};
