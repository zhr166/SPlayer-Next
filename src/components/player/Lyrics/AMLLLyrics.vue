<script setup lang="ts">
import { LayoutAlignAnchor, LayoutReason } from "@applemusic-like-lyrics/core";
import {
  LYRIC_SCRIPT_FONT_FAMILY_JA,
  LYRIC_SCRIPT_FONT_FAMILY_ZH,
} from "@/services/lyricFontFaces";
import type { LyricLine } from "@shared/types/lyrics";
import { detectTextLanguage } from "@/utils/lyric/language";
import type { LargerLyricText, LyricFloatAnimationIntensity } from "@/types/settings";
import { SPlayerLyricPlayer as CoreLyricPlayer } from "./amll-player";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { getCurrentTime } from "@/services/playback";
import { getOverlapAlignPosition } from "@/utils/lyric/overlapAlign";
import {
  canPromoteLinePronunciation,
  collapseToLineLyric,
  hasWordRomanization,
  promotePronunciation,
  resolveAmlLineRomanization,
  shouldForceAmlLinePronunciationMode,
} from "./romanization";
import "@applemusic-like-lyrics/core/style.css";
import "./renderer.css";

/**
 * SPlayer 与 AMLL 补丁之间的私有行协议，不属于上游公开 API。
 * Core 会克隆并优化行数据，升级时必须确认字段仍能到达 LyricLineEl。
 * 消费位置、未迁移字段和验证步骤见根目录 amll-hooks.md。
 */
type AmlLyricLine = LyricLine & {
  /** 旧版关闭逐字高亮 hook；当前 0.5.2 补丁未迁移其消费者。 */
  __amllDisableWordHighlight?: true;
  /** 旧版关闭强调 hook；当前 0.5.2 补丁未迁移其消费者。 */
  __amllDisableEmphasize?: true;
  /** 旧版排除 CJK 强调 hook；当前 0.5.2 补丁未迁移其消费者。 */
  __amllDisableCjkEmphasis?: true;
  /** 旧版上浮强度 hook；当前 0.5.2 补丁未迁移其消费者。 */
  __amllFloatAnimationIntensity?: LyricFloatAnimationIntensity;
  /** 发音提升为主文字时开启双层遮罩；Core.createWord 与遮罩生成器共同消费。 */
  __amllIndependentMainWordMask?: true;
  /** 正文为主文字时开启双层遮罩；两层分别测量宽高并复用 Core 行级时间轴。 */
  __amllIndependentRomanWordMask?: true;
};

const props = withDefaults(
  defineProps<{
    /** 歌词行数据数组 */
    lyricLines: LyricLine[];
    /** 是否正在播放（默认 true） */
    playing?: boolean;
    /** 激活行在容器中的对齐位置 [0 ~ 1] */
    alignPosition?: number;
    /** 逐字掩码渐变宽度比例 */
    wordFadeWidth?: number;
    /** 是否隐藏已播放行 */
    hidePassedLines?: boolean;
    /** 是否启用逐行模糊效果 */
    enableBlur?: boolean;
    /** 是否启用逐字高亮 */
    enableWordHighlight?: boolean;
    /** 逐字上浮动画强度 */
    floatAnimationIntensity?: LyricFloatAnimationIntensity;
    /** 是否启用强调效果 */
    enableEmphasizeEffect?: boolean;
    /** 是否禁用 CJK 歌词的强调效果 */
    disableCjkEmphasis?: boolean;
    /** 多行同亮时是否临时抬高歌词对齐位置 */
    raiseAlignPositionOnOverlap?: boolean;
    /** 是否临时将弹簧参数降至设置范围下限 */
    minimizeSpringParams?: boolean;
    /** 是否显示翻译歌词 */
    showTranslation?: boolean;
    /** 是否显示逐行音译 */
    showLineRomanization?: boolean;
    /** 是否显示逐词音译 */
    showWordRomanization?: boolean;
    forceSyllableSpacing?: boolean;
    /** 是否将发音显示在翻译上方 */
    swapTranslationPronunciation?: boolean;
    /** 歌词与发音同时显示时的大字体内容 */
    largerLyricText?: LargerLyricText;
    /** 是否强制将逐字歌词的逐行发音提升为逐句主歌词 */
    forceLinePronunciationAsMain?: boolean;
    /** 是否独立计算逐词发音遮罩进度 */
    independentWordRomanizationProgress?: boolean;
    /** 挂载时的初始播放时间（毫秒） */
    initialTime?: number;
  }>(),
  {
    playing: false,
    alignPosition: 0.35,
    wordFadeWidth: 0.5,
    hidePassedLines: false,
    enableBlur: false,
    enableWordHighlight: true,
    floatAnimationIntensity: "medium",
    enableEmphasizeEffect: true,
    disableCjkEmphasis: false,
    raiseAlignPositionOnOverlap: false,
    minimizeSpringParams: false,
    showTranslation: true,
    showLineRomanization: true,
    showWordRomanization: true,
    forceSyllableSpacing: false,
    swapTranslationPronunciation: false,
    largerLyricText: "lyrics",
    forceLinePronunciationAsMain: false,
    independentWordRomanizationProgress: false,
    initialTime: 0,
  },
);

