# Hisaab: Nuxt migration, accounts and sync — plan

Branch: `nuxt-migration` (never merged to `main` by this work). Written in Phase 0, before any code was changed.
Decisions and their reasons are in `docs/DECISIONS.md`; the tracker is `HISAAB_PROGRESS.md`.

## 0. Baseline (taken on this branch before any change)

| Check | Result |
|---|---|
| `npm test` (`node --test "scripts/*.test.mjs"`) | 321 tests, 320 pass, 0 fail, 1 intentional skip |
| `npm run test:tz` (UTC, Asia/Karachi, America/New_York, Pacific/Auckland) | 295 tests per zone; UTC, Karachi and Auckland all pass; New York skips 6 old-date-picker-format tests (documented, G17) |
| `npm run build` (Vite 5) | passes; 123 precache entries, 2114 KiB; `dist` 2.4 MB; one chunk > 500 kB warning (ApexCharts), old |
| Node / npm on this machine | Node 24.22.1, npm 11.6.2 |
| Startup time: dashboard content, 300 expenses, cold profile, headless Chrome, interleaved A/B, 12 runs | OLD Vite build median 580 ms (504-687); NEW Nuxt build (Phase 1) 563 ms (539-669) |

Reference project (read-only): `C:\Users\HP\Documents\GitHub\QuranApp` (Nuxt 4 + Prisma 7.10.1 + Better Auth 1.7.16). Pins to reuse exactly:
`nuxt ^4.6.1`, `prisma`/`@prisma/client`/`@prisma/adapter-pg` **7.10.1** (a bare `npm install prisma` installs an 8.0 release candidate),
`better-auth 1.7.16`, `zod 4.6.7`, `pg 8.23.1`, `cloudinary 2.11.0`, `@vite-pwa/nuxt ^1.1.0`, `vitest ^4.1.11`, `@playwright/test ^1.58.0`,
`eslint ^9.39.2`, `@nuxt/eslint ^1.12.1`, `@axe-core/playwright ^4.14.0`, `typescript ^5.9.0`.

## 1. Everything the browser stores today (must survive the cutover unchanged)

The cutover is on the same origin as the current app, so an existing user opens the new app and finds their data. No key, format, database name or
version below may change.

### localStorage (all through `src/utils/storage.js`, prefix `hisaab:`)

| Key | Owner module | Shape | Sync class |
|---|---|---|---|
| `hisaab:meta` | `utils/startup.js`, `migrations.js` | `{ version: 3, ... }` | **device-only** (per-device data version) |
| `hisaab:applock` | `useAppLock` | `{ passwordHash, salt, createdAt }` | **device-only, never leaves the device** |
| `hisaab:settings` | `useSettings` | object (currency, cycleResetDay, theme, budgets, last/default account ids ...) | **synced** except `theme` (device-only override, see DECISIONS D14) |
| `hisaab:categories` | `useCategories` | array | synced: one record per category |
| `hisaab:expenses` | `useExpenses` | array (`receipts[]` metadata inside) | synced: one record per expense; receipt metadata flattened to `receipt` records |
| `hisaab:income` | `useIncome` | array | synced: one record per income |
| `hisaab:recurring` | `useRecurring` | array | synced: one record per template |
| `hisaab:bills` | `useBills` | `{ connections[], bills[] }` | synced: `billConnection` + `bill` records; `bill.attachments` (files stay on the device) is **device-only** |
| `hisaab:meterReadings` | `useMeterReadings` | array | synced: one record per reading |
| `hisaab:assets` | `useAssets` | array | synced: one record per asset |
| `hisaab:lending` | `useLending` | array of loans, each with `repayments[]` | synced: `loan` + `repayment` (parent = loan) records |
| `hisaab:investments` | `useInvestments` | array of funds with `contributions[]`, `withdrawals[]`, `valueEntries[]` | synced: `fund` + `fundContribution` + `fundWithdrawal` + `fundValue` records (parent = fund) |
| `hisaab:accounts` | `useAccounts` | `{ accounts[], transfers[], adjustments[] }` | synced: `account`, `transfer`, `correction` records |
| `hisaab:vehicles`, `hisaab:vehicleLogs`, `hisaab:fuelLogs`, `hisaab:vehicleTags` | vehicle composables | arrays | synced: one record each |
| `hisaab:goals` | `useGoals` | array with `savings[]` | synced: `goal` + `goalSaving` records |
| `hisaab:vault` | `useVault` | encrypted object (ciphertext, salt, iv ...) | synced **as an opaque ciphertext singleton**; the passphrase never leaves the device |
| `hisaab:ui:sidebarOpen` | `useSidebar` | boolean | **device-only** |
| `hisaab:corrupt:<key>` | `storage.get()` (preserved unreadable copies) | raw text | **device-only** |

