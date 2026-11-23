# CLAUDE.md

Guidance for Claude Code when working in this repository (Hisaab, a personal finance PWA). Read `HISAAB_PROGRESS.md` first (the tracker: what is done, what is next),
then `docs/NUXT_PLAN.md` and `docs/DECISIONS.md` (why the app is shaped the way it is).

## What this repo is

A local-first expense ledger: Nuxt 4 single-page app (`ssr: false`), Vue 3, Tailwind 4, Reka UI/shadcn-style components, ApexCharts, an offline PWA.
Signed out ("guest mode") all data lives in the browser and nothing calls a server. Signed in (behind the `NUXT_PUBLIC_SYNC_ENABLED` flag) an account is the source of
truth with an offline cache and an outbox. Server: Nitro routes under `server/api/**`, Prisma 7.10.1 on PostgreSQL (Aiven), Better Auth, Cloudinary (profile photo and receipts only).

## Rules (non-negotiable)

1. **Nothing the browser stores today may be lost.** Every `hisaab:*` localStorage key, its format, and the IndexedDB databases `hisaab-attachments` and `hisaab-backups` keep their names and
   versions. Never open an existing IndexedDB at another version. Changes to stored data are additive and versioned; a snapshot is taken before every migration (`app/utils/migrations.js`, `startup.js`).
2. **Money safety.** Never drop or overwrite a record silently. Deletes are tombstones in sync. Sync pushes are idempotent. Deleting an expense never deletes its receipt files (Undo must work).
3. **Time safety.** Keep the local-day and cycle rules exactly (`localDayKey`, local-noon dates, the cycle reset day in `app/utils/reporting.js`). The server NEVER works out a day or month in its own
   time zone: the client attaches the day key it computed, the server validates the `YYYY-MM-DD` form (and that it is a real date), and monthly/yearly totals group by that key. Projection columns
   store money as integer minor units.
4. **No secrets in the repo, ever.** `.env` is gitignored and is never opened, printed or logged by an assistant; read credentials from environment variables at request time. Never put a secret
   in `runtimeConfig` from `process.env` at build time (it lands in the build output; `tests/noServices.test.ts` checks `nuxt.config.ts`). Scripts load `.env` with `process.loadEnvFile()` and print no secret.
5. **No test reaches a real service** (the database host, Cloudinary, Google, an email provider). Browser tests start from `e2e/fixtures.ts` (it blocks every non-local request and fails the test on any console
   error); the Playwright servers get `DATABASE_URL=postgres://blocked.invalid…` and blank keys; Vitest blanks the credentials (`tests/setup/noServices.ts`). Real-service checks live only in
   `scripts/live/*`, are run by hand against the TEST database, and refuse to run unless the database name looks like a test or preview database.
6. **Guest mode is today's app.** Signed out nothing calls the server. The App Lock is device-only and never synced; the Vault is encrypted in the browser and only ciphertext is ever stored remotely.
7. **Keep the look ("Ledger" design, light and dark), `@lucide/vue` icons and the self-hosted fonts.** No CDN for fonts or icons: the app must keep working offline.
8. **Keep the existing tests green** (`npm test`, `npm run test:tz`). A change to a calculation needs a deliberate, stated reason. Never skip, retry-until-green or loosen a test.
9. **One session per working tree.** Two assistants editing one folder overwrote each other once (Session 9). Keep `HISAAB_PROGRESS.md` accurate and append a dated session entry after every phase.
10. Work on a branch, commit in small steps (`nuxt(<scope>): <what>`); never merge to `main`, push to `main`, deploy or touch production without the owner asking.

## Commands

```
npm run dev            # dev server (offline and the service worker do NOT work in dev)
npm run build          # production build (set NUXT_PUBLIC_SYNC_ENABLED=0 for a verify build)
npm run lint           # ESLint (correctness rules; formatting is not enforced)
npm test               # node --test "scripts/*.test.mjs": the pure-code tests (321)
npm run test:unit      # Vitest: tests/**/*.test.ts, for the TypeScript code
npm run test:tz        # the date-dependent node tests under UTC, Asia/Karachi, America/New_York, Pacific/Auckland
npm run test:e2e       # Playwright on the production build (needs a build first), one worker, no retries
npm run verify         # all of the above in order, stopping at the first failure (scripts/verify.mjs)

# dev tools (not part of verify; drive the installed Chrome, see the header of each file)
node scripts/measure/bench.mjs <urlA> <urlB> [runs]      # interleaved cold-start A/B of two builds
HISAAB_OLD_DIR=<built old checkout> node scripts/measure/cutover.mjs   # old build -> new build on one origin, and an old-app backup restored
```

## Layout

- `app/utils`, `app/composables`, `app/components`, `app/views`: the original plain-JS app (kept as JS; imports are explicit, directory auto-scanning is OFF, see D4). `app/lib/**`: new TypeScript
  (`routes.ts` the route table, `startup.ts`, `headScripts.ts`). `app/layouts/default.vue` is the old `App.vue`. `app/middleware/startup.global.ts` runs the data check first.
- `scripts/*.test.mjs`: node tests (with `scripts/fake-indexeddb.mjs`). `tests/`: Vitest. `e2e/`: Playwright. `docs/`: plan, decisions, deploy notes, page docs.
- `server/` (Phase 3 on): `api/**` routes, `utils/**`, generated Prisma client in `server/generated/` (gitignored). `prisma/`: schema and migrations (written offline, applied by the owner).

## Gotchas found while building (read before changing the startup, PWA or storage code)

