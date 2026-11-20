import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { ROUTES } from "./app/lib/routes";
import { LEGACY_HASH_SCRIPT, EARLY_THEME_SCRIPT } from "./app/lib/headScripts";

const view = (file: string) => fileURLToPath(new URL(`./app/views/${file}`, import.meta.url));

// Hisaab as a Nuxt 4 single-page app. Why each setting is here: docs/DECISIONS.md.
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  // SPA: one precached shell makes every route work offline (D1).
  ssr: false,
  devtools: { enabled: false },

  modules: ["@vite-pwa/nuxt"],
  css: ["~/style.css"],

  // D4: the pure code keeps explicit imports. Nothing in app/utils or app/composables is registered as a global, and components are imported by hand.
  imports: { scan: false },
  components: { dirs: [] },

  // D3: the routes are the app's own table (app/lib/routes.ts), so names, paths and titles do not change.
  pages: true,
  hooks: {
    "pages:extend"(pages) {
      pages.length = 0;
      for (const r of ROUTES) {
        pages.push(r.redirect ? { name: r.name, path: r.path, redirect: r.redirect } : { name: r.name, path: r.path, file: view(r.view!), meta: { title: r.title, ...(r.layout === false ? { layout: false } : {}) } });
      }
    },
  },

  vite: { plugins: [tailwindcss()] },

  app: {
    head: {
      htmlAttrs: { lang: "en" }, // data-theme is set by the early script and by the layout (the head manager would reset it)
      title: "Hisaab",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1.0" },
        { name: "description", content: "A personal, offline-first expense ledger — bills, budgets, recurring expenses and a private vault." },
        { name: "theme-color", content: "#12161C" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
        { name: "apple-mobile-web-app-title", content: "Hisaab" },
      ],
      link: [
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
        { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      ],
      // before the router starts and before first paint (app/lib/headScripts.ts)
      script: [
        { innerHTML: LEGACY_HASH_SCRIPT, tagPosition: "head", tagPriority: "critical" },
        { innerHTML: EARLY_THEME_SCRIPT, tagPosition: "head", tagPriority: "critical" },
      ],
    },
  },

  nitro: {
    // The SPA shell is prerendered once (index.html) so the service worker can precache it: offline, every navigation falls back to it (D6).
    prerender: { routes: ["/"], crawlLinks: false },
    // gzip + brotli files are made at build time and served by the Node server (Vercel compresses on its own). Without them a local run sends the whole 700 kB bundle uncompressed.
    compressPublicAssets: { gzip: true, brotli: true },
    // No HTTP cache may keep a session or sync answer (Phase 3 and later).
    routeRules: { "/api/**": { headers: { "cache-control": "no-store" } } },
  },

  // D6: the same worker identity as the Vite app (file name sw.js, scope "/", manifest id "/", prompt-to-reload), so the new worker replaces the old one on the same origin.
  pwa: {
    registerType: "prompt",
    injectRegister: "auto",
    includeAssets: ["favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png"],
    manifest: {
      id: "/",
      name: "Hisaab — Expense Ledger",
      short_name: "Hisaab",
      description: "A personal, offline-first expense ledger — bills, budgets, recurring expenses and a private vault.",
      lang: "en",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      theme_color: "#12161C",
      background_color: "#12161C",
      categories: ["finance", "productivity"],
      icons: [
        { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    workbox: {
      globPatterns: ["**/*.{js,css,html,woff2,png,svg,ico}"],
      // Every navigation falls back to the precached shell, EXCEPT /api/: the worker never handles the server's routes.
      navigateFallback: "/",
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
    },
    client: { installPrompt: false },
    devOptions: { enabled: false },
  },
});