New keys the migration adds (all additive, all device-only unless stated): `hisaab:sync:*` (sync state, see section 5) in **IndexedDB**, not localStorage;
`hisaab:auth:hint` (last known signed-in user, device-only).

### sessionStorage
| Key | Owner | Class |
|---|---|---|
| `hisaab:session-unlocked` | `useAppLock` | device-only (screen-lock session flag) |

### IndexedDB (names and versions are frozen; never opened at another version)
| Database | Version | Store | Owner | Holds | Sync class |
|---|---|---|---|---|---|
| `hisaab-attachments` | 1 | `files` (keyPath `id`) | `utils/attachments.js` | bill attachments (`billId`) and expense receipts (`expenseId`, `kind: 'receipt'`) | bill files: **device-only**; receipts: **synced to Cloudinary** when signed in (Phase 6); guest mode keeps them here |
| `hisaab-backups` | 1 | `snapshots` (keyPath `id`) | `utils/snapshots.js` | safety snapshots (latest 5, no files, no app-lock) | **device-only** |

New IndexedDB (own name, version 1): `hisaab-sync` (sync state: per-user cache, base copies, outbox, upload queue). It never touches the two above.

## 2. Page-by-page migration (22 screens: 21 routes + the lock screen)

Offline level: **A** = must work fully offline in guest and signed-in mode (no server call needed to render or edit);
**B** = works offline from the local copy, and syncs when online; **C** = needs the network (shows a clear offline state).

| Route | View file | Level | Notes |
|---|---|---|---|
| `/` | redirect to `/dashboard` | A | |
| `/dashboard` | `DashboardView` | B | net worth, insights, recurring confirm |
| `/expenses` | `ExpensesView` | B | receipts: local in guest mode; in an account they upload when online (offline = outbox) |
| `/income` | `IncomeView` | B | |
| `/accounts`, `/accounts/:id` | `AccountsView`, `AccountDetailView` | B | |
| `/net-worth` | `NetWorthView` | B | derived, never stored |
| `/goals` | `GoalsView` | B | |
| `/bills`, `/bills/meters/:connectionId` | `BillsView`, `MeterReadingView` | B | attachments stay on the device (the page says so) |
| `/recurring` | `RecurringView` | B | |
| `/categories` | `CategoriesView` | B | |
| `/budget` | `BudgetView` | B | |
| `/vault` | `VaultView` | B | encrypted in the browser; plain warning that a lost passphrase cannot be recovered |
| `/assets` | `AssetsView` | B | |
| `/investments`, `/investments/:id` | `InvestmentsView`, `FundDetailView` | B | |
| `/vehicles`, `/vehicles/:id` | `VehiclesView`, `VehicleDetailView` | B | |
| `/lending`, `/lending/:id` | `LendingView`, `LoanDetailView` | B | |
| `/settings` | `SettingsView` | A | gains the Account area; backup/restore stays local |
| (lock screen) | `LockView` | A | device-only screen lock |
| NEW `/account` | `AccountView` | C | sign in/up, profile, delete account |
| NEW `/admin/*` | admin pages | C | super admin only; 404 to everyone else |

Unknown paths still redirect to `/dashboard`. `/#/path` is redirected to `/path` once at startup (old bookmarks and the installed PWA).

## 3. Target architecture (summary; reasons in DECISIONS.md)

