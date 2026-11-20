<script setup lang="ts">
// Shown instead of the app when the stored data is from a newer version of Hisaab, or an update of it failed (app/lib/startup.ts).
// It imports no composable and uses no layout: nothing may read the data from here on. Same words and look as the old "Hisaab did not start" box.
const message = useState<string>("startup-blocked", () => "");
const reload = () => location.reload();
</script>

<template>
  <div role="alert" class="startup-blocked">
    <h1>Hisaab did not start</h1>
    <p>{{ message || "Hisaab could not check your saved data." }}</p>
    <button type="button" @click="reload">Reload</button>
  </div>
</template>

<style>
.startup-blocked {
  max-width: 32rem;
  margin: 15vh auto;
  padding: 1.5rem;
  border: 1px solid var(--border, #2b3640);
  border-radius: 12px;
  background: var(--card, #1a2029);
  color: var(--foreground, #e7ecef);
  font-family: Inter, sans-serif;
  line-height: 1.5;
}
.startup-blocked h1 {
  margin: 0 0 0.75rem;
  font-size: 1.25rem;
}
.startup-blocked p {
  margin: 0 0 1rem;
}
.startup-blocked button {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  border: 0;
  background: var(--primary, #4a9498);
  color: var(--primary-foreground, #0b1113);
  font-weight: 600;
  cursor: pointer;
}
</style>