interface Emits {
  /** 点击歌词行进行播放进度跳转 */
  (e: "seek", timeMs: number): void;
}

const emit = defineEmits<Emits>();

const settings = useSettingsStore();
const status = useStatusStore();

const wrapperRef = ref<HTMLDivElement | null>(null);
/**
 * 歌词容器字体栈
 *
 * 0.6 的歌词行使用 CSS Modules 哈希类名，无法再用类名或 :lang 选择器挂字体，
 * 这里在容器上给一条完整字体栈：脚本字体族负责按码位分流西文/假名/谚文/汉字，
 * 后面的语种字体链作为缺字回退。
 */
const lyricFontStack = computed(() => {
  const lyric = settings.lyric;
  const chain = (value: string): string[] =>
    (value ?? "")
      .split(",")
      .map((name) => name.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
      .map((name) => `"${name}"`);
  return [
    `"${LYRIC_SCRIPT_FONT_FAMILY_ZH}"`,
    `"${LYRIC_SCRIPT_FONT_FAMILY_JA}"`,
    ...chain(lyric.fontFamilyLatin),
    ...chain(lyric.fontFamilyJapanese),
    ...chain(lyric.fontFamilyChinese),
    ...chain(lyric.fontFamilyKorean),
    ...chain(lyric.fontFamily),
  ].join(", ");
});

/** 容器尺寸监听，尺寸变化后需要重排歌词 */
let resizeObserver: ResizeObserver | undefined;
// Core 实例必须保留原始身份：挂载时用它判定异步等待后实例是否已被卸载或替换。
const playerRef = shallowRef<CoreLyricPlayer>();
const bottomLineEl = ref<HTMLElement>();
const clockInitialized = ref(false);
// 播放器是否已初始化完成
const initialized = ref(false);
const contentVisible = ref(false);
// 父组件的冻结标志
const isFrozen = ref(false);
// 冻结期间缓存的待应用歌词
let pendingLyrics: LyricLine[] | null = null;
let lastAlignPosition: number | undefined;
let lastAlignAnchor: LayoutAlignAnchor | undefined;
// 页面隐藏状态的响应式跟踪
const isPageHidden = ref(false);
// 之前隐藏的标记，用于检测从隐藏恢复的时刻
const isPreviousHidden = ref(false);

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

/**
 * 将重叠高亮状态接入 AMLL 的对齐配置与布局刷新。
 * 0.5.2 的两个 setter 仅写入 layoutState，切换时必须显式调用 calcLayout。
 * 缓存最终对齐点，避免每次播放进度推送都触发布局；升级时复核 setter 的刷新语义。
 */
const syncAlignPosition = (): void => {
  const player = playerRef.value;
  if (!player) return;
  if (props.raiseAlignPositionOnOverlap) player.advanceOverlapAnchor();
  const activeMainLineCount = props.raiseAlignPositionOnOverlap
    ? player.getBufferedMainLineCount()
    : 0;
  const overlap = props.raiseAlignPositionOnOverlap ? player.getBufferedMainLineMetrics() : null;
  const alignPosition =
    props.raiseAlignPositionOnOverlap && activeMainLineCount > 1 && overlap
      ? getOverlapAlignPosition(
          props.alignPosition,
          wrapperRef.value?.clientHeight ?? 0,
          overlap.firstHeight,
          overlap.secondHeight,
          overlap.gap,
          overlap.overlapDuration,
        )
      : props.alignPosition;
  const alignAnchor = props.alignPosition > 0.4 ? LayoutAlignAnchor.Center : LayoutAlignAnchor.Top;
  if (lastAlignPosition === alignPosition && lastAlignAnchor === alignAnchor) return;
  lastAlignPosition = alignPosition;
  lastAlignAnchor = alignAnchor;
  player.setAlignPosition(alignPosition);
  player.setAlignAnchor(alignAnchor);
  player.calcLayout(LayoutReason.ConfigChange);
};

/** 同步时间后更新重叠段布局，确保新对齐点立即生效。 */
const syncCurrentTime = (time: number, isSeek?: boolean): void => {
  playerRef.value?.setCurrentTime(time, isSeek);
  syncAlignPosition();
  // 跳转后 0.6 可能重建行元素，内联字体会随之丢失，这里补挂一次
  if (isSeek) processLyricLanguage();
};

// 处理多语言显隐及音译偏好的本地高效清洗
const processedLyrics = computed(() => {
  if (!props.lyricLines) return [];
  const forceLineMode =
    props.largerLyricText === "pronunciation" &&
    props.showLineRomanization &&
    shouldForceAmlLinePronunciationMode(props.lyricLines, props.forceLinePronunciationAsMain);
  const result = props.lyricLines.map((line) => {
    const wordPronunciationVisible = props.showWordRomanization && hasWordRomanization(line);
    const linePronunciationVisible =
      props.showLineRomanization && !hasWordRomanization(line) && !!line.romanLyric.trim();
    const linePronunciationCanBePromoted =
      linePronunciationVisible && canPromoteLinePronunciation(line, false);
    const displayLine =
      forceLineMode && canPromoteLinePronunciation(line, true)
        ? promotePronunciation(line, "line")
        : forceLineMode
          ? collapseToLineLyric(line)
          : props.largerLyricText === "pronunciation" && wordPronunciationVisible
            ? promotePronunciation(line, "word", props.forceSyllableSpacing)
            : props.largerLyricText === "pronunciation" && linePronunciationCanBePromoted
              ? promotePronunciation(line, "line")
              : line;
    const translation = props.showTranslation ? displayLine.translatedLyric : "";
    const pronunciation = resolveAmlLineRomanization(displayLine, props.showLineRomanization);
    const newLine: AmlLyricLine = {
      ...displayLine,
      translatedLyric: props.swapTranslationPronunciation ? pronunciation : translation,
      romanLyric: props.swapTranslationPronunciation ? translation : pronunciation,
    };
    if (!props.enableWordHighlight) {
      newLine.__amllDisableWordHighlight = true;
    }
    if (!props.enableEmphasizeEffect) {
      newLine.__amllDisableEmphasize = true;
    }
    if (props.disableCjkEmphasis) {
      newLine.__amllDisableCjkEmphasis = true;
    }
    newLine.__amllFloatAnimationIntensity = props.floatAnimationIntensity;
    // 标记描述发音所在层；任一标记都会拆开两层，否则祖先遮罩仍会裁掉子层高亮。
    if (props.independentWordRomanizationProgress && wordPronunciationVisible) {
      if (props.largerLyricText === "pronunciation") {
        newLine.__amllIndependentMainWordMask = true;
      } else {
        newLine.__amllIndependentRomanWordMask = true;
      }
    }
    if (displayLine.words) {
      newLine.words = displayLine.words.map((word) => {
        const newWord = { ...word };
        if (!props.showWordRomanization) {
          delete newWord.romanWord;
        }
        return newWord;
      });
    }
    return newLine;
  });
  return result;
});

// 行点击事件回调
const handleLineClick = (e: Event) => {
  const amllEvent = e as Event & { line?: { getLine: () => { startTime?: number } } };
  const lineData = amllEvent.line?.getLine();
  if (lineData && typeof lineData.startTime === "number") {
    emit("seek", lineData.startTime);
    syncCurrentTime(lineData.startTime, true);
  }
};

// 为所有主歌词行设置 html lang 属性
/** 只含西文字形的字体，不能出现在语种字体链里，否则会抢走假名/汉字 */
const LATIN_ONLY_FAMILIES = new Set([
  "sf pro",
  "sf pro display",
  "sf pro text",
  "segoe ui",
  "helvetica",
  "helvetica neue",
  "arial",
  "roboto",
]);

/** 把逗号分隔的字体链拆成干净家族名数组 */
const parseChain = (chain: string): string[] =>
  (chain ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

/** 语种字体缺字时的兜底族名（按本机实际注册名） */
const SCRIPT_ALIASES: Record<string, string[]> = {
  ja: ["Hiragino Sans GB", "Hiragino Sans GB W6", "Hiragino Sans", "Yu Gothic UI"],
  ko: ["Apple SD Gothic Neo", "Malgun Gothic"],
  zh: [".苹方-简", "PingFang SC", ".PingFang SC", "苹方-简", "Microsoft YaHei"],
};

/**
 * 按行语言组合行级字体栈
 *
 * 西文字体放最前，字母命中它；假名/谚文/汉字在它里面没有字形，会回退到后面的语种字体，
 * 因此同一行内中英混排也能各用各的。语种链里会剔除纯西文字体并追加本机兜底族名。
 * @param language - 该行语言标记
 * @returns 可直接写入 fontFamily 的字体栈
 */
const lineFontStack = (language?: string): string => {
  const tag = (language ?? "").toLowerCase();
  const lyric = settings.lyric;
  const scriptKey = tag.startsWith("ja")
    ? "ja"
    : tag.startsWith("ko")
      ? "ko"
      : tag.startsWith("zh") || tag === "yue"
        ? "zh"
        : "";
  const latin = parseChain(lyric.fontFamilyLatin)[0] ?? "";
  const scriptChain = scriptKey
    ? parseChain(
        scriptKey === "ja"
          ? lyric.fontFamilyJapanese
          : scriptKey === "ko"
            ? lyric.fontFamilyKorean
            : lyric.fontFamilyChinese,
      )
    : [];
  const families = [
    ...(latin ? [latin] : []),
    ...scriptChain.filter((name) => !LATIN_ONLY_FAMILIES.has(name.toLowerCase())),
    ...(scriptKey ? SCRIPT_ALIASES[scriptKey] : []),
  ];
  // 去重并加引号，带前导点的隐藏族名（如 .苹方-简）必须加引号
  return Array.from(new Set(families))
    .map((name) => `"${name}"`)
    .join(", ");
};

const processLyricLanguage = (player = playerRef.value) => {
  const lyricGroups = player?.currentLyricGroups;
  if (!Array.isArray(lyricGroups) || lyricGroups.length === 0) return;

  for (const group of lyricGroups) {
    for (const [lineIndex, line] of [group.mainLine, group.bgLine].entries()) {
      const lyricLine = line?.getLine();
      const lyricLineElement = line?.getElement();
      if (!lyricLine || !lyricLineElement) continue;

      lyricLineElement.classList.toggle("amll-line-lyric", !!(lyricLine as LyricLine).isLineLyric);

      const lyricMainLineElement = lyricLineElement.firstChild;
      if (lyricMainLineElement instanceof HTMLElement) {
        // 副行（翻译/音译）按自身文本判断语言，避免沿用主行语言导致中文翻译用日文字体
        const lineText = (lyricLine as LyricLine).words.map((word) => word.word).join("");
        const language =
          lineIndex === 1
            ? (detectTextLanguage(lineText) ?? (lyricLine as LyricLine).language)
            : (lyricLine as LyricLine).language;
        // 行根元素也带 lang，副行（音译/翻译）才会命中对应语种字体
        if (language) {
          lyricLineElement.lang = language;
          lyricMainLineElement.lang = language;
        } else {
          lyricLineElement.removeAttribute("lang");
          lyricMainLineElement.removeAttribute("lang");
        }
        // 0.6 的行元素类名是哈希值，靠 lang + 选择器不可靠，直接写内联字体栈
        const stack = lineFontStack(language);
        if (stack) {
          lyricLineElement.style.fontFamily = stack;
          lyricMainLineElement.style.fontFamily = stack;
        } else {
          lyricLineElement.style.removeProperty("font-family");
          lyricMainLineElement.style.removeProperty("font-family");
        }
      }
    }
  }
};

/** 同步播放器配置 */
const syncPlayerOptions = (player = playerRef.value): void => {
  if (!player) return;
  syncAlignPosition();
  player.setWordFadeWidth(props.wordFadeWidth);
  player.setHidePassedLines(props.hidePassedLines);
  player.setEnableBlur(props.enableBlur);

  const useSpring = settings.lyric.useAMSpring;
  player.setEnableSpring(useSpring);
  player.setEnableScale(useSpring);
  player.setLinePosYSpringParams(
    props.minimizeSpringParams
      ? { mass: 0.1, damping: 0, stiffness: 1, soft: false }
      : {
          mass: settings.lyric.amllVerticalSpringMass,
          damping: settings.lyric.amllVerticalSpringDamping,
          stiffness: settings.lyric.amllVerticalSpringStiffness,
          soft: settings.lyric.amllVerticalSpringSoft,
        },
  );
  player.setLineScaleSpringParams(
    props.minimizeSpringParams
      ? { mass: 0.1, damping: 0, stiffness: 1, soft: false }
      : {
          mass: settings.lyric.amllScaleSpringMass,
          damping: settings.lyric.amllScaleSpringDamping,
          stiffness: settings.lyric.amllScaleSpringStiffness,
          soft: settings.lyric.amllScaleSpringSoft,
        },
  );
};

const { resume: resumeRaf, pause: pauseRaf } = useRafFn(
  ({ delta }) => {
    playerRef.value?.update(delta);
  },
  { immediate: false },
);

// 页面隐藏时停止渲染循环，恢复时校准时间线
const handleVisibility = () => {
  const hidden = document.hidden;
  isPageHidden.value = hidden; // 更新响应式隐藏状态
  if (hidden) {
    pauseRaf();
    playerRef.value?.pause();
    isPreviousHidden.value = true;
  } else if (isPreviousHidden.value && !isFrozen.value && playerRef.value) {
    // 从隐藏恢复：校准 Core 内部时钟到当前播放位置，避免逐词效果从头开始
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    syncCurrentTime(currentTime, true);
    isPreviousHidden.value = false;
    // 恢复后根据当前状态决定 resume/pause（由 watchEffect 处理，这里只需确保 state sync）
  }
};

onMounted(async () => {
  if (!wrapperRef.value) return;
  const player = new CoreLyricPlayer();
  playerRef.value = player;

  const el = player.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  wrapperRef.value.appendChild(el);

  const bottomEl = player.getBottomLineElement();
  if (bottomEl) {
    bottomEl.classList.add("lp-line", "lp-credit");
    bottomLineEl.value = bottomEl;
  }

  player.addEventListener("line-click", handleLineClick);

  player.setOptimizeOptions({
    cleanUnintentionalOverlaps: settings.lyric.amllCleanUnintentionalOverlaps,
    tryAdvanceStartTime: settings.lyric.amllTryAdvanceStartTime,
    convertExcessiveBackgroundLines: settings.lyric.amllConvertExcessiveBackgroundLines,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  });
  syncPlayerOptions(player);
  document.addEventListener("visibilitychange", handleVisibility);

  await nextTick();
  await nextFrame();
  if (playerRef.value !== player) return;

  // 抽屉展开动画期间容器高度可能仍为 0，此时下发歌词会让核心按 0 高度排版并停在视口外
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((wrapperRef.value?.clientHeight ?? 0) > 0) break;
    await nextFrame();
  }
  if (playerRef.value !== player) return;
  player.onResize();

  if (processedLyrics.value.length > 0) {
    const startedAt = performance.now();
    const prepared = processedLyrics.value;
    const preparedAt = performance.now();
    player.setLyricLines(prepared, props.initialTime);
    syncCurrentTime(props.initialTime, true);
    processLyricLanguage(player);
    void window.api.lyrics.log(
      "info",
      `[perf] amll mount prepare=${Math.round(preparedAt - startedAt)}ms setLines=${Math.round(performance.now() - preparedAt)}ms lines=${prepared.length}`,
    );
  } else if (Number.isFinite(props.initialTime) && props.initialTime >= 0) {
    syncCurrentTime(props.initialTime, true);
  }

  await nextFrame();
  if (playerRef.value !== player) return;
  if (pendingLyrics) {
    const startedAt = performance.now();
    player.setLyricLines(pendingLyrics, getCurrentTime() + status.lyricOffsetMs);
    pendingLyrics = null;
    void window.api.lyrics.log(
      "info",
      `[perf] amll switchLines=${Math.round(performance.now() - startedAt)}ms`,
    );
    processLyricLanguage(player);
    await nextFrame();
    if (playerRef.value !== player) return;
  }
  syncCurrentTime(getCurrentTime() + status.lyricOffsetMs, true);
  player.update(0);
  initialized.value = true;
  contentVisible.value = true;

  // 抽屉展开动画期间容器高度为 0，排版会把歌词排到可视区外；等一帧后按真实尺寸重排
  await nextFrame();
  if (playerRef.value !== player) return;
  player.calcLayout(LayoutReason.ConfigChange);
  player.update(0);

  // 首行若被排到可视区之外，说明首次布局基于未稳定的容器尺寸，强制按当前进度重算一次
  window.setTimeout(() => {
    const current = playerRef.value;
    const host = wrapperRef.value;
    if (!current || !host) return;
    const height = host.clientHeight;
    const line = host.querySelector<HTMLElement>('[class*="lyricLine"]');
    const offset = line ? new DOMMatrixReadOnly(getComputedStyle(line).transform).m42 : Number.NaN;
    const summary = current.getTimelineSummary();
    void window.api.lyrics.log(
      "info",
      `[perf] amll probe h=${height} offset0=${Math.round(offset)} scrollTo=${summary.scrollToIndex} hot=${summary.highlighted}`,
    );
    if (!Number.isFinite(offset) || Math.abs(offset) > height) {
      // 越界说明首次布局基于未稳定的容器尺寸：先让核心重新测量，再按当前进度重算
      current.onResize();
      current.setCurrentTime(getCurrentTime() + status.lyricOffsetMs, true);
      current.calcLayout(LayoutReason.Seek);
      current.update(0);
      void window.api.lyrics.log(
        "info",
        `[perf] amll heal offset0=${Math.round(offset)} h=${height}`,
      );
    }
  }, 700);

  // 尺寸变化（窗口缩放、布局切换）同样需要重排
  resizeObserver = new ResizeObserver(() => {
    const current = playerRef.value;
    if (!current) return;
    current.onResize();
    current.calcLayout(LayoutReason.Resize);
    current.update(0);
  });
  if (wrapperRef.value) resizeObserver.observe(wrapperRef.value);
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibility);
  resizeObserver?.disconnect();
  resizeObserver = undefined;
  pauseRaf();
  initialized.value = false;
  contentVisible.value = false;
  if (playerRef.value) {
    playerRef.value.removeEventListener("line-click", handleLineClick);
    playerRef.value.dispose();
    playerRef.value = undefined;
    bottomLineEl.value = undefined;
  }
});