- **Module-load order is load-bearing.** Composables read localStorage when their module is first imported, so nothing that imports them may load before `prepareData()` (migration + snapshot) has run AND the storage wrapper has been switched to account mode. Hence `app/app.vue` imports no composable, the layout and pages are lazy chunks, and the data check runs in the client plugin `app/plugins/00.startup.client.ts` with `order: -60`: **Nuxt's own router plugin resolves the first page component (and so every composable) before any route middleware runs**, so the middleware alone is too late. The global middleware stays only to show the blocked screen. A blocked start goes to `/startup-blocked` (a page with no layout and no composable); returning `abortNavigation()` instead shows Nuxt's own 404. `tests/routes.test.ts` guards `app.vue` and that view; `e2e/loadOrder.spec.ts` records the real read order in a browser.
- **Do not put `data-theme` in `app.head.htmlAttrs`**: the head manager re-applies it after mount and overrides the saved theme. The early inline script and the layout set it.
- **The service worker needs a precached shell.** Without `nitro.prerender.routes: ["/"]` the build has no HTML and the worker's `navigateFallback "/"` throws offline. The worker must never handle `/api/`.
- **Windows: open the shell with an UPPERCASE drive letter** (`C:\...`). A lowercase one (`c:\...`) makes Vitest load two copies of itself ("Cannot read properties of undefined (reading 'config')"). `npm run test:unit` and
  `npm run verify` already fix the working directory; a bare `npx vitest` from `c:\` will not.
- **Tests must not depend on the real clock.** Fixtures with a due date near "today" became "overdue" as the date passed (a New York/Auckland-only failure on 20 Nov). Use fixed far-future dates (2099) or a fixed `now`.
- **Run browser checks against `npm run build` output, not `nuxt dev`.** After heavy editing the dev server served two copies of the same module (two in-memory stores) and made tests fail that pass on the build.
- **Test helpers must not create an IndexedDB the app creates.** Opening `hisaab-attachments` before the app does leaves it at version 1 with no object store; check `indexedDB.databases()` first.
- **A toast can cover a button at 375px**; in a browser test click with the element's own `.click()` or dismiss the toast.
- **Startup timing**: compare builds with interleaved cold runs after a settle delay; a first run right after launching Chrome adds hundreds of ms of jitter.
- **Prisma is pinned to exactly 7.10.1** (`prisma`, `@prisma/client`, `@prisma/adapter-pg`): `npm install prisma` alone installs a release candidate. Aiven's CA is not in Node's trust store: pass it as `DATABASE_CA_CERT`
  (PEM) or `DATABASE_CA_FILE`; never turn certificate checks off.
- **Build for `verify` with the sync flag OFF.** The flag is baked into the prerendered shell; with it on, the shell loads account code against the flag-off test server and logs 404s.
- Browser tests of account pages must not depend on prerendered pages carrying the build-time flag; use `/settings`.

- **Account mode (Phase 5).** Signed in (and past the first-sign-in choice) the synced keys live in `hisaab:u:<userId>:<key>`; the guest keys are never read or written then. Every key must be classified in `app/lib/sync/inventory.ts` (a test fails otherwise) and `app/utils/syncedKeys.js` is the plain-JS list the wrapper routes by (the Node tests load `storage.js`, so it must not import TypeScript). A composable that holds module state calls `registerState(KEY, state)` so a change from the account reaches the page without a reload. Playwright cannot turn the build-time flag on, so `e2e/accountMocks.ts` rewrites the shell and fakes `/api/*` (the sync routes run the REAL `server/utils/syncService.ts` over the in-memory repository); each "device" is its own browser context.
- **No raw SQL in the server** (it ignores the `?schema=` the client works in); lock a row by updating it. A `ServiceError` thrown in a route helper is not an HTTP error: translate it with `jsonError` (the live check found a 500 where a 409 was meant).
- **Live checks** (by hand, TEST database only, each leaves it clean): `node scripts/live/db-safety.mjs`, `migrate-test.mjs`, `health.mjs`, `account.mjs`, `sync.mjs`; the two browser ones need a flag-ON build first (`NUXT_PUBLIC_SYNC_ENABLED=1 npm run build`, then `accountBrowser.mjs` / `syncBrowser.mjs`, then build with the flag 0 again before `npm run verify`).
- **Admin panel (Phase 7).** `/api/admin/*` answers 404 to everyone who is not a signed-in, enabled super admin (put `await requireSuperAdmin(event)` first in every admin route); the admin repository selects projection columns only, never the stored document. `e2e/accountMocks.ts` serves `/api/admin/*` through the REAL `adminService` over `tests/fakes/adminRepo.ts` (mirroring the fake users); create a super admin with `addUser(server, email, pw, name, "superadmin")`. `scripts/live/admin.mjs` is the real check.
- **Hardening (Phase 8).** A new route needs: its guard first, a `limit(event, user.id, "<bucket>")` line (add a bucket in `server/utils/rateLimit.ts` if it is costly), and a row in `scripts/live/authzTable.mjs` (a test fails otherwise). `e2e/a11y.spec.ts` runs axe on every page: icon-only buttons need an `aria-label`, inputs a label, scrollable regions `tabindex="0"`, status text must use `text-status-*` (the darker text tokens), links inside text need an underline. `scripts/live/authz.mjs` and `admin.mjs` are the real checks.
- **In a Playwright helper, wait for the dialog's focus before typing**: `fill` on one field inserts into whatever is focused when the dialog's own autofocus lands late, which silently put text into the number Amount field.
