# Hisaab — Product Documentation

**A personal, offline-first expense ledger.**
> **Note (Nuxt migration):** the app is now a Nuxt 4 SPA and its source lives in `app/` (it was `src/`); routes come from `app/lib/routes.ts`. Sections below that say Vite, `src/`, `vite.config.js` or `main.js` describe the original build. Current structure and reasons: `docs/NUXT_PLAN.md`, `docs/DECISIONS.md`, `HISAAB_PROGRESS.md`.

Vue 3 (Composition API) + Vite · Tailwind CSS + shadcn-vue · vue-router · ApexCharts · localStorage only · No backend, no sync, single user.

> **Build status:** all 12 modules below are implemented and running. This doc was written as the up-front spec; it's left as-is except for a few inline notes flagging where the build diverges, plus two revisions layered on after the initial build (a shadcn-vue/Tailwind redesign, then route-based navigation + a responsive/mobile layout). **See [§16](#16-implementation-status) for the full status list, including three known gaps** where behavior doesn't yet match this spec.

---

## 1. Overview

| | |
|---|---|
| **Purpose** | Track daily/household expenses, recurring bills, budgets (overall + per category), and keep a private vault of personal financial info and owned assets — entirely on one device. |
| **Currency** | PKR (₨) |
| **Budget cycle** | Resets on the **6th** of each month (configurable in Settings) |
| **Data storage** | Browser `localStorage`, one JSON-serialized key per module |
| **Users** | One (you) |
| **Theme** | Light/dark, manual toggle, persisted |

### 1.1 Tech stack