// 同步播放/冻结状态到 Core 及渲染循环
watchEffect(() => {
  const player = playerRef.value;
  if (!player || !initialized.value) return;

  // 首次运行时校准一次（避免重复）
  if (!clockInitialized.value) {
    player.update(0);
    clockInitialized.value = true;
  }

  const playing = props.playing;
  const frozen = isFrozen.value;
  const hidden = isPageHidden.value; // 使用响应式隐藏状态

  if (!frozen && !hidden) {
    // 只要未冻结且可见，就持续运行 RAF 维持渲染（即使暂停也要保持画面）
    resumeRaf();
    if (playing) {
      player.resume();
    } else {
      player.pause();
    }
  } else {
    pauseRaf();
    player.pause();
  }
});

watch(
  () => [
    props.alignPosition,
    props.raiseAlignPositionOnOverlap,
    props.wordFadeWidth,
    props.hidePassedLines,
    props.enableBlur,
    props.minimizeSpringParams,
    settings.lyric.useAMSpring,
    settings.lyric.amllVerticalSpringMass,
    settings.lyric.amllVerticalSpringDamping,
    settings.lyric.amllVerticalSpringStiffness,
    settings.lyric.amllVerticalSpringSoft,
    settings.lyric.amllScaleSpringMass,
    settings.lyric.amllScaleSpringDamping,
    settings.lyric.amllScaleSpringStiffness,
    settings.lyric.amllScaleSpringSoft,
  ],
  () => syncPlayerOptions(),
);

