/**
 * 歌词分文字种类字体
 *
 * 西文、假名、谚文、汉字各自绑定到对应语种字体设置，与歌词行语言无关：
 * 汉字一律用中文字体（苹方），不因这一行是日语就换成日文字体
 */
import type { LyricSettings } from "@/types/settings";

const STYLE_ID = "splayer-lyric-script-faces";

/** 分文字种类字体族名；日语行单独一套，让汉字跟随日文字体 */
/** 仅覆盖字母与西文标点的字体族：数字留給中文字体，避免中英混排时字重跳变 */
export const LYRIC_LATIN_LETTERS_FAMILY = "SPlayerLyricLatin";

export const LYRIC_SCRIPT_FONT_FAMILY_ZH = "SPlayerLyricScriptZh";
/** 日语行的分文字种类字体族名，汉字走日文字体 */
export const LYRIC_SCRIPT_FONT_FAMILY_JA = "SPlayerLyricScriptJa";

/** 拉丁字母、数字与西文标点 */
const LATIN_RANGES = "U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-214F";
/** 平假名、片假名与半角片假名 */
const JAPANESE_RANGES = "U+3040-30FF,U+31F0-31FF,U+FF66-FF9F";
/** 谚文（字母、兼容字母与音节） */
const KOREAN_RANGES = "U+1100-11FF,U+3130-318F,U+AC00-D7AF";
/** 汉字与中文标点：简体、繁体、扩展 A、兼容区、全角符号 */
const CHINESE_RANGES = "U+3000-303F,U+3400-4DBF,U+4E00-9FFF,U+F900-FAFF,U+FF00-FF65";

/** 常见系统字体别名：local() 需要精确族名，链里写简称时用这些兜底 */
const SCRIPT_FALLBACK_FAMILIES: Record<string, string[]> = {
  latin: ["SF Pro", "Segoe UI", "Helvetica Neue", "Arial"],
  japanese: ["Hiragino Sans GB", "Hiragino Sans GB W6", "Hiragino Sans", "Yu Gothic UI", "Meiryo"],
  korean: ["Apple SD Gothic Neo", "Malgun Gothic"],
  chinese: [
    ".苹方-简",
    "PingFang SC",
    ".PingFang SC",
    "苹方-简",
    "Microsoft YaHei",
    "Noto Sans CJK SC",
  ],
};

/** 汉字区兜底族名：苹方在 Windows 上注册为带前导点的隐藏族名 */
const HAN_FALLBACK_FAMILIES = [
  ".PingFang SC",
  "PingFang SC",
  ".萍方-简",
  ".蘋方-簡",
  ".PingFang TC",
  "PingFang TC",
];

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
  /** 字母与西文标点（刻意排除 U+0030-0039 数字） */
  const LATIN_LETTER_RANGES =
    "U+0041-005A,U+0061-007A,U+00C0-00D6,U+00D8-00F6,U+00F8-00FF,U+0100-024F,U+0021-002F,U+003A-0040,U+005B-0060,U+007B-007E";

  const addRule = (family: string, fonts: string, ranges: string): void => {
    for (const name of parseFontChain(fonts)) {
      rules.push(
        `@font-face{font-family:"${family}";src:local("${escapeFontName(name)}");unicode-range:${ranges};}`,
      );
    }
  };

  // 每个码位区间只取字体链首个字体，避免第二个字体（如 SF Pro）抢走假名/谚文字形
  const first = (value: string): string => parseFontChain(value)[0] ?? "";
  const addWithFallback = (family: string, value: string, ranges: string, key: string): void => {
    addRule(family, first(value), ranges);
    for (const alias of SCRIPT_FALLBACK_FAMILIES[key]) {
      rules.push(
        `@font-face{font-family:"${family}";src:local("${escapeFontName(alias)}");unicode-range:${ranges};}`,
      );
    }
  };
  for (const family of [LYRIC_SCRIPT_FONT_FAMILY_ZH, LYRIC_SCRIPT_FONT_FAMILY_JA]) {
    addWithFallback(family, lyric.fontFamilyLatin, LATIN_RANGES, "latin");
    addWithFallback(family, lyric.fontFamilyJapanese, JAPANESE_RANGES, "japanese");
    addWithFallback(family, lyric.fontFamilyKorean, KOREAN_RANGES, "korean");
  }
  // 日语行的汉字用日文字体，其余行的汉字用中文字体（苹方）
  addWithFallback(LYRIC_SCRIPT_FONT_FAMILY_ZH, lyric.fontFamilyChinese, CHINESE_RANGES, "chinese");
  addWithFallback(
    LYRIC_SCRIPT_FONT_FAMILY_JA,
    lyric.fontFamilyJapanese,
    CHINESE_RANGES,
    "japanese",
  );
  // 苹方族名带前导点，用户无法在列表里选中，这里按族名兜底
  for (const family of [LYRIC_SCRIPT_FONT_FAMILY_ZH, LYRIC_SCRIPT_FONT_FAMILY_JA]) {
    for (const name of HAN_FALLBACK_FAMILIES) {
      rules.push(
        `@font-face{font-family:"${family}";src:local("${escapeFontName(name)}");unicode-range:${CHINESE_RANGES};}`,
      );
    }
  }

  const css = rules.join("\n");
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  } else if (styleEl.textContent === css) {
    // 内容没变就不要再写，重写会让浏览器作废已解析的本机字体，导致每次进播放页都重新解析
    return;
  }
  for (const family of [
    ...parseFontChain(lyric.fontFamilyLatin),
    ...SCRIPT_FALLBACK_FAMILIES.latin,
  ]) {
    rules.push(
      `@font-face{font-family:"${LYRIC_LATIN_LETTERS_FAMILY}";src:local("${escapeFontName(family)}");unicode-range:${LATIN_LETTER_RANGES};}`,
    );
  }
  styleEl.textContent = css;
};