- **Vue 3** — Composition API, `<script setup>` SFCs
- **Vite** — dev server + build
- **Tailwind CSS v4** (`@tailwindcss/vite`) — utility styling; the Ledger palette/type tokens from [§13](#13-design-system--ledger) are expressed as CSS variables and mapped into Tailwind's `@theme`, so the design system is unchanged, just implemented differently than originally planned
- **shadcn-vue-style primitives** (hand-built, not the CLI) on top of **reka-ui** — `Button`, `Input`, `Select`, `Dialog`, `Card`, `Badge`, `Progress`, `Switch`, `Checkbox`, `Tabs`, `Sonner` toasts, in `src/components/ui/`. *(Revision — original plan was plain scoped CSS; swapped in per a follow-up request for a less "custom-built" look and real accessible primitives.)*
- **IndexedDB** — used only by the Bills module, for file attachments (bill images/PDFs/receipts) that don't belong in `localStorage`; metadata about each attachment still lives in `hisaab:bills`.
- **Lucide** (`@lucide/vue`) — all interface icons (nav, buttons, actions). Category icons remain user-picked emoji (data, not chrome).
- **ApexCharts** (`apexcharts` + `vue3-apexcharts`) — donut and trend charts
- **No Vuex/Pinia** — app state is a set of composables, each owning one localStorage key, auto-persisting via `watch(..., { deep: true })`
- **vue-router** (`createWebHashHistory`) — every sidebar destination is a real route (`#/expenses`, `#/budget`, …), deep-linkable and bookmarkable. *(Revision — original plan was a single reactive `currentView` ref with no router; swapped in per a follow-up request for route-based URLs. Hash history was chosen over clean paths specifically because this app has no server to add SPA-fallback rewrite rules for a static deployment.)*
- **Web Crypto API** (`SubtleCrypto`) — used only by the App Lock and Vault modules, for password hashing and Vault encryption respectively. No external crypto library.
- **vite-plugin-pwa** (Workbox `generateSW` mode) — installable PWA: web app manifest, precached app-shell service worker, prompt-to-reload on new deploys. *(Revision — added per a later request; see [§16](#16-implementation-status) item 4.)* Fraunces/IBM Plex Mono/Inter are self-hosted (`src/assets/fonts/`) rather than loaded from the Google Fonts CDN, so the same offline guarantee covers first load, not just repeat visits.

### 1.2 Module map

```
App Lock  →  (Profile) Login  →  Dashboard
                                   ├── Expenses
                                   ├── Bills
                                   ├── Recurring
                                   ├── Categories
                                   ├── Budget
                                   ├── Vault        (separately locked)
                                   ├── Assets
                                   └── Settings
```

### 1.3 Folder structure

**As built** — lives at the repo root rather than a nested `hisaab/` folder (this repo *is* the app), and picked up a `router/`, `lib/`, `components/ui/`, and `useSidebar.js` along the way:

```
Expense-Management/            (repo root — no nested hisaab/ folder)
├── index.html
├── vite.config.js              — includes VitePWA plugin config (manifest + Workbox generateSW)
├── package.json
├── jsconfig.json              — "@/*" → src/ path alias (used throughout components/ui and views)
├── public/                     — NEW: PWA icons (pwa-192/512, maskable-512, apple-touch-icon, favicons)
├── assets-src/                 — NEW: source SVGs the icons above are rasterized from (not shipped)
├── scripts/
│   └── gen-icons.mjs            — NEW: regenerates public/ icon PNGs from assets-src/*.svg via sharp
└── src/
    ├── main.js                 — also registers the service worker (prompt-to-reload flow)
    ├── App.vue                — header/hamburger + sidebar + <RouterView>
    ├── style.css               — Tailwind v4 entry + Ledger palette/type as CSS variables (@theme); imports assets/fonts/fonts.css
    ├── assets/
    │   └── fonts/                — NEW: self-hosted Fraunces/IBM Plex Mono/Inter woff2 files + fonts.css
    ├── router/
    │   └── index.js            — NEW: route table, hash history, one route per sidebar destination
    ├── lib/
    │   └── utils.js             — NEW: `cn()` class-merge helper (shadcn-vue convention)
    ├── utils/
    │   ├── storage.js          — localStorage get/set wrapper, versioning
    │   ├── date.js              — cycle math (start/end/days-left given reset day)
    │   ├── currency.js          — ₨ formatting
    │   ├── id.js                — id generator
    │   ├── crypto.js            — hash + AES-GCM encrypt/decrypt helpers
    │   └── attachments.js       — NEW: IndexedDB wrapper for Bills file attachments
    ├── composables/
    │   ├── useAppLock.js
    │   ├── useSettings.js
    │   ├── useCategories.js
    │   ├── useExpenses.js
    │   ├── useBills.js          — exports both useConnections() and useBills(), one storage key
    │   ├── useRecurring.js
    │   ├── useBudget.js         — derived, no own storage key
    │   ├── useVault.js
    │   ├── useAssets.js
    │   ├── useSidebar.js        — NEW: sidebar open/closed state — desktop dock persisted to localStorage, mobile drawer is session-only
    │   └── useInstallPrompt.js  — NEW: wraps `beforeinstallprompt`/`appinstalled`, backs the Settings "Install app" control
    ├── components/
    │   ├── ui/                  — NEW: hand-built shadcn-vue-style primitives (button, input, label, textarea, select, card, badge, progress, switch, checkbox, dialog, tabs, sonner) on reka-ui
    │   ├── CycleRail.vue
    │   ├── StatCard.vue
    │   ├── DonutChart.vue
    │   ├── TrendChart.vue
    │   ├── ExpenseFormModal.vue
    │   ├── RecurringConfirmCard.vue
    │   ├── ConnectionFormModal.vue  — NEW: Bills connection-profile add/edit
    │   ├── BillWizard.vue           — NEW: Bills step-by-step add/edit + attachments
    │   ├── BillPaymentModal.vue     — NEW: Bills "mark paid" flow → linked Expense
    │   ├── BillAttachments.vue      — NEW: per-bill upload/preview/delete (IndexedDB)
    │   ├── MaskedField.vue      — tap-to-reveal for Vault numbers
    │   └── AppSidebar.vue       — route-link nav; responsive (fixed/overlay on mobile, sticky/collapsible on desktop)
    └── views/
        ├── LockView.vue         — password + profile entry, combined
        ├── DashboardView.vue
        ├── ExpensesView.vue
        ├── BillsView.vue
        ├── RecurringView.vue
        ├── CategoriesView.vue
        ├── BudgetView.vue
        ├── VaultView.vue
        ├── AssetsView.vue
        └── SettingsView.vue
```

---

## 2. Module: App Lock

**Purpose:** A password gate for the whole app, checked once per browser session, before anything else renders.

**Relationship to the Profile screen:** merged into one screen — since there's only one profile and no separate PIN, splitting "enter password" and "tap avatar" into two screens would just add a click for no benefit. `LockView.vue` shows your avatar + name (from Settings) with a password field beneath it; entering the correct password unlocks the whole app in one step. *(Assumption — flag if you'd rather keep these as two separate screens.)*

**Data shape** — `hisaab:applock`
```js
{
  passwordHash,   // derived via PBKDF2-SHA256, stored as base64
  salt,           // random salt, base64
  createdAt
}
```

**Behavior**
- First run: no `hisaab:applock` exists → app prompts "Set a password" instead of "Enter password"
- Every subsequent load: `LockView` shown until the correct password is entered
- On success: an in-memory `isUnlocked` flag flips to `true` and a matching flag is written to `sessionStorage` — so a page refresh doesn't re-lock, but fully closing the browser does
- "Forgot password" has **no recovery path** by design (there's no server to reset it against) — the only options are: restore from a previous unencrypted export (which doesn't help if you forgot the app password itself, since exports aren't gated by it), or clear site data and start over, losing everything not backed up. This is stated plainly in Settings, not hidden.
- Password change available from Settings, requires entering the current password first

**Explicit security note:** like the earlier PIN discussion, this raises the bar against casual access on a shared device but is not real security — the data itself sits in plaintext localStorage (except the Vault module, which is separately encrypted). Anyone with browser dev-tools access can bypass or clear this.

---

## 3. Module: Storage & Data Layer

**Purpose:** Single, versioned, safe interface to `localStorage`. No other module touches `localStorage` directly.

**Responsibilities**
- `get(key, fallback)` / `set(key, value)` — JSON parse/stringify wrapped in try/catch; corrupt data resets that key to its default rather than crashing the app
- `hisaab:meta` — `{ version: 1 }`, a hook for future migrations
- **Two separate export flows**, per earlier decision to keep sensitive data out of routine backups:
  - **Main export** — Settings, Categories, Expenses, Recurring, Budget, Bills → one JSON file. *(Bills joined this list when [§17](#17-module-bills) was added — it's not sensitive like Vault, so it follows Recurring/Budget's precedent rather than Vault/Assets'. Bill attachments are excluded since they live in IndexedDB, not `localStorage`, and aren't portable through a JSON export — stated in the Settings UI.)*
  - **Vault/Assets export** — separate JSON file, Vault portion still encrypted inside it (so this file is safe to store even if the passphrase isn't with it)
- Import validates shape per key before overwriting; shows a preview summary and requires confirmation

**Storage keys**

| Key | Holds | In main backup? | Encrypted? |
|---|---|---|---|
| `hisaab:applock` | password hash + salt | No | Hash only, not reversible |
| `hisaab:settings` | currency, cycle reset day, theme, profile name/avatar | Yes | No |
| `hisaab:categories` | category list | Yes | No |
| `hisaab:expenses` | all expense records | Yes | No |
| `hisaab:recurring` | recurring templates | Yes | No |
| `hisaab:vault` | bank/cards/CNIC/investments | Separate export only | **Yes** (AES-GCM) |
| `hisaab:assets` | owned items | Separate export only | No |
| `hisaab:bills` | connections, bill records, meter readings, payment details | Yes | No |
| IndexedDB (`hisaab-attachments`) | bill images/PDFs/receipts | No — device-local only | No |
| `hisaab:meta` | schema version | No | No |

---

## 4. Module: Categories

**Purpose:** The taxonomy every expense and budget line hangs off.

**Data shape**
```js
{
  id, name, icon, color,
  isDefault,     // true for "Other" — prevents delete, allows rename
  order,
  createdAt
}
```
*(Per-category budget number lives in Module 7, not here — Categories only manages name/icon/color/order.)*

**Defaults on first run:** Food, Bills, Travel, Health/Vitamins, Gym, Shopping, Other.

**Features**
- Add / edit / reorder categories
- **Delete is blocked** if any expense references the category — the UI requires reassigning those expenses to another category first, then the delete completes
- "Other" can be renamed but never deleted

**Validation:** name required, unique (case-insensitive).

---

## 5. Module: Expenses

**Purpose:** The core ledger — every transaction, one row each.

**Data shape**
```js
{
  id, date, amount, categoryId,
  note,
  source,        // 'manual' | 'recurring'
  recurringId,   // set only when source === 'recurring'
  createdAt
}
```

**Features**
- Add: date (defaults today), amount, category, optional note
- Edit / delete any row regardless of source
- Delete shows an **undo toast** rather than a confirm dialog
- **Duplicate** action — for repeat purchases that aren't quite "recurring"
- List grouped by day, newest first, running daily total
- Filters: category, date range, cycle (this/last/custom)
- Search by note text
- Bulk select + delete

**Validation:** amount > 0; category must exist (falls back to "Other" if its category was deleted before this expense was created).

---

## 6. Module: Recurring Expenses

**Purpose:** Predictable spend (rent, gym, vitamins) that **prompts for confirmation** rather than posting silently.

**Data shape**
```js
{
  id, name, categoryId,
  amountMode,          // 'fixed' | 'variable'
  amount,              // used when amountMode === 'fixed'
  dueDay,              // 1–31, clamps to last day of short months
  leadDays,            // days before dueDay to start prompting (default 0)
  endDate,             // optional — stops prompting after this date
  active,
  lastConfirmedCycle,  // cycle-start date it was last actioned for
  createdAt
}
```

**Behavior**
1. On app load, compute the current cycle (see Module 7's date logic).
2. For each `active` template where `today >= dueDay - leadDays` within the current cycle and `lastConfirmedCycle !== currentCycleStart` → **pending**.
3. Pending items show as dismissible cards: **Add** / **Skip this cycle** / **Snooze**.
   - **Add** (fixed) → creates an Expense row immediately, stamps `lastConfirmedCycle`.
   - **Add** (variable) → opens a small amount field first ("How much was the electricity bill?"), then creates the Expense.
   - **Skip** → stamps `lastConfirmedCycle` without creating an expense.
   - **Snooze** → no stamp, re-prompts next load.
4. Items past their `endDate` stop generating prompts entirely (kept for history, not deleted).

**Features:** add/edit/pause/delete templates; history of add-vs-skip per cycle; Recurring page sorted by soonest due date.

**Edge cases:** `dueDay` > days in current month clamps to the month's last day; editing amount only affects future confirmations, never past expense rows.

---

## 7. Module: Budget

**Purpose:** Turn raw expenses into "how am I doing" for the current cycle. **Derived module** — reads Expenses/Categories/Settings, writes only the overall budget number and per-category budget numbers (both live in Settings-adjacent storage, not their own key).

**Cycle math** (`utils/date.js`)
```js
function getCycle(date, resetDay) {
  const day = date.getDate()
  const start = day >= resetDay
    ? new Date(date.getFullYear(), date.getMonth(), resetDay)
    : new Date(date.getFullYear(), date.getMonth() - 1, resetDay)
  const end = new Date(start.getFullYear(), start.getMonth() + 1, resetDay - 1)
  return { start, end }
}
```

**Computations**
- `cycleSpent` = sum of expenses within `[start, end]`
- `overallRemaining = overallBudget - cycleSpent`
- Per category: `spent`, `budget`, `remaining`, `percentUsed`
- Status color: `<80%` → good, `80–100%` → warn, `>100%` → over (the only place "red ink" appears — see design system)
- **Rollover toggle** — unused budget either carries into next cycle's `overallBudget` or resets; explicit setting, since it changes the math
- **Threshold alerts** — a banner/toast at 80% and 100% of overall or any single category

**Features:** edit overall budget; edit per-category budgets (this is the one editing surface for those, per your earlier decision); progress bars sorted by percent-used descending.

---

## 8. Module: Dashboard

**Purpose:** Landing view — "where do I stand right now," at a glance.

**Contents**
- **Cycle Rail** (signature element, see design system) — fill = days elapsed, marker = today, ticks = upcoming recurring due dates, turns to "over budget" red only if cycle spend exceeds the overall budget before cycle end
- Stat cards: Spent this cycle, Remaining, Days left, Pending recurring count
- **Safe-to-spend-per-day** = `overallRemaining ÷ daysLeftInCycle` — the single most actionable number
- Biggest single expense this cycle, top category by spend
- Category donut (ApexCharts) + daily trend bar chart (ApexCharts)
- Cycle-over-cycle comparison (this cycle vs last, % change)
- Pending recurring confirmations surfaced at the top when present
- First-run empty state (no data yet) — a real designed state, not a blank grid

---

## 9. Module: Vault (Bank / Cards / CNIC / Investments)

**Purpose:** A private reference sheet for financial identity info — not transactions, just secure-ish lookup.

**Encryption:** this module gets its own passphrase, independent of the App Lock password.
1. On first use, you set a Vault passphrase.
2. A key is derived from it via `PBKDF2` (`SubtleCrypto.deriveKey`), never stored itself.
3. All Vault data is encrypted with **AES-GCM** using that derived key before being written to `hisaab:vault`.
4. Opening the Vault view prompts for the passphrase; data is decrypted into memory only for that unlocked session and re-locks on leaving the view or closing the tab.

**Data shape** (plaintext shape, before encryption)
```js
{
  bankAccounts: [{ id, bankName, accountTitle, accountNumber, iban, branch }],
  cards: [{ id, network, nickname, last4, expiry }],
  cnic: { number, expiry, issuingInfo },
  investments: [{ id, type, name, amountInvested, currentValue, notes }]
}
```

**Masking:** account numbers, full card numbers, and the CNIC number render masked (`•••• •••• •••• 4521`) by default; a tap-to-reveal shows the full value briefly, then re-masks (`MaskedField.vue`).

**Backup:** excluded from the main export; has its own **separate, still-encrypted** export — safe to store even without the passphrase attached.

---

## 10. Module: Assets ("Things I own")

**Purpose:** Simple inventory of owned items and their value over time.

**Data shape**
```js
{
  id, name, category,     // electronics | vehicle | furniture | jewelry | appliance | other
  purchaseDate, purchasePrice,
  currentValue,           // manual only, no auto-depreciation
  warrantyExpiry,
  serialNumber,
  notes,
  createdAt
}
```

**Features:** add/edit/delete items; sort/filter by category or by warranty expiring soon; total owned value (sum of `currentValue`) shown as a summary stat.

**Backup:** not encrypted, but bundled with the Vault's separate export rather than the main one.

---

## 11. Module: Settings

**Purpose:** Configuration + data safety net.

**Contents**
- Profile name/avatar (used on the Lock screen)
- App password (set/change)
- Currency symbol (default ₨)
- Cycle reset day (default 6)
- Theme toggle
- Category management entry point (name/icon/color/order only)
- Budget management entry point (overall + per category numbers)
- Rollover on/off (Module 7)
- **Backup — main:** export/import JSON (Categories, Expenses, Recurring, Budget, Settings)
- **Backup — Vault/Assets:** separate export/import, Vault portion stays encrypted in the file
- CSV export (expenses only) alongside JSON, for opening in Excel/Sheets
- Storage usage indicator (KB used, rough sense of headroom)
- Danger zone: reset all data, requires typing a confirmation phrase

---

## 12. Module: Theme

**Purpose:** Light/dark toggle applied via a `data-theme` attribute + CSS variables — no per-component branching.

**Behavior:** toggle in sidebar footer; persists to `hisaab:settings.theme`; defaults to dark on first run; no auto system-detection (manual only, per your choice); respects `prefers-reduced-motion` for the Cycle Rail fill and chart entrance animations.

---

## 13. Design System — "Ledger"

**Grounding:** the cycle resets on the 6th, not the 1st — worth designing around, not hiding. Palette references real bookkeeping history: pale-green ledger paper (easy on the eyes for long numeric columns) and red ink reserved strictly for losses ("in the red") — so red never appears decoratively in this app, only when something is over budget.

### Colors

| Role | Dark | Light |
|---|---|---|
| Background | `#12161C` | `#EDF1EA` |
| Surface | `#1A2029` | `#FFFFFF` |
| Surface-alt | `#212A33` | `#F5F7F2` |
| Border | `#2B3640` | `#DCE3D8` |
| Text | `#E7ECEF` | `#1B2420` |
| Text-dim | `#8FA0AC` | `#5C6B62` |
| Accent (Ledger Ink) | `#4A9498` | `#2E6E72` |
| Under budget | `#5FAE86` | `#3F8563` |
| Near limit | `#D6963A` | `#B9791F` |
| Over budget ("red ink") | `#D9695F` | `#C1544A` |

### Typography

| Role | Face | Where |
|---|---|---|
| Display | Fraunces | Big totals, page headings |
| Data/tabular | IBM Plex Mono | Every amount, so figures align in columns |
| UI/body | Inter | Nav, labels, buttons, notes |

### Signature element — Cycle Rail
Horizontal rail spanning the real cycle (e.g. 6 Jul–5 Aug): fill = days elapsed, marker = today, ticks = upcoming recurring due dates, turns red-ink only on overspend. One deliberate moment of visual boldness; everything else stays quiet and scannable.

**Implemented.** The full app now runs against this system (not just a Lock + Dashboard preview) — colors and type are wired in as Tailwind `@theme` variables (`src/style.css`) so every shadcn-vue-derived component (buttons, dialogs, inputs, charts) inherits the same palette automatically instead of being styled one-off. Chart theming (ApexCharts tooltip/legend colors) follows the live `light`/`dark` value from Settings rather than being hardcoded.

---

## 14. Known constraints & accepted risks

- **No real security anywhere** — App Lock and Vault passphrase both raise friction, not cryptographic guarantees against someone with dev-tools access to the same browser profile.
- **No password recovery** — by design, since there's no server. Forgetting the App Lock password or Vault passphrase means resetting that module's data.
- **localStorage size limits** — typically 5–10MB per origin depending on browser; the Storage module's usage indicator (Settings) is the early warning, no hard enforcement built beyond that.
- **Single browser, single device** — no sync. Backups are the only way to move data between devices.

---

## 15. Open items for next pass — resolved

- ~~Confirm the Lock screen merge (password + profile in one screen)~~ → **kept merged**, built as `LockView.vue` per the original assumption; no pushback received.
- ~~Vault UI details (add/edit forms for each sub-section)~~ → **built**: inline add-forms under each of Bank accounts / Cards / CNIC / Investments, `MaskedField.vue` tap-to-reveal, passphrase gate separate from App Lock.
- ~~Assets list/detail layout not yet wireframed~~ → **built** as a card grid (not a list+detail split) — one card per asset with edit/delete inline; category + warranty-expiry sort/filter.

---

## 16. Implementation status

Everything in modules 2–12 and 17 (Bills) is built and wired to real `localStorage`-backed composables (Bills also uses IndexedDB for file attachments) — this section tracks the handful of places where behavior diverges from the spec above, plus the three revisions layered on after the initial build. Bills has its own scope-trim list inline at the end of [§17](#17-module-bills) rather than repeated here.

### Known gaps vs. this spec

- **Budget threshold alerts ([§7](#7-module-budget)) — computed, not surfaced.** `useBudget.js` builds an `alerts` array (80%/100% breaches, overall or per-category) but no banner/toast currently reads it. The Budget page's progress-bar colors *do* reflect status (good/warn/over), so the information is visible — just not as the proactive banner/toast the spec describes.
- **Rollover ([§7](#7-module-budget)) — setting exists, math doesn't run automatically.** The toggle is wired (`settings.rollover`, editable from Budget) and `useBudget.js` has an `applyRollover()` function, but nothing calls it on cycle transition yet. Today the toggle has no visible effect.
- **Recurring add-vs-skip history ([§6](#6-module-recurring-expenses)) — not viewable.** Each template stores only its latest `lastConfirmedCycle` stamp, not a log of past cycles' add/skip decisions. The behavior (pending → Add/Skip/Snooze) works; there's just no history screen yet.

### UI revisions (post-initial-build, both by request)

1. **Component library swap.** Original build used hand-written scoped CSS (`.btn`, `.card`, `.field` utility classes) per this doc. Replaced with Tailwind CSS v4 + hand-built shadcn-vue-style primitives on `reka-ui` (chosen over Vuetify specifically to preserve this doc's bespoke Ledger palette/typography rather than adopt Material Design), and emoji-as-UI-icons swapped for Lucide (`@lucide/vue`) everywhere except category icons, which stay emoji because they're user-chosen data.
2. **Routing + responsive layout.** Original build switched views via a single `currentView` ref ([§1.1](#11-tech-stack)) with no URLs and no mobile consideration. Added `vue-router` (hash history, one route per sidebar item) and a responsive `AppSidebar` — a persistent hamburger toggle in the header collapses/expands the sidebar; the collapsed/expanded state is saved to `localStorage` and survives reloads on desktop, while on mobile the same control opens an overlay drawer that closes on navigation or backdrop tap (kept session-only, not persisted, since a drawer that reopens over the whole screen on every load would be worse UX than remembering a desktop preference).
3. **Bills module added.** Not part of the original spec pass — added per a later request, documented fully in [§17](#17-module-bills). Picked up a `Tabs` primitive (`components/ui/tabs/`, on `reka-ui`) and `utils/attachments.js` (IndexedDB) along the way; both listed in [§1.1](#11-tech-stack) and [§1.3](#13-folder-structure).
4. **PWA conversion.** Added `vite-plugin-pwa` (Workbox `generateSW` mode): a web app manifest (`public/manifest.webmanifest`, generated at build) with a Ledger-palette "Rs" icon in the required sizes (192/512/maskable-512/apple-touch/favicons — sourced from `assets-src/*.svg`, rasterized by `scripts/gen-icons.mjs`), and a precaching service worker covering the full app shell (JS/CSS/HTML/fonts/icons). Update strategy is `registerType: 'prompt'` — `main.js` calls `registerSW()` and surfaces a "Reload" action via the existing `vue-sonner` toast (same pattern as the Expenses undo-delete toast) rather than auto-swapping the app under the user. Fraunces/IBM Plex Mono/Inter moved from the Google Fonts CDN to self-hosted woff2 files (`src/assets/fonts/`, latin subset only) so the app is installable and fully offline from the first load, not just repeat visits — this doubles as the fix for the CDN dependency called out nowhere else in this doc but present in the original `index.html`. `useInstallPrompt.js` wraps the `beforeinstallprompt`/`appinstalled` events; Settings ([§11](#11-module-settings)) shows an "Install app" card when the browser reports the app is installable, or an "installed" note when running in standalone display mode.


---

## 17. Module: Bills

**Purpose:** A complete utility bill management system that complements the Expenses module. Bills are tracked independently, and when a bill is paid, a linked Expense is created automatically.

### Features

- Bills dashboard
- Connection profiles
- Up to **2 Electricity meters**
- Gas & Water meter tracking
- Bill images and PDF support
- Payment receipt storage
- Automatic expense creation
- Automatic expense synchronization
- Analytics
- Advanced search & filters
- Duplicate bill detection
- Step-by-step bill wizard

### Bill Types

- Electricity
- Gas
- Water
- Internet
- Mobile
- Rent
- Other

### Connection Profiles

Every utility has a reusable connection profile.

```js
{
  id,
  connectionName,
  provider,
  billType,
  consumerNumber,
  referenceNumber,
  accountNumber,
  meterNumber,
  active
}
```

Electricity supports **two independent meters**, each with its own history.

### Bill Record

```js
{
  id,
  internalBillId,
  providerBillNumber,
  connectionId,
  billingMonth,
  issueDate,
  dueDate,
  amount,
  arrears,
  status,
  paidDate,
  paidBy,
  paymentMethod,
  transactionReference,
  linkedExpenseId
}
```

### Meter Readings

For Electricity, Gas and Water:

- Previous Reading (auto-filled)
- Current Reading
- Units Used (calculated)
- Meter Number

Previous Reading automatically comes from the previous month's bill.

### Attachments

Supports:
- Bill Front
- Bill Back
- PDF Bill
- Payment Receipt (optional)

Metadata is stored in `localStorage`; files are stored in **IndexedDB**.

### Payment

Supported methods:

- Cash
- Bank Transfer
- Easypaisa
- JazzCash
- Debit Card
- Credit Card
- Cheque
- Other

When marked **Paid**:

- Creates an Expense automatically.
- Links Bill ↔ Expense.
- Future edits automatically update the linked Expense.

### Statuses

- Draft
- Awaiting Bill
- Unpaid
- Paid
- Overdue
- Cancelled

### Dashboard

- Outstanding Amount
- Bills Due This Month
- Paid This Month
- Unpaid Bills
- Overdue Bills
- Recent Bills

### Analytics

- Monthly spending
- Utility consumption
- Highest bill
- Average bill
- Spending by bill type
- Month-over-month comparison

### Search & Filters

- Bill Type
- Connection
- Provider
- Billing Month
- Status
- Paid By
- Payment Method
- Due Date
- Amount
- Attachments

### Storage

| Storage | Contents |
|---|---|
| `hisaab:bills` | Bills, connections, meter readings, payment details |
| IndexedDB | Images, PDFs, payment receipts |

### Future Enhancements

- OCR bill reading
- AI bill parsing
- Smart meter integration

### Implementation notes

**Built:** connection profiles (with the 2-meter electricity cap enforced on create/edit), the full Bill Record shape, meter readings with auto-filled previous reading and live-calculated units used, a 4-step wizard (Connection & Period → Details → Meter Reading [skipped for non-metered types] → Review, with attachment upload surfaced immediately after the bill is saved), hard duplicate-bill blocking (same connection + billing month), a dedicated "Mark Paid" flow that creates the linked Expense and re-syncs its amount on later edits, the Dashboard stat row, and file attachments via a hand-rolled IndexedDB wrapper (`utils/attachments.js`) with metadata in `hisaab:bills`. Bills also now ride along in the main JSON backup ([§3](#3-module-storage--data-layer)) — attachments don't, since IndexedDB blobs aren't portable through a JSON export; that's stated in the Settings UI, not hidden.

**Scope trims vs. this spec:**
- **Overdue** isn't a stored status — it's derived (`unpaid` + past due date), same pattern as Recurring's "pending" computation, rather than a background job flipping the field.
- **Search & filters** implemented: Bill Type, Connection, Status, and free-text search (connection name / provider bill number / notes). Not implemented as separate controls: Provider, Paid By, Payment Method, Due Date range, Amount range, Attachments-present — those fields exist and are visible on each bill, just not filterable yet.
- **Analytics** implemented: highest bill, average bill, month-over-month %, spending-by-type donut, 6-month spending trend. **Not implemented:** the "utility consumption" (units-used-over-time) chart — per-bill units used is calculated and stored, just not charted yet.
- **Expense category** isn't part of the Bill Record — it's chosen at the "Mark Paid" step (defaulting to the existing "Bills" category) and lives on the resulting Expense, same as everywhere else category assignment happens in this app.
- **Automatic expense synchronization** is one-directional: editing a paid bill's amount pushes to its linked Expense. Editing the Expense doesn't push back to the Bill, and unmarking a bill as paid doesn't delete or unlink the Expense (avoids silently destroying financial history).

