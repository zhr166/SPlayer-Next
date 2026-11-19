<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useFullPlayer } from "../../context";
import "./amllMediaButton.css";

const status = useStatusStore();
const media = useMediaStore();
const { showLyric, isPlaying } = storeToRefs(status);
const { onBarEnter, onBarLeave } = useFullPlayer();

const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);

/** 不看队列时信息列是否居中 */
const centeredWithoutQueue = computed(() => !showLyric.value || !hasLyric.value);

/** 歌词隐藏或无歌词时，信息列平移到屏幕中央 */
const infoCentered = computed(() => !status.fullQueueOpen && centeredWithoutQueue.value);

const lyricVisible = computed(() => showLyric.value && hasLyric.value && !status.fullQueueOpen);

/** 动态封面铺满左侧整列，静态封面保持居中圆角方块 */
const motionActive = ref(false);

/** 歌词面板正在过渡：只有这段时间才给合成层提示，空闲时保持可混合 */
const lyricTransitioning = ref(false);
let lyricTransitionTimer: ReturnType<typeof setTimeout> | undefined;

watch(lyricVisible, () => {
  lyricTransitioning.value = true;
  if (lyricTransitionTimer) clearTimeout(lyricTransitionTimer);
  lyricTransitionTimer = setTimeout(() => {
    lyricTransitioning.value = false;
    lyricTransitionTimer = undefined;
  }, 520);
});

onBeforeUnmount(() => {
  if (lyricTransitionTimer) clearTimeout(lyricTransitionTimer);
});

const toggleLyric = (): void => {
  if (status.fullQueueOpen) {
    status.fullQueueOpen = false;
    showLyric.value = true;
  } else {
    showLyric.value = !showLyric.value;
  }
};

/** 切换播放队列 */
const toggleQueue = (): void => {
  status.fullQueueOpen = !status.fullQueueOpen;
};
</script>

<template>
  <PlayerTopBar />
  <!-- 收起把手：与主分支一致，窗口顶部居中 -->
  <div class="app-no-drag absolute top-4 left-1/2 -translate-x-1/2 z-20">
    <AppleThumb />
  </div>
  <div class="absolute top-14 inset-x-0 bottom-16">
    <!-- 左侧封面与控制 -->
    <div
      class="absolute inset-y-0 left-0 flex transition-[width,transform] duration-500 ease-[cubic-bezier(0.5,0,0.5,1)]"
      :class="
        motionActive
          ? 'w-[52%] items-start pl-[2.5vw] pt-[1vh]'
          : 'w-[45%] items-center justify-center'
      "
      :style="{
        transform: !motionActive && infoCentered ? 'translateX(calc(50vw - 50%))' : undefined,
      }"
    >
      <div
        class="flex flex-col"
        :class="
          motionActive
            ? 'w-[min(55vw,68vh)] gap-[2.6vh]'
            : 'w-[min(50vh,38vw)] items-center gap-[4vh]'
        "
      >
        <PlayerCover
          fullscreen-motion
          class="[transition:transform_500ms_cubic-bezier(0.34,1.56,0.64,1),box-shadow_500ms_ease-out]"
          :class="[
            motionActive
              ? 'relative w-full aspect-square !rounded-none !shadow-none'
              : 'relative w-full aspect-square rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.3)]',
            !motionActive && (isPlaying ? 'scale-100' : 'scale-90'),
          ]"
          @motion-state="motionActive = $event"
        />
        <AppleControls class="relative z-10" />
      </div>
    </div>
    <!-- 右侧歌词 -->
    <div
      class="group absolute inset-y-0 right-0 pr-20 flex flex-col transition-[width,opacity] duration-500 ease-[cubic-bezier(0.5,0,0.5,1)]"
      :style="{ width: motionActive ? '45%' : '55%' }"
      :class="[
        lyricVisible ? 'opacity-100' : 'opacity-0 pointer-events-none',
        lyricTransitioning && '[will-change:opacity]',
      ]"
    >
      <PlayerLyric :visible="lyricVisible" />
      <LyricActions />
    </div>
    <!-- 播放队列 -->
    <div
      class="absolute inset-y-0 right-0 w-[55%] pl-4 py-6 flex items-center"
      :class="status.fullQueueOpen ? '' : 'pointer-events-none'"
    >
      <!-- 封面需移开时延后淡入 -->
      <Transition
        :enter-active-class="`transition-opacity duration-500 ${centeredWithoutQueue ? 'delay-250' : ''}`"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-500"
        leave-to-class="opacity-0"
      >
        <div v-if="status.fullQueueOpen" class="w-full h-full">
          <QueuePanel @close="status.fullQueueOpen = false" />
        </div>
      </Transition>
    </div>
  </div>
  <!-- 右下角开关 -->
  <div
    data-player-layout="bottom-bar"
    class="absolute bottom-4 right-0 h-16 z-10 flex items-center gap-9 pr-9"
    @mouseenter="onBarEnter"
    @mouseleave="onBarLeave"
  >
    <SButton
      type="cover"
      variant="text"
      size="auto"
      class="opacity-45 hover:opacity-80"
      :disabled="!hasLyric"
      @click="toggleLyric"
    >
      <IconSpAmLyricsActive v-if="lyricVisible" class="size-9" />
      <IconSpAmLyrics v-else class="size-9" />
    </SButton>
    <SButton
      type="cover"
      variant="text"
      size="auto"
      class="opacity-45 hover:opacity-80"
      @click="toggleQueue"
    >
      <IconSpAmPlaylistActive v-if="status.fullQueueOpen" class="size-9" />
      <IconSpAmPlaylist v-else class="size-9" />
    </SButton>
  </div>
</template>
