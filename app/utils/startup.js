import { get, set, STORAGE_KEYS } from './storage.js'
import { runMigrations, MIGRATIONS, CURRENT_SCHEMA_VERSION } from './migrations.js'
import { saveSnapshot } from './snapshots.js'
import { applyBackup } from './backup.js'

// Any stored app data besides the version marker itself and the preserved-corrupt copies.
function hasStoredData() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('hisaab:') && key !== 'hisaab:meta' && !key.startsWith('hisaab:corrupt:')) return true
  }
  return false
}

function describe(outcome) {
  if (outcome.status === 'too-new') {
    return `This data was saved by a newer version of Hisaab (data version ${outcome.from}; this copy understands up to ${outcome.to}). Nothing was changed. Update the app (reload the page, and if this message stays, clear the cached app) and try again.`
  }
  if (outcome.status === 'failed') {
    const tail = outcome.restored
      ? ' Your data was restored from the automatic safety snapshot taken just before.'
      : outcome.snapshotTaken === false
        ? ' No data was changed.'
        : ' Restoring the snapshot also failed: open Settings later and use the safety snapshots, or restore your last backup file.'
    return `Hisaab could not update your saved data to the latest version, so it did not start. (${outcome.error || outcome.reason})${tail}`
  }
  return ''
}

/**
 * Run BEFORE the app (and therefore the composables that read storage) loads. Returns the migration outcome plus
 * `blocked` (the app must not start) and a `message` to show. `migrations` is injectable for tests.
 */
export async function prepareData({ migrations = MIGRATIONS, target = CURRENT_SCHEMA_VERSION } = {}) {
  const outcome = await runMigrations({
    readVersion: () => {
      const meta = get(STORAGE_KEYS.META, null)
      return meta === null ? null : meta?.version
    },
    writeVersion: (version) => {
      const meta = get(STORAGE_KEYS.META, null)
      if (!set(STORAGE_KEYS.META, { ...(meta && typeof meta === 'object' ? meta : {}), version })) throw new Error('Could not write the data version (browser storage may be full).')
    },
    hasData: hasStoredData,
    snapshot: (reason) => saveSnapshot(reason),
    restore: (snap) => applyBackup({ data: snap.backup.data, attachments: [] }, { restoreAttachments: false }),
    migrations,
    target,
  })
  const blocked = outcome.status === 'too-new' || outcome.status === 'failed'
  return { ...outcome, blocked, message: blocked ? describe(outcome) : '' }
}
