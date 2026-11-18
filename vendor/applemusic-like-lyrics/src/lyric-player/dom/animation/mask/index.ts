import { CalcMaskAnimator } from "./animator-calc";
import { WebMaskAnimator } from "./animator-web";
import type { LineMaskAnimator, MaskContext, MaskTargetWord } from "./types";

export * from "./types";

export function createLineMaskAnimator(
	words: ReadonlyArray<MaskTargetWord>,
	context: MaskContext,
): LineMaskAnimator {
	if (context.supportMaskImage) {
		return new WebMaskAnimator(words, context);
	} else {
		return new CalcMaskAnimator(words, context);
	}
}
