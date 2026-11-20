import { defineAsyncComponent } from "vue";

// ApexCharts needs the browser and is large (about 500 kB), so the global <apexchart> component the chart components use is registered as a
// LAZY async component: the library is fetched and run only when a chart is first rendered (the dashboard, net worth, fund pages), not on every page.
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.component(
    "apexchart",
    defineAsyncComponent(() => import("vue3-apexcharts").then((m) => m.default)),
  );
});
