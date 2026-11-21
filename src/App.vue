<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useHistoryStore } from "@/stores/history";
import { extractColorFromUrl } from "@/utils/color";

const settings = useSettingsStore();
const media = useMediaStore();
const history = useHistoryStore();

// 曲目变化时套用已保存的静态封面，恢复后不再覆盖
watch(
  () => [media.track?.source, media.track?.id] as const,
  async () => {
    const track = media.track;
    if (!track) return;
    const key = `${track.source}:${track.id}`;
    const [staticRecord, motionRecord] = await Promise.all([
      window.api.motionCover.getStatic(toRaw(track)),
      window.api.motionCover.getManual(toRaw(track)),
    ]);
    if (`${media.track?.source}:${media.track?.id}` !== key) return;
    if (staticRecord) {
      media.track = {
        ...toRaw(track),
        cover: staticRecord.thumbUrl,
        coverOriginal: staticRecord.url,
      };
      extractColorFromUrl(staticRecord.url);
    } else if (motionRecord?.cover) {
      media.track = {
        ...toRaw(track),
        cover: motionRecord.cover,
        coverOriginal: motionRecord.cover,
      };
      extractColorFromUrl(motionRecord.cover);
    } else {
      // 没有手动记录时，把历史列表里旧版本残留的手动封面修回曲目原图
      history.patchCover(toRaw(track), track.cover, track.coverOriginal);
    }
  },
  { immediate: true },
);

watchEffect(() => {
  document.documentElement.toggleAttribute("data-reduced-motion", settings.reducedMotion);
  const v = settings.appearance.fontFamily;
  const root = document.documentElement.style;
  if (v) root.setProperty("--user-font", `${v}, var(--app-font)`);
  else root.removeProperty("--user-font");
});
</script>

<template>
  <AppBackground />
  <RouterView />
  <LyricTrackManagerDialog />
  <MotionCoverManagerDialog />
</template>
