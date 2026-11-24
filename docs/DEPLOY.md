# Deploying Hisaab with accounts (the owner's steps)

Nothing in this file has been done for you. Everything up to now ran against a TEST database and a test Cloudinary folder (`hisaab-test`); production has never been touched.
The assistant that built this never merged, pushed to `main`, deployed, or ran anything against production. These steps are yours, in this order.

**The safe default:** with `NUXT_PUBLIC_SYNC_ENABLED` unset or `0` the app is the guest app you already use: nothing calls the server, there is no Account entry and no Admin entry,
and `/api/*` answers 404 (except `/api/health`). You can deploy this version with the flag off and nothing changes for anyone.

## 1. The environment variables

Set these in Vercel (Project, Settings, Environment Variables) for the **Production** environment. Give **Preview** a TEST database and a different Cloudinary folder, never the production ones.
Never put a secret in a variable whose name starts with `NUXT_PUBLIC_` (that prefix publishes the value to every browser).

| Variable | Secret | Needed when | Where | What it is |
|---|---|---|---|---|
| `NUXT_PUBLIC_SYNC_ENABLED` | no | always | **Build and runtime** | `1` turns accounts on, anything else (or unset) is off. It is baked into the prerendered page shell, so **it must be set before the build you want it on in**; changing it needs a redeploy (rebuild). |
| `DATABASE_URL` | **yes** | flag on | runtime | The Aiven PostgreSQL connection string for the **production** database. Optional `?schema=name` puts the tables in that schema (the live checks use `hisaab_test`). |
| `DATABASE_CA_CERT` | no (public cert) | flag on | runtime | Aiven's project CA, as the PEM text (Vercel accepts multi-line values). Certificate checks are never turned off. Use this on Vercel. |
| `DATABASE_CA_FILE` | no | alternative | local only | A path to the same CA as a file, for your own machine. Do not use on Vercel. |
| `BETTER_AUTH_SECRET` | **yes** | flag on | runtime | At least 32 random characters (for example `openssl rand -hex 32`). **Do not reuse the test one.** Changing it signs everyone out. Without it every account route answers 503. |
| `BETTER_AUTH_URL` | no | flag on | runtime | The site's public address, for example `https://hisaab.example.com` (no trailing slash). It is also the only trusted origin. |
| `CLOUDINARY_URL` | **yes** | receipts and photos | runtime | `cloudinary://key:secret@cloud_name`. Alternative: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Without it, photo and receipt uploads answer 503 and everything else works. |
| `CLOUDINARY_FOLDER` | no | optional | runtime | The root folder (default `hisaab`). Files live under `<folder>/u/<userId>/...`. Production and tests must not share a folder. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **yes** | optional | runtime | Turns on "Continue with Google". Redirect URI to register: `<BETTER_AUTH_URL>/api/auth/callback/google`. Off until both are set. |
| `RESEND_API_KEY`, `EMAIL_FROM` | **yes** / no | optional | runtime | Turns on every email feature (verify address, reset password, the admin's reset email). Off until both are set; the Account page says so. |
| `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD` | **yes** | once | **your own shell only** | Read only by `scripts/seed-super-admin.mjs`. **Never set these in Vercel.** The password needs at least 12 characters. |

`NODE_ENV=production` (set by Vercel) switches the session cookie to `Secure`. The host must forward the client's address in `x-forwarded-for` (Vercel does): Better Auth's own
sign-in limits use it. The API limits for signed-in accounts do **not** use an address; they count per account.

## 2. The order

1. **Back up your real data first.** In the browser you use today: Settings, "Export full backup" (with attachments). Keep that file somewhere safe. The new version stamps data version 3 on first start
   and takes an automatic snapshot, but an old copy of the app will refuse the newer data, so a file you can restore from is your real rollback.
2. **Create the production database** on Aiven (a new database, or a new schema; do not reuse the one the live checks use). Download the project CA certificate from the Aiven console.
3. **Apply the migration to production**, from your own machine (the app never migrates itself):
   1. Save the CA as a file, for example `C:\secrets\aiven-ca.pem`.
   2. Set `DATABASE_URL` for this shell only to the production URL **with** `sslmode=verify-full&sslrootcert=C:\secrets\aiven-ca.pem` added to its query string (this is for Prisma's own migration engine).
   3. Run `npx prisma migrate deploy`. It applies `prisma/migrations/*` (the init migration creates `SyncDoc`, `SyncCursor`, `AuditLog`, the Better Auth tables and `RateLimit`). It is safe to run twice.
   4. Clear the variable. (`scripts/live/migrate-test.mjs` does the same for the TEST database and is the proof the method works with certificate verification on.)
4. **Create the super admin** (once per database), from the same machine, with the production `DATABASE_URL` and `DATABASE_CA_FILE` set for this shell only:
   PowerShell:
   ```
   $env:ADMIN_SEED_EMAIL = "you@example.com"
   $env:ADMIN_SEED_PASSWORD = "a-long-passphrase-of-12-or-more"
   node scripts/seed-super-admin.mjs
   Remove-Item Env:ADMIN_SEED_EMAIL, Env:ADMIN_SEED_PASSWORD
   ```
   It prints "created" or "updated" and neither value. Run it again any time to repair the account or set a new password. Nobody can become a super admin any other way: the role cannot be set by any request.
5. **Set the Vercel variables** from the table, Production only. Leave `NUXT_PUBLIC_SYNC_ENABLED` **unset (off)** for now.
6. **Deploy with the flag off** and use the app as you always have. Nothing should look different. `GET /api/health` answers `{"ok":true,"sync":false,"database":"not_checked"}`.
7. **Turn accounts on:** set `NUXT_PUBLIC_SYNC_ENABLED=1` (Production) and **redeploy so the build runs with it**. `GET /api/health` must now answer `{"ok":true,"sync":true,"database":"up"}`.
   If it says `down` or `unconfigured`, fix the database variables; do not tell anyone to sign up yet.
8. **Check it by hand:** sign in as the super admin (Account page; the sidebar gains "Admin"); create a second ordinary account in a private window and confirm it has no Admin entry and
   that `/admin` takes it to the dashboard; on the first sign-in the dialog offers to upload this device's data; attach a receipt and open it from a second device (a PDF too: Cloudinary's PDF delivery
   setting is an account setting that was not verified for your real account); sign out and in again.
9. **Back out, if you need to:** set the flag back to `0` and redeploy. Guest data on every device is untouched; the accounts and their data stay in the database.

## 3. What the owner can see (and the app says so)

The panel shows account totals computed from amounts, dates and categories the browser sends alongside each record, plus counts and byte sizes of receipts. It never reads notes, receipt files or names,
attachments, the Vault (which is encrypted in the browser; the server holds only ciphertext it cannot read) or passwords. Every admin change is in the audit log (`/admin/audit`). The Account and Settings
pages tell account holders this in one sentence.

## 4. Limits worth knowing

- Per account: 25 MB of records, 200 operations and 1 MB per sync push, a size cap per record, 5 receipts per expense, 10 MB per receipt (guest mode keeps 15 MB), a 512 KB profile photo.
- API budget per signed-in account per minute (HTTP 429 with `Retry-After` when spent): 600 requests in all; 90 sync pushes; 180 pulls; 40 receipt uploads; 120 receipt links; 6 receipt clean-ups; 12 photo changes;
  60 admin changes; 5 account deletions per 10 minutes. The counters are rows in the `RateLimit` table, so every serverless instance shares them. If that table cannot be reached the request goes ahead (logged by error code only).
- Sign-in, sign-up and password routes have Better Auth's own, stricter limits per address.

## 5. When something goes wrong

- Every API error is JSON; an unexpected one is `{"error":"server_error"}` and the log line holds only the error's name and short code, never a message, address or record.
- `503 unavailable` on account routes: the database or `BETTER_AUTH_SECRET` is not configured. `503` on photo/receipt routes: Cloudinary is not configured.
- A deleted user whose Cloudinary folder could not be cleaned: the audit entry (`user.delete`, `files: "failed"`) names the folder to delete by hand.
- Remove test data: the live checks clean up after themselves and refuse to run against anything that does not look like a test database.
