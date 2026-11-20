<script setup lang="ts">
// This file imports NO composable on purpose (app/lib/startup.ts): the layout and the pages are lazy chunks that load only after the data check.
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
