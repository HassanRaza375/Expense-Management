import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the TypeScript code (app/lib/**, server/**). The older plain-JS tests stay in scripts/*.test.mjs and run with `node --test`
// (`npm test`); both run in `npm run verify`. Start this through `npm run test:unit` (scripts/run-vitest.mjs): on Windows a lowercase drive letter
// in the working directory (c:\...) makes Vitest load two copies of itself.
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      "@": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: { include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup/noServices.ts"] },
});
