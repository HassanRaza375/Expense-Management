# Pages added with accounts

All of these exist only while `NUXT_PUBLIC_SYNC_ENABLED` is on in the build. With it off there is no Account or Admin entry and `/api/*` answers 404 (except `/api/health`).

## Account (`/account`, and the Account card in Settings)
Sign up, sign in (email and password; Google and email links appear only when their keys are set), sign out (works offline; asks first if changes have not reached the account), name, password, profile photo with a square crop,
and "Delete account" (type your email; a backup file is downloaded first because it becomes the only copy). The first sign-in on a device with data offers: upload this device's data (with Undo) or start with the account's data.
One sentence on the page says what the service owner can see (see below). Settings also holds the Sync card (status, retry, pending receipts, remote receipt clean-up).

## Admin (`/admin/*`, super admins only)
Anyone else (signed out, ordinary user, disabled account) is sent to the dashboard, and `/api/admin/*` answers `404 {"error":"not_found"}`; the sidebar shows "Admin" only to a super admin.
- **Overview:** users, super admins, disabled, synced in the last 7 days, records, stored bytes, expenses by month for the last 12.
- **Users:** search name or email, filter by role and status, 25 per page. **User:** edit name, email, role, disabled; send a password-reset email (503 while email is not set up); delete with the typed email; the user's own totals.
- **Expenses, Investments, Income & cash flow:** totals by month, year and category from projection columns, for everyone or one user (`?userId=`). Months are grouped by the day key the browser computed.
- **Receipts & storage:** counts and bytes per user, never an image or a file name.
- **Audit log:** every admin change (who, what, when, before and after of name, email, role, disabled), 50 per page.
Guards: no demoting, disabling or deleting yourself; the last super admin is protected; deleting removes rows and Cloudinary files; disabling signs the user out at once.

## What the service owner can see
Amounts, dates and categories (to compute totals), counts and sizes of receipts, and account details (email, name, role, state). Never notes, receipt files or names, attachments, the Vault (encrypted in the browser, only ciphertext is stored) or passwords.
