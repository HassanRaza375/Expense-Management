// Real-service check, run BY HAND (needs `npm run build` first): `node scripts/live/health.mjs`.
// Starts the built server on a spare port with the sync flag ON and the TEST database (see testDb.mjs), asks /api/health, and stops the server.
// Proves the server's own database code (driver adapter, CA, schema) reaches the database. Prints no secret.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTestDb } from "./testDb.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = resolveTestDb();
if (target.error) {
  console.log(`health: REFUSED. ${target.error}`);
  process.exit(1);
}
const PORT = "3031";
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  cwd: root,
  env: { ...process.env, PORT, NITRO_PORT: PORT, NUXT_PUBLIC_SYNC_ENABLED: "1", DATABASE_URL: target.url },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

let result = null;
try {
  for (let i = 0; i < 40 && !result; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      result = { status: r.status, body: await r.json() };
    } catch {
      /* not up yet */
    }
  }
} finally {
  server.kill();
}
console.log("health:", result ? `${result.status} ${JSON.stringify(result.body)}` : "the server did not start");
if (!result || result.status !== 200 || result.body.database !== "up") {
  console.log("health: server log (the server already removes host, user and password):");
  console.log(log.split("\n").slice(-8).join("\n"));
  process.exit(1);
}
console.log("health: ok, the server reached the test database.");
