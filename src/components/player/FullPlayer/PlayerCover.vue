<script setup lang="ts">
import Hls from "hls.js";
import { resolveDynamicCover, type DynamicCoverResult } from "@/services/dynamicCover";
import { isSameCoverArt } from "@/utils/coverFingerprint";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import { useTimeoutFn } from "@vueuse/core";
import { nextTick } from "vue";

withDefaults(defineProps<{ fullscreen?: boolean }>(), { fullscreen: false });

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const user = useUserStore();
const { isPlaying } = storeToRefs(status);

/** 加载中的歌曲使用队列当前项作为封面兜底 */
const displayTrack = computed(() => media.track ?? status.currentTrack);

/** 高清封面缓存 */
const hdCache = shallowRef<{ id: string; data: string } | null>(null);

const coverSrc = computed(() =>
  hdCache.value && hdCache.value.id === displayTrack.value?.id
    ? hdCache.value.data
    : displayTrack.value?.coverOriginal || displayTrack.value?.cover,
);

watchEffect(async () => {
  const id = displayTrack.value?.id;
  if (!status.isPlayerExpanded || status.trackLoading || !id) return;
  if (displayTrack.value?.source !== "local" || hdCache.value?.id === id) return;
  const r = await window.api.player.getCoverRaw();
  if (displayTrack.value?.id !== id || !r.success || !r.data) return;
  hdCache.value = { id, data: r.data };
});

/** 动态封面地址与格式 */
const dynamicCover = ref<DynamicCoverResult | null>(null);
/** 动态封面是否已加载出首帧 */
const dynamicCoverLoaded = ref<boolean>(false);
const videoRef = ref<HTMLVideoElement | null>(null);
/** HLS 播放实例，非 mp4 动态封面需要它做 MSE 播放 */
let hls: Hls | null = null;

/** 释放 HLS 实例，避免离开播放页后继续拉流 */
const destroyHls = (): void => {
  hls?.destroy();
  hls = null;
};

/**
 * 按格式给视频元素挂载媒体源
 * @param result - 动态封面解析结果
 */
const attachVideoSource = async (result: DynamicCoverResult | null): Promise<void> => {
  await nextTick();
  const video = videoRef.value;
  if (!video || !result) return;
  if (result.format === "mp4") {
    video.src = result.url;
    return;
  }
  if (Hls.isSupported()) {
    destroyHls();
    hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    hls.loadSource(result.url);
    hls.attachMedia(video);
    return;
  }
  video.src = result.url;
};

/** 是否处于封面展示模式（非全屏） */
const isCoverMode = computed(() => settings.player.coverLayout !== "fullscreen");

/** 是否在加载中 */
const trackLoading = computed(() => status.trackLoading);

/** 封面再放送：视频结束后 2s 重新播放 */
const { start: dynamicCoverStart, stop: dynamicCoverStop } = useTimeoutFn(
  () => {
    dynamicCoverLoaded.value = true;
    nextTick(() => {
      const video = videoRef.value;
      if (!video) return;
      // HLS 播完后 currentTime 停在结尾，复位才能重播
      if (video.currentTime > 0) video.currentTime = 0;
      void video.play();
    });
  },
  2000,
  { immediate: false },
);

/**
 * 拉取动态封面
 *
 * 仅对网易云来源、非全屏布局、已登录且开关开启的曲目生效
 */
const fetchDynamicCover = async (): Promise<void> => {
  const track = displayTrack.value;
  if (!track) {
    dynamicCover.value = null;
    destroyHls();
    return;
  }
  if (!isCoverMode.value || !settings.player.dynamicCover || trackLoading.value) {
    dynamicCover.value = null;
    destroyHls();
    return;
  }

  // 停止已有的再放送定时器，重置加载状态
  dynamicCoverStop();
  dynamicCoverLoaded.value = false;

  let result = await resolveDynamicCover(
    track,
    settings.player.appleMusicStorefront,
    user.isLoggedIn,
  );
  if (displayTrack.value?.id !== track.id) return; // 歌曲已切换

  // 专辑名相同不代表封面相同：动效封面来自别的发行时，静态封面会来回跳，直接不用
  if (result?.artwork) {
    const trackCover =
      hdCache.value?.id === track.id ? hdCache.value.data : (track.cover ?? track.coverOriginal);
    const same = trackCover ? await isSameCoverArt(trackCover, result.artwork) : null;
    if (same === false) result = null;
  }
  if (displayTrack.value?.id !== track.id) return;

  dynamicCover.value = result;
  await attachVideoSource(result);
};

/** 视频播完后进入等待再放送 */
const onDynamicCoverEnded = (): void => {
  dynamicCoverLoaded.value = false;
  dynamicCoverStart();
};

/** 卸载或切歌时清理视频元素，避免继续解码 */
const cleanupDynamicCover = (): void => {
  destroyHls();
  if (videoRef.value) {
    videoRef.value.pause();
    videoRef.value.removeAttribute("src");
    videoRef.value.load();
  }
  dynamicCover.value = null;
  dynamicCoverLoaded.value = false;
};

watch(
  () =>
    [
      displayTrack.value?.id,
      settings.player.dynamicCover,
      settings.player.coverLayout,
      status.trackLoading,
    ] as const,
  () => {
    fetchDynamicCover();
  },
);

onMounted(() => {
  fetchDynamicCover();
});

onBeforeUnmount(() => {
  dynamicCoverStop();
  cleanupDynamicCover();
});
</script>

<template>
  <div
    data-player-cover="full"
    :class="
      fullscreen
        ? 'player-cover-fullscreen w-full h-full aspect-auto rounded-none bg-transparent overflow-hidden shrink-0'
        : [
            'player-cover',
            'relative',
            'w-full aspect-square rounded-[32px] overflow-hidden shrink-0',
            'shadow-[0_0_20px_10px_rgba(0,0,0,0.1)]',
            isPlaying ? 'scale-100' : 'scale-90',
          ]
    "
  >
    <DetailCover :src="coverSrc" :fallback="displayTrack?.cover" class="size-full" />
    <Transition name="fade" mode="out-in">
      <video
        v-if="dynamicCover && !fullscreen"
        ref="videoRef"
        :src="dynamicCover.format === 'mp4' ? dynamicCover.url : undefined"
        :class="['dynamic-cover', { loaded: dynamicCoverLoaded }]"
        muted
        autoplay
        playsinline
        @loadeddata="dynamicCoverLoaded = true"
        @ended="onDynamicCoverEnded"
      />
    </Transition>
  </div>
</template>

<style scoped>
.player-cover {
  transition:
    transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1),
    box-shadow 200ms ease-out;
}

.player-cover-fullscreen {
  mask-image: linear-gradient(
    to right,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.98) 10%,
    rgba(0, 0, 0, 0.92) 22%,
    rgba(0, 0, 0, 0.82) 32%,
    rgba(0, 0, 0, 0.68) 42%,
    rgba(0, 0, 0, 0.52) 52%,
    rgba(0, 0, 0, 0.36) 62%,
    rgba(0, 0, 0, 0.22) 72%,
    rgba(0, 0, 0, 0.1) 82%,
    rgba(0, 0, 0, 0.03) 92%,
    rgba(0, 0, 0, 0) 100%
  );
}

.dynamic-cover {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 32px;
  overflow: hidden;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.8s ease-in-out;
  backface-visibility: hidden;
  transform: translateZ(0);

  &.loaded {
    opacity: 1;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