// 监听处理完的歌词数据变动
watch(processedLyrics, (newLyrics) => {
  if (!playerRef.value) return;
  if (!initialized.value || isFrozen.value) {
    pendingLyrics = newLyrics;
  } else {
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    playerRef.value.setLyricLines(newLyrics, currentTime);
    syncCurrentTime(currentTime, true);
    processLyricLanguage();
  }
});

// 监听歌词优化配置变动并更新 Core
watch(
  () => ({
    cleanUnintentionalOverlaps: settings.lyric.amllCleanUnintentionalOverlaps,
    tryAdvanceStartTime: settings.lyric.amllTryAdvanceStartTime,
    convertExcessiveBackgroundLines: settings.lyric.amllConvertExcessiveBackgroundLines,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  }),
  (options) => {
    if (!playerRef.value) return;
    playerRef.value.setOptimizeOptions(options);
    if (processedLyrics.value.length > 0 && !isFrozen.value) {
      const currentTime = getCurrentTime() + status.lyricOffsetMs;
      playerRef.value.setLyricLines(processedLyrics.value, currentTime);
      syncCurrentTime(currentTime, true);
      processLyricLanguage();
    }
  },
  { deep: true },
);

// 主播放器事件驱动的时间同步接口
const setCurrentTime = (time: number, isSeek?: boolean) => {
  syncCurrentTime(time, isSeek);
};