- Nuxt 4 SPA (`ssr: false`), `app/` source dir. The proven pure code stays JavaScript and keeps its relative imports by keeping the same
  folder names (`app/utils`, `app/composables`, `app/components`, `app/views`); routes come from the existing route table through the
  `pages:extend` hook, so route names, paths and titles do not change. New code is TypeScript (`app/lib/**`, `server/**`).
- `app/plugins/00.startup.client.ts` runs `prepareData()` (migration + snapshot + auth hint) **before** any composable module is imported
  (composables read storage when first imported), exactly like `src/main.js` does today.
- PWA: `@vite-pwa/nuxt`, same file name `sw.js`, scope `/`, manifest `id: "/"`, `registerType: "prompt"`, the existing "A new version is available" toast.
  `navigateFallbackDenylist: [/^\/api\//]` so the worker never touches `/api/`.
- Server: Nitro routes under `server/api/**` (JSON everywhere, unknown `/api/*` = JSON 404), Prisma 7.10.1 over `pg`, Better Auth 1.7.16,
  Cloudinary 2.11.0, zod 4.6.7. Everything behind `NUXT_PUBLIC_SYNC_ENABLED` (off in a build until the owner turns it on).

## 4. Postgres schema (Prisma, document-record design)

```
model SyncDoc {                       // one row per record
  userId     String                   // owner (from the session, never from the request)
  collection String                   // allow-listed: "expense", "fund", "fundContribution", ...
  id         String                   // the record's own id (the app's generated id)
  data       Json?                    // the validated record (zod per collection); null when deleted
  version    Int                      // the record's own counter, +1 per accepted write
  revision   BigInt                   // user-wide change cursor (from SyncCursor), drives pull
  updatedAt  DateTime                 // server time, never the client's
  deletedAt  DateTime?                // tombstone: a delete is never a row removal
  bytes      Int
  parentId   String?                  // fundId / loanId / expenseId / goalId / ... for flattened children
  // projection columns, filled by the SERVER from the validated record (what the admin reports on; the admin never reads `data`)
  dayKey      String?                 // 'YYYY-MM-DD', attached by the CLIENT (its local day), validated by the server; never derived from a time zone
  amountMinor BigInt?                 // integer minor units (amount * 100, rounded)
  kind        String?                 // expense | refund | income source | loan direction | bill status | ...
  categoryId  String?
  accountId   String?
  @@id([userId, collection, id])
  @@index([userId, revision])
  @@index([collection, dayKey])
  @@index([userId, collection, dayKey])
}
model SyncCursor { userId @id, revision BigInt, bytes Int }     // per-user revision counter, locked FOR UPDATE inside each push
model AuditLog   { id, at, actorId, action, targetType, targetId, summary Json /* before/after summary, no notes */ }
// Receipts are NOT a separate table: a receipt is a SyncDoc in collection "receipt" (parentId = the expense id, sizeBytes = file size; data holds publicId, mime type, name), so it syncs, tombstones and is counted like every other record. The file itself is private on Cloudinary.
// Better Auth models: User (+ role "user"|"superadmin", avatarPublicId, avatarVersion, disabled), Session, Account, Verification, RateLimit
```

Money is stored as integer minor units only in the projection columns; `data` keeps the app's own record exactly as the browser has it.
All monthly and yearly admin totals group by `dayKey` (`left(dayKey, 7)` / `left(dayKey, 4)`): the server never calls a date function on a timestamp.

## 5. Sync collections (flattened so two devices never overwrite each other)

`settings` (singleton, no `theme`), `category`, `expense`, `receipt`, `income`, `recurring`, `billConnection`, `bill`, `meterReading`, `asset`,
`loan`, `repayment`, `fund`, `fundContribution`, `fundWithdrawal`, `fundValue`, `account`, `transfer`, `correction`, `vehicle`, `vehicleLog`,
`fuelLog`, `vehicleTag`, `goal`, `goalSaving`, `vault` (opaque ciphertext singleton).

