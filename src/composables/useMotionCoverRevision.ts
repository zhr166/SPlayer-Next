import { ref, type Ref } from "vue";

/** 手动封面变化时通知播放器重新解析动态封面 */
const revision = ref(0);

/**
 * 读取自动封面修订号
 * @returns 响应式修订号
 */
export const useMotionCoverRevision = (): Ref<number> => revision;

/** 标记手动封面已变更 */
export const bumpMotionCoverRevision = (): void => {
  revision.value++;
};
