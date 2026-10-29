/** 苹方仅有 Regular/Medium/Semibold，700 以上会触发浏览器合成粗体，统一收敛到 600 */
const MAX_REAL_CJK_WEIGHT = 600;

/**
 * 把设置里的字重收敛到本机字体真实提供的档位
 * @param weight - 设置中的字重值
 * @returns 可用于 font-weight 的真实档位
 */
export const normalizeLyricFontWeight = (weight: number): number =>
  Math.min(weight, MAX_REAL_CJK_WEIGHT);
