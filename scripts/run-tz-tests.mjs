// Runs the date-dependent tests once per time zone: npm run test:tz
//
// TZ is passed through an explicit child-process env (a `TZ=... node` prefix is not reliable in
// every shell, e.g. Git Bash on Windows silently drops it). Each run also receives the offset the
// zone must produce on 2026-11-15, and the test file fails if the zone did not actually apply.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ZONES = [
  { tz: 'UTC', offset: 0 },
  { tz: 'Asia/Karachi', offset: -300 }, // UTC+5, the owner's zone
  { tz: 'America/New_York', offset: 300 }, // behind UTC, with DST
  { tz: 'Pacific/Auckland', offset: -780 }, // far ahead of UTC, with DST
]

// every file that depends on dates: reporting, budget math (parity with the old code), and the composables
const testFiles = ['reporting', 'budget', 'cycle-income', 'bills-budget', 'bill-delete', 'expenses', 'accounts', 'accounts-store', 'accounts-view', 'accounts-lending', 'accounts-integration', 'investments', 'networth', 'goals', 'insights', 'migrations'].map((n) => fileURLToPath(new URL(`./${n}.test.mjs`, import.meta.url)))
let failed = 0

for (const { tz, offset } of ZONES) {
  console.log(`\n=== TZ=${tz} (expected offset ${offset} min) ===`)
  const run = spawnSync(process.execPath, ['--test', ...testFiles], {
    env: { ...process.env, TZ: tz, EXPECT_TZ_OFFSET: String(offset) },
    encoding: 'utf8',
  })
  const out = `${run.stdout || ''}${run.stderr || ''}`
  const summary = out
    .split('\n')
    .filter((line) => /^ℹ (tests|pass|fail|skipped) /.test(line))
    .join('  |  ')
    .replace(/ℹ /g, '')
  if (run.status !== 0) {
    failed++
    console.log(out)
    console.log(`FAILED in ${tz}`)
  } else {
    console.log(summary || 'ok')
  }
}

if (failed) {
  console.error(`\n${failed} time zone run(s) failed`)
  process.exit(1)
}
console.log(`\nAll ${ZONES.length} time zones passed`)
