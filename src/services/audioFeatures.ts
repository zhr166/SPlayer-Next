const FFT_MIN_FREQ = 80;
const FFT_MAX_FREQ = 2000;
const FFT_BINS = 128;

// 原生 FFT 的频段下限固定为 80Hz（native/audio-engine/src/dsp/fft.rs 的 MIN_FREQ），
// 因此底鼓 60Hz 基频取不到；这里收窄到 80–105Hz（最低的若干个频段），尽量贴近底鼓的
// 击打频段，避免 105Hz 以上的贝斯/人声把脉动带糊。要真正判到 60Hz 需要改原生常量并重编。
const BASS_MIN_FREQ = 80;
const BASS_MAX_FREQ = 105;
const BASS_THRESHOLD = 0.16;
const BASS_GAIN = 2.2;
const BASS_CURVE = 1.05;
const BASS_PEAK_MIX = 0.45;
const BASS_HIGH_BIN_WEIGHT = 0.65;

const AMLL_VOLUME_BASE = 1;
// 低频重时让流沙/网格动得更明显：脉冲到低频音量的映射幅度比原先 2.4 略大
const AMLL_VOLUME_RANGE = 2.9;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const logMin = Math.log(FFT_MIN_FREQ);
const logMax = Math.log(FFT_MAX_FREQ);

/**
 * 获取 native FFT 对数频段的边界频率
 * @param index - 频段索引
 * @returns 频段边界频率
 */
const getFftBinEdges = (index: number): { lo: number; hi: number } => {
  const lo = Math.exp(logMin + ((logMax - logMin) * index) / FFT_BINS);
  const hi = Math.exp(logMin + ((logMax - logMin) * (index + 1)) / FFT_BINS);
  return { lo, hi };
};

/**
 * 查找与目标频率范围相交的 FFT 频段
 * @param minFreq - 最低频率
 * @param maxFreq - 最高频率
 * @returns 左闭右开频段范围
 */
export const getFftBinRange = (
  minFreq: number,
  maxFreq: number,
): { start: number; end: number } => {
  let start = FFT_BINS;
  let end = 0;

  for (let i = 0; i < FFT_BINS; i++) {
    const { lo, hi } = getFftBinEdges(i);
    if (hi <= minFreq || lo >= maxFreq) continue;
    start = Math.min(start, i);
    end = Math.max(end, i + 1);
  }

  if (start >= end) return { start: 0, end: 0 };
  return { start, end };
};

const bassRange = getFftBinRange(BASS_MIN_FREQ, BASS_MAX_FREQ);

/**
 * 从 native FFT 帧中提取低频脉冲强度
 * @param data - 双声道 128 段对数频谱
 * @returns 低频脉冲强度，范围 0..1
 */
export const getBassPulse = (data: readonly [number[], number[]]): number => {
  if (data[0].length === 0 || data[1].length === 0 || bassRange.start >= bassRange.end) return 0;

  let sum = 0;
  let peak = 0;
  let weightSum = 0;
  const count = bassRange.end - bassRange.start;

  for (let i = bassRange.start; i < bassRange.end; i++) {
    const position = count <= 1 ? 0 : (i - bassRange.start) / (count - 1);
    const weight = 1 - position * (1 - BASS_HIGH_BIN_WEIGHT);
    const value = ((data[0][i] ?? 0) + (data[1][i] ?? 0)) / 2;
    sum += value * value * weight;
    peak = Math.max(peak, value);
    weightSum += weight;
  }

  const rms = Math.sqrt(sum / Math.max(1, weightSum));
  const energy = rms * (1 - BASS_PEAK_MIX) + peak * BASS_PEAK_MIX;
  const normalized = Math.max(0, (energy - BASS_THRESHOLD) / (1 - BASS_THRESHOLD));

  return clamp01(Math.pow(normalized, BASS_CURVE) * BASS_GAIN);
};

