<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { applyLyricFontFaces } from "@/services/lyricFontFaces";

const settings = useSettingsStore();

// 歌词分文字种类字体在应用启动时注册一次，之后只在字体设置变化时更新
watchEffect(() => applyLyricFontFaces(settings.lyric));

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
</template>
