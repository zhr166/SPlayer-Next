import { LayoutReason, LyricPlayer } from "@applemusic-like-lyrics/core";

/** SPlayer 的 AMLL 时间线适配；升级到 0.6 后高亮与滚动锚点由内部聚焦控制器维护。 */
export class SPlayerLyricPlayer extends LyricPlayer {
  /**
   * 重叠抬高模式下保持与旧版一致的调用入口。
   *
   * 0.6 的高亮生命周期由时间线控制器统一推导（唱完保持高亮，下一行进入才熄灭），
   * 不再需要外部提前交出滚动锚点，这里保留为空实现以免调用方改动。
   */
  advanceOverlapAnchor(): void {}

  /**
   * 统计当前处于高亮状态的主行数（不含背景行）
   * @returns 高亮主行数量
   */
  getBufferedMainLineCount(): number {
    const snapshot = this.timelineController.getSnapshot();
    let count = 0;
    for (const index of snapshot.highlightedGroups) {
      const line = this.currentLyricGroups[index]?.mainLine.getLine();
      if (line && !line.isBG) count++;
    }
    return count;
  }

  /**
   * 只使用前两条高亮主行计算对齐，后续同亮行不参与边界约束
   * @returns 两行高度、间距和重叠时长；不足两行时返回 null
   */
  getBufferedMainLineMetrics(): {
    firstHeight: number;
    secondHeight: number;
    gap: number;
    overlapDuration: number;
  } | null {
    const snapshot = this.timelineController.getSnapshot();
    const indices = Array.from(snapshot.highlightedGroups)
      .filter((index) => {
        const line = this.currentLyricGroups[index]?.mainLine.getLine();
        return line && !line.isBG;
      })
      .sort((a, b) => a - b)
      .slice(0, 2);
    if (indices.length < 2) return null;
    const firstIndex = indices[0];
    const lastIndex = indices[indices.length - 1];
    // 与 core 的布局尺寸保持一致，不读取正在动画中的 DOM 坐标
    const heights = this.currentLyricGroups
      .slice(firstIndex, lastIndex + 1)
      .map((group) => this.lyricGroupSize.get(group)?.[1] ?? this.size[1] / 5);
    const first = this.currentLyricGroups[firstIndex].mainLine.getLine();
    const second = this.currentLyricGroups[lastIndex].mainLine.getLine();
    if (!first || !second) return null;
    return {
      firstHeight: heights[0],
      secondHeight: heights[heights.length - 1],
      gap: heights.slice(1, -1).reduce((sum, height) => sum + height, 0),
      overlapDuration:
        Math.min(first.endTime, second.endTime) - Math.max(first.startTime, second.startTime),
    };
  }

  /** 按当前配置重排（0.6 需要显式传入触发原因） */
  relayoutForConfig(): void {
    this.calcLayout(LayoutReason.ConfigChange);
  }
}