/**
 * 强制滚动歌词到指定播放时间
 *
 * 切歌与拖动进度时先把弹簧临时调成瞬时，让歌词立刻落到目标位置，
 * 定位完成后再恢复用户设置的弹簧，避免软弹簧把首帧拖成一秒的缓慢滑动
 * @param time - 播放时间（毫秒）
 */
const scrollToTime = (time: number): void => {
  const player = playerRef.value;
  if (!player) return;
  player.setLinePosYSpringParams({ mass: 0.1, damping: 0, stiffness: 1, soft: false });
  syncCurrentTime(time, true);
  requestAnimationFrame(() => requestAnimationFrame(() => syncPlayerOptions(player)));
};

// 隐藏界面或休眠时调用
const freeze = () => {
  isFrozen.value = true;
};

// 恢复播放和滚动测量
const resume = () => {
  if (!initialized.value) {
    isFrozen.value = false;
    return;
  }
  if (pendingLyrics) {
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    playerRef.value?.setLyricLines(pendingLyrics, currentTime);
    syncCurrentTime(currentTime, true);
    processLyricLanguage();
    pendingLyrics = null;
  }
  isFrozen.value = false;
};

defineExpose({
  setCurrentTime,
  scrollToTime,
  freeze,
  resume,
  lyricPlayer: playerRef,
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="amll-lyrics-container"
    :class="contentVisible ? 'is-visible' : ''"
    :style="{ fontFamily: lyricFontStack }"
  />
  <Teleport v-if="bottomLineEl" :to="bottomLineEl">
    <slot name="bottom" />
  </Teleport>
</template>

<style scoped>
.amll-lyrics-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  user-select: none;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1);
}