- **Adapters** read the localStorage value, change one record, and write the WHOLE value back (unknown fields and today's shapes survive).
- **Merge** is a three-way, field-level merge per record using a stored base copy (IndexedDB `hisaab-sync`); a stale push is refused by the server
  (`baseRevision`), the device pulls, merges and pushes again. Client clocks are never compared. Pushes are idempotent (same op twice = same result).
- **Deletes are tombstones**; Undo of a delete re-creates the record (same id) and the tombstone is superseded by the newer revision.
- **First sign-in** never merges automatically: offer "Upload this device's data to my account" (snapshot first, Undo) or "Start with my account's data".
- **Per-user cache**: signed-in data is cached per user id (own namespace in `hisaab-sync`), never mixed with guest data in `hisaab:*`.
  Signed in, the storage wrapper routes the app's keys to the user's cache; guest mode is byte-for-byte today's behaviour.
- A test fails if any localStorage key is neither classified `synced` nor `device-only` (`tests/syncInventory`).

## 6. Risks (and the mitigation planned)

1. **Existing data at cutover.** Same origin, same keys, same IndexedDB names/versions; a test restores a real full backup made by the OLD app; migration keeps its snapshot-first rule.
2. **Module-load order.** Composables read localStorage at import; the startup plugin must finish before the first composable import (dynamic import after `prepareData`).
3. **Nuxt auto-imports colliding with the pure code** (generic export names such as `get`/`set`): disable directory auto-scan for `app/utils` and `app/composables`; keep explicit imports.
4. **Service worker scope/identity** must stay `sw.js` at `/` so the new worker replaces the old one; `/api/` never handled by it.
5. **Hash to path URLs** (old bookmarks / installed PWA): one-time redirect at startup, tested.
6. **ApexCharts** is client-only: a small wrapper component, no SSR use (the app is SPA anyway).
7. **Time safety:** local-day and cycle rules unchanged; the server never computes a day; day keys come from the client and are validated by form AND real calendar date.
8. **Data loss in sync:** tombstones, idempotent pushes, snapshot before "upload my data", never an automatic merge, per-user cache.
9. **Secrets:** nothing in the repo; `.env` is gitignored and is never opened or printed; no secret in `runtimeConfig` at build time.
10. **Tests reaching real services:** forbid-real-services Playwright helper, blank credentials in Vitest, unreachable `DATABASE_URL` for test servers; live checks only by hand, only against the TEST database, only after a database-name safety check.
11. **Aiven TLS:** `sslmode=require` is verify-full in pg 8.23; the project CA is passed through `DATABASE_CA_CERT` / `DATABASE_CA_FILE` and checks are never turned off.
12. **Cloudinary limits:** free-plan per-file size cap (10 MB images, 100 MB raw) is enforced client-side with a clear message; receipts are private with signed, short-lived URLs.
13. **Admin privacy:** admin reads projection columns only; notes, receipt images, bill attachments, vault and password data are unreachable by design and by test.
14. **Environment of this machine:** `.env` currently has only `CLOUDINARY_URL`, `DATABASE_URL`, `NUXT_PUBLIC_SYNC_ENABLED`; `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_CA_CERT`/`FILE` and the two `ADMIN_SEED_*` values are missing, so some live checks may have to be skipped and reported (see HISAAB_PROGRESS.md).

## 7. Order of work

0. Plan + baseline (this file). 1. Nuxt foundation, no behaviour change. 2. Repo rules and test harness (ESLint, Vitest, Playwright, `npm run verify`, `CLAUDE.md`).
3. Server foundation (Prisma schema + migration, db client with Aiven TLS, `/api/health`, flag, JSON errors, repository interface).
4. Accounts (Better Auth, roles, rate limiting, seed script, Account area, profile photo). 5. Sync (driver, adapters, merge, engine, outbox, first-sign-in choice,
status UI, two-device test). 6. Receipts on Cloudinary. 7. Admin panel. 8. Hardening and handover (authorization tests, security review, axe, performance, `docs/DEPLOY.md`, final verify).
Each phase ends with its checks, a docs update and a commit; no phase starts before the previous one passes.