/**
 * 将低频脉冲映射为 AMLL 背景渲染器需要的低频音量
 * @param pulse - 低频脉冲强度，范围 0..1
 * @returns AMLL 低频音量
 */
export const toAmllLowFreqVolume = (pulse: number): number =>
  AMLL_VOLUME_BASE + clamp01(pulse) * AMLL_VOLUME_RANGE;

/** 起音检测：基线自适应时长（毫秒） */
const ONSET_BASELINE_MS = 400;
/** 起音检测：开始播放 / 跳转后的暖机时长（毫秒） */
const ONSET_WARMUP_MS = 120;
/** 起音检测：两次起音之间的不应期（毫秒） */
const ONSET_REFRACTORY_MS = 180;
/** 起音检测：包络衰减时间常数（毫秒） */
const ONSET_ENVELOPE_MS = 160;
/** 起音判定：能量需超过自适应基线的倍数 */
const ONSET_RATIO = 1.35;
/** 起音判定：绝对能量门槛，压掉静音底噪 */
const ONSET_MIN_ENERGY = 0.04;
/** 进度跳变超过该值视为切歌或拖动（毫秒） */
const ONSET_MAX_JUMP_MS = 500;

/** 低频起音检测器；每个背景实例独立持有一份 */
export interface BassPulseDetector {
  /**
   * 推进一帧并返回当前脉冲包络
   * @param energy - 当前帧低频能量（0..1）
   * @param timeMs - 当前播放进度（毫秒），用于识别切歌与拖动
   * @returns 起音包络，0..1
   */
  update: (energy: number, timeMs: number) => number;
  /** 清空内部状态，重新暖机 */
  reset: () => void;
}

/**
 * 创建低频起音检测器
 *
 * 只在真正的低频起音时给脉冲：持续贝斯会被 400ms 自适应基线吸收，
 * 静音不触发，切歌 / 拖动进度后从暖机重新开始。
 * @returns 检测器实例
 */
export const createBassPulseDetector = (): BassPulseDetector => {
  let baseline = 0;
  let envelope = 0;
  let lastTime = Number.NaN;
  let lastOnsetTime = Number.NEGATIVE_INFINITY;
  let warmupUntil = 0;
  let started = false;

  const reset = (): void => {
    baseline = 0;
    envelope = 0;
    lastTime = Number.NaN;
    lastOnsetTime = Number.NEGATIVE_INFINITY;
    warmupUntil = 0;
    started = false;
  };

  return {
    update(energy, timeMs) {
      const safeEnergy = clamp01(energy);

      // 时间倒退或大幅跳变：切歌 / 拖动进度
      if (!Number.isNaN(lastTime) && (timeMs < lastTime || timeMs - lastTime > ONSET_MAX_JUMP_MS)) {
        reset();
      }

      if (!started) {
        started = true;
        baseline = safeEnergy;
        lastTime = timeMs;
        warmupUntil = timeMs + ONSET_WARMUP_MS;
        return 0;
      }

      const delta = Math.max(0, Math.min(timeMs - lastTime, ONSET_MAX_JUMP_MS));
      lastTime = timeMs;

      // 自适应基线：持续的低频会被慢慢吸收，不再重复触发
      baseline += (safeEnergy - baseline) * Math.min(1, delta / ONSET_BASELINE_MS);
      // 包络衰减
      envelope *= Math.exp(-delta / ONSET_ENVELOPE_MS);
      if (envelope < 0.001) envelope = 0;

      if (timeMs < warmupUntil || safeEnergy <= ONSET_MIN_ENERGY) return envelope;

      const rising = safeEnergy > baseline * ONSET_RATIO && safeEnergy > baseline + 0.02;
      if (rising && timeMs - lastOnsetTime >= ONSET_REFRACTORY_MS) {
        lastOnsetTime = timeMs;
        const strength = clamp01((safeEnergy - baseline) / Math.max(0.12, baseline));
        envelope = Math.max(envelope, 0.55 + 0.45 * strength);
      }

      return envelope;
    },
    reset,
  };
};