.amll-lyrics-container.is-visible {
  opacity: 1;
}

/* auto 隐含 paint containment；视口附近的构建仍由 core 的可见性检测控制。 */
:deep(.FmKaba_lyricLine) {
  contain: layout style;
  content-visibility: visible;
  overflow: visible;
}

:deep(.amll-lyric-player) {
  --amll-lp-font-size: 1em;
  --amll-lp-color: var(--lp-color, #fff);
  width: 100%;
  height: 100%;
}

:deep(:lang(zh)),
:deep(:lang(yue)) {
  font-family: var(--lyric-font-zh, inherit);
}

:deep(:lang(ja)) {
  font-family: var(--lyric-font-ja, inherit);
}

:deep(:lang(ko)) {
  font-family: var(--lyric-font-ko, inherit);
}

:deep(:lang(und-Latn)) {
  font-family: var(--lyric-font-latin, inherit);
}

:deep(.amll-line-lyric > :first-child *) {
  mask-image: none !important;
  -webkit-mask-image: none !important;
}

:deep(.lp-line.lp-credit) {
  position: absolute !important;
  left: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding-top: 0.5em !important;
  padding-left: var(--lyric-line-padding-x, 1em) !important;
  padding-right: var(--lyric-line-padding-x, 1em) !important;
  text-align: left !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  font-size: inherit !important;
  line-height: 1.4 !important;
  pointer-events: auto !important;
  z-index: 10 !important;
  background: none !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  outline: none !important;
  contain: none !important;
  overflow: visible !important;
}

:deep(.lp-line.lp-credit:hover),
:deep(.lp-line.lp-credit:active),
:deep([class*="bottomLine"]),
:deep([class*="bottomLine"]:hover),
:deep([class*="bottomLine"]:active) {
  background: none !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  outline: none !important;
}

@media (max-width: 990px) {
  :deep(.lp-line.lp-credit) {
    padding-left: var(--lyric-line-padding-x, 1em) !important;
    padding-right: var(--lyric-line-padding-x, 1em) !important;
  }
}
</style>
