<script setup lang="ts">
import { watch } from "vue";
import { toast } from "./ui/sonner/index.js";

// "A new version of Hisaab is available" with a Reload button: the same prompt-to-reload flow the Vite app had (registerType "prompt").
const { $pwa } = useNuxtApp();

watch(
  () => $pwa?.needRefresh,
  (need) => {
    if (!need) return;
    toast("A new version of Hisaab is available", {
      duration: Infinity,
      action: { label: "Reload", onClick: () => $pwa?.updateServiceWorker(true) },
    });
  },
  { immediate: true },
);
</script>

<template>
  <span hidden />
</template>
