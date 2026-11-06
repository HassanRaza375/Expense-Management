// ---------------------------------------------------------------------------
// Data-version migrations (Phase 2.0). Pure: no storage, no Vue; everything it touches is injected, so it is fully
// testable. `src/utils/startup.js` wires it to localStorage, the safety snapshots and the backup restore.
//
// RULES
//  * `meta.version` is the data version. Missing meta + no stored data = a fresh install (stamped with the current
//    version, no snapshot). Missing meta + stored data = an existing user at version 1.
//  * A version NEWER than this app knows is never touched: status 'too-new', nothing is written (downgrade protection).
//  * Before any pending step runs, a safety snapshot is taken. If the snapshot cannot be taken and a pending step
//    `rewrites` existing data, nothing runs. (Additive steps may proceed without one.)
//  * Steps run in order and must be IDEMPOTENT. The version stamp is written LAST. If any step (or the stamp) fails,
//    the snapshot is restored automatically and the version is NOT stamped.
//  * Version 1 -> 2 is a stamp only: accounts (Phase 2) are purely additive, so no existing record is rewritten.
// ---------------------------------------------------------------------------

export const CURRENT_SCHEMA_VERSION = 2

export const MIGRATIONS = [
  {
    from: 1,
    to: 2,
    name: 'v2: accounts-ready (version stamp, no data rewritten)',
    rewrites: false,
    async up() {
      // Nothing to change: the accounts store, `accountId` on records and the account settings are all optional and
      // absent until used. Stamping the version lets older apps refuse newer backups instead of dropping accounts.
    },
  },
]

/**
 * @param readVersion  () => raw meta.version (null/undefined when there is no meta)
 * @param writeVersion (n) => void   (throws on failure)
 * @param hasData      () => boolean  any stored app data besides meta
 * @param snapshot     (reason) => Promise<snapshot>   (may throw)
 * @param restore      (snapshot) => Promise<void>
 * @returns { status: 'ok' | 'up-to-date' | 'too-new' | 'failed', from, to, applied[], fresh?, snapshotTaken?, reason?, error?, restored? }
 */
export async function runMigrations({ readVersion, writeVersion, hasData, snapshot, restore, migrations = MIGRATIONS, target = CURRENT_SCHEMA_VERSION } = {}) {
  let raw
  try {
    raw = readVersion()
  } catch (err) {
    return { status: 'failed', reason: 'unreadable-version', error: err?.message || String(err), applied: [], to: target }
  }

  let current
  if (raw === null || raw === undefined) {
    if (!hasData()) {
      try {
        writeVersion(target)
      } catch (err) {
        return { status: 'failed', reason: 'stamp-failed', error: err?.message || String(err), applied: [], to: target }
      }
      return { status: 'ok', from: null, to: target, applied: [], fresh: true, snapshotTaken: false }
    }
    current = 1
  } else if (Number.isInteger(raw) && raw >= 1) {
    current = raw
  } else {
    return { status: 'failed', reason: 'unreadable-version', error: `The stored data version "${raw}" is not valid.`, applied: [], to: target }
  }

  if (current > target) return { status: 'too-new', from: current, to: target, applied: [] }
  if (current === target) return { status: 'up-to-date', from: current, to: target, applied: [] }

  // Plan the whole chain first, so a gap is detected before anything runs.
  const chain = []
  let version = current
  while (version < target) {
    const step = migrations.find((m) => m.from === version)
    if (!step || !(step.to > version)) return { status: 'failed', reason: 'missing-migration', error: `No migration from data version ${version}.`, from: current, to: target, applied: [] }
    chain.push(step)
    version = step.to
  }
  if (version !== target) return { status: 'failed', reason: 'missing-migration', error: `The migration chain ends at version ${version}, not ${target}.`, from: current, to: target, applied: [] }

  let snap = null
  let snapshotError = null
  try {
    snap = await snapshot('before-migration')
  } catch (err) {
    snapshotError = err
  }
  if (!snap && chain.some((s) => s.rewrites)) {
    return { status: 'failed', reason: 'no-snapshot', error: snapshotError?.message || 'A safety snapshot could not be taken.', from: current, to: target, applied: [], snapshotTaken: false }
  }

  const applied = []
  try {
    for (const step of chain) {
      await step.up()
      applied.push(step.name)
    }
    writeVersion(target) // last
  } catch (err) {
    let restored = false
    let restoreError = null
    if (snap) {
      try {
        await restore(snap)
        restored = true
      } catch (e) {
        restoreError = e?.message || String(e)
      }
    }
    return { status: 'failed', reason: 'step-failed', error: err?.message || String(err), from: current, to: target, applied, snapshotTaken: !!snap, restored, restoreError }
  }
  return { status: 'ok', from: current, to: target, applied, snapshotTaken: !!snap }
}
