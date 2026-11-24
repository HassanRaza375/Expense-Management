// `npm run verify`: build, lint, unit tests, time-zone tests, browser tests, in that order, stopping at the first failure.
//
//  - The build is made with the sync flag OFF (NUXT_PUBLIC_SYNC_ENABLED=0), even if a local .env turns it on: the flag is baked into the
//    prerendered shell, and the browser tests expect the app as it ships while sync is off. The second test server turns it on at request time.
//  - The browser tests run one worker, no retries, on the production build. Run this on an idle machine and do not start other heavy work meanwhile.
//  - Steps run from a working directory with an UPPERCASE Windows drive letter (see scripts/run-vitest.mjs).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.platform === "win32" ? root.replace(/^[a-z]:/, (m) => m.toUpperCase()) : root;
const env = { ...process.env, NUXT_PUBLIC_SYNC_ENABLED: "0" };
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const only = process.argv[2]; // e.g. `node scripts/verify.mjs lint` runs just that step
const STEPS = [
  ["build", ["run", "build"]],
  ["lint", ["run", "lint"]],
  ["unit (node)", ["test"]],
  ["unit (vitest)", ["run", "test:unit"]],
  ["time zones", ["run", "test:tz"]],
  ["browser (e2e)", ["run", "test:e2e"]],
];

const started = Date.now();
for (const [name, args] of STEPS) {
  if (only && !name.startsWith(only)) continue;
  const t = Date.now();
  console.log(`\n=== ${name} ===`);
  const run = spawnSync(npm, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  const secs = Math.round((Date.now() - t) / 1000);
  if (run.status !== 0) {
    console.error(`\nVERIFY FAILED at "${name}" after ${secs}s (exit ${run.status}). Fix the cause and run it again; do not skip, retry until green, or loosen a test.`);
    process.exit(run.status ?? 1);
  }
  console.log(`--- ${name}: ok (${secs}s)`);
}
console.log(`\nVERIFY OK in ${Math.round((Date.now() - started) / 1000)}s`);
