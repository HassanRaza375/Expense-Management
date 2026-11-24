// Runs Vitest from a working directory whose Windows drive letter is UPPERCASE. A shell opened as `c:\...` makes Vitest load two copies of itself
// (every file then fails with "Cannot read properties of undefined (reading 'config')"). Extra arguments are passed on: `npm run test:unit -- tests/routes.test.ts`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.platform === "win32" ? root.replace(/^[a-z]:/, (m) => m.toUpperCase()) : root;
const entry = path.join(cwd, "node_modules", "vitest", "vitest.mjs");
const run = spawnSync(process.execPath, [entry, "run", ...process.argv.slice(2)], { cwd, stdio: "inherit" });
process.exit(run.status ?? 1);
