import { get, set, remove, getRaw, setRaw, STORAGE_KEYS } from './storage.js'
import { getAllAttachments, putAttachment } from './attachments.js'

// ---------------------------------------------------------------------------
// Hisaab backup format
//
//   {
//     app: 'hisaab',
//     kind: 'hisaab-full-backup',
//     formatVersion: 1,        // layout of this file
//     schemaVersion: 1,        // version of the stored data (meta.version) it was taken from
//     exportedAt: ISO string,
//     counts: { expenses: 120, ... },   // used to detect truncated/edited files
//     data: { settings, categories, expenses, ... },  // null = key did not exist
//     attachments?: [{ id, billId, kind, filename, mimeType, size, data: <base64> }]
//   }
//
// Legacy files (`hisaab-main-backup`, `hisaab-vault-assets-backup`) are still accepted.
// The app-lock password record is deliberately NOT part of any backup.
// ---------------------------------------------------------------------------

export const BACKUP_APP = 'hisaab'
export const BACKUP_KIND = 'hisaab-full-backup'
export const BACKUP_FORMAT_VERSION = 1
export const CURRENT_SCHEMA_VERSION = 1

const LEGACY_MAIN_KIND = 'hisaab-main-backup'
const LEGACY_VAULT_KIND = 'hisaab-vault-assets-backup'

const MAX_ISSUES_PER_MODULE = 5

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isValidDate(v) {
  return typeof v === 'string' && !Number.isNaN(new Date(v).getTime())
}

// Item-level checks. These only produce WARNINGS: the app tolerates a lot of oddities and a
// validator stricter than the app must never be able to block restoring your own data.
function checkDatedAmounts(items) {
  const issues = []
  items.forEach((item, i) => {
    if (!isPlainObject(item)) return
    if (typeof item.amount !== 'number' || !Number.isFinite(item.amount)) issues.push(`entry ${i + 1} has a non-numeric amount`)
    else if (!isValidDate(item.date)) issues.push(`entry ${i + 1} has an invalid date`)
  })
  return issues
}

function checkFunds(items) {
  const issues = []
  items.forEach((fund, i) => {
    if (!isPlainObject(fund)) return
    if (!Array.isArray(fund.contributions) || !Array.isArray(fund.valueEntries)) {
      issues.push(`fund ${i + 1} is missing its contributions or value entries list`)
    }
  })
  return issues
}

export const BACKUP_MODULES = [
  { key: STORAGE_KEYS.SETTINGS, label: 'Settings', shape: 'object' },
  { key: STORAGE_KEYS.CATEGORIES, label: 'Categories', shape: 'array' },
  { key: STORAGE_KEYS.EXPENSES, label: 'Expenses', shape: 'array', check: checkDatedAmounts, uniqueIds: true },
  { key: STORAGE_KEYS.INCOME, label: 'Income', shape: 'array', check: checkDatedAmounts, uniqueIds: true },
  { key: STORAGE_KEYS.RECURRING, label: 'Recurring', shape: 'array' },
  { key: STORAGE_KEYS.BILLS, label: 'Bills', shape: 'bills' },
  { key: STORAGE_KEYS.METER_READINGS, label: 'Meter readings', shape: 'array' },
  { key: STORAGE_KEYS.ASSETS, label: 'Assets', shape: 'array' },
  { key: STORAGE_KEYS.LENDING, label: 'Lending', shape: 'array' },
  { key: STORAGE_KEYS.INVESTMENTS, label: 'Investments', shape: 'array', check: checkFunds },
  { key: STORAGE_KEYS.VEHICLES, label: 'Vehicles', shape: 'array' },
  { key: STORAGE_KEYS.VEHICLE_LOGS, label: 'Maintenance logs', shape: 'array' },
  { key: STORAGE_KEYS.FUEL_LOGS, label: 'Fuel logs', shape: 'array' },
  { key: STORAGE_KEYS.VEHICLE_TAGS, label: 'Vehicle tags', shape: 'array' },
  { key: STORAGE_KEYS.VAULT, label: 'Vault (encrypted)', shape: 'object' },
]

const MODULE_BY_KEY = Object.fromEntries(BACKUP_MODULES.map((m) => [m.key, m]))

function itemCount(value, mod) {
  if (value === null || value === undefined) return null
  if (mod.shape === 'array') return Array.isArray(value) ? value.length : null
  if (mod.shape === 'bills') return Array.isArray(value?.bills) ? value.bills.length : null
  return null
}

function describe(value, mod) {
  if (value === null || value === undefined) return 'empty'
  if (mod.key === STORAGE_KEYS.VAULT) return 'present'
  if (mod.key === STORAGE_KEYS.SETTINGS) return 'present'
  if (mod.shape === 'bills') {
    const bills = Array.isArray(value?.bills) ? value.bills.length : 0
    const connections = Array.isArray(value?.connections) ? value.connections.length : 0
    return `${bills} bills, ${connections} connections`
  }
  return String(itemCount(value, mod) ?? 0)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function toBase64(bytes) {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function fromBase64(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function exportAttachments() {
  const entries = await getAllAttachments()
  const out = []
  for (const e of entries) {
    if (!e || !e.blob) continue
    const bytes = new Uint8Array(await e.blob.arrayBuffer())
    out.push({
      id: e.id,
      billId: e.billId,
      kind: e.kind,
      filename: e.filename,
      mimeType: e.mimeType,
      size: e.size,
      data: toBase64(bytes),
    })
  }
  return out
}

export async function buildBackup({ includeAttachments = false } = {}) {
  const data = {}
  const counts = {}
  for (const mod of BACKUP_MODULES) {
    const value = get(mod.key, null)
    data[mod.key] = value
    const n = itemCount(value, mod)
    if (n !== null) counts[mod.key] = n
  }
  const backup = {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: get(STORAGE_KEYS.META, { version: CURRENT_SCHEMA_VERSION })?.version ?? CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    data,
  }
  if (includeAttachments) backup.attachments = await exportAttachments()
  return backup
}

// ---------------------------------------------------------------------------
// Parse + validate
//
// parseBackup never touches storage. It returns:
//   { ok, errors: string[], warnings: string[], backup }
// `backup` (only when ok) is normalized to { kind, legacy, formatVersion, schemaVersion,
// exportedAt, data, attachments } where `data` only contains keys the file actually carries.
// ---------------------------------------------------------------------------

export function parseBackup(text) {
  const errors = []
  const warnings = []
  const fail = (msg) => ({ ok: false, errors: [...errors, msg], warnings, backup: null })

  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('This file is not valid JSON.')
  }
  if (!isPlainObject(raw)) return fail('This file is not a Hisaab backup (expected a JSON object).')

  let kind = raw.kind
  let legacy = false
  let data = {}

  if (kind === BACKUP_KIND) {
    if (raw.app !== undefined && raw.app !== BACKUP_APP) return fail(`This backup belongs to another app ("${raw.app}").`)
    if (!Number.isInteger(raw.formatVersion) || raw.formatVersion < 1) return fail('Backup is missing a valid format version.')
    if (raw.formatVersion > BACKUP_FORMAT_VERSION) {
      return fail(`This backup was made by a newer version of Hisaab (format ${raw.formatVersion}). Update the app and try again.`)
    }
    if (Number.isInteger(raw.schemaVersion) && raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
      return fail(`This backup uses a newer data version (${raw.schemaVersion}) than this app understands (${CURRENT_SCHEMA_VERSION}). Update the app and try again.`)
    }
    if (!isPlainObject(raw.data)) return fail('Backup has no "data" section.')
    data = raw.data
  } else if (kind === LEGACY_MAIN_KIND || kind === LEGACY_VAULT_KIND) {
    legacy = true
    warnings.push('This is an older-style Hisaab backup file. It will import, but only the modules it contains.')
    for (const mod of BACKUP_MODULES) {
      if (raw[mod.key] !== undefined) data[mod.key] = raw[mod.key]
    }
  } else {
    return fail('This file is not a Hisaab backup (unrecognised "kind").')
  }

  // Unknown keys: ignore, but say so.
  const unknown = Object.keys(data).filter((k) => !MODULE_BY_KEY[k])
  if (unknown.length) warnings.push(`Ignoring unknown sections: ${unknown.join(', ')}.`)

  // Normalize: only known keys; legacy `null` means absent.
  const normalized = {}
  for (const mod of BACKUP_MODULES) {
    if (!(mod.key in data)) continue
    const value = data[mod.key]
    if (value === null || value === undefined) {
      if (!legacy) normalized[mod.key] = null // full backup: "this key was empty/absent"
      continue
    }
    const problem = structuralProblem(value, mod)
    if (problem) {
      errors.push(`${mod.label}: ${problem}`)
      continue
    }
    normalized[mod.key] = value

    const issues = []
    if (mod.check) issues.push(...mod.check(value))
    if (mod.uniqueIds) {
      const seen = new Set()
      let dupes = 0
      for (const item of value) {
        if (isPlainObject(item) && item.id !== undefined) {
          if (seen.has(item.id)) dupes++
          seen.add(item.id)
        }
      }
      if (dupes) issues.push(`${dupes} entries share an id with another entry`)
    }
    issues.slice(0, MAX_ISSUES_PER_MODULE).forEach((i) => warnings.push(`${mod.label}: ${i}`))
    if (issues.length > MAX_ISSUES_PER_MODULE) warnings.push(`${mod.label}: and ${issues.length - MAX_ISSUES_PER_MODULE} more issues`)
  }

  if (!legacy && isPlainObject(raw.counts)) {
    for (const mod of BACKUP_MODULES) {
      const expected = raw.counts[mod.key]
      const actual = itemCount(normalized[mod.key], mod)
      if (typeof expected === 'number' && actual !== null && expected !== actual) {
        warnings.push(`${mod.label}: file says ${expected} entries but contains ${actual}. It may have been edited or truncated.`)
      }
    }
  }

  let attachments = []
  if (raw.attachments !== undefined) {
    if (!Array.isArray(raw.attachments)) {
      errors.push('Attachments: expected a list.')
    } else {
      attachments = raw.attachments.filter((a) => isPlainObject(a) && typeof a.id === 'string' && typeof a.data === 'string')
      const dropped = raw.attachments.length - attachments.length
      if (dropped) warnings.push(`Attachments: ${dropped} unreadable entries will be skipped.`)
    }
  }

  if (!errors.length && Object.keys(normalized).length === 0 && attachments.length === 0) {
    errors.push('This backup does not contain any data.')
  }

  if (errors.length) return { ok: false, errors, warnings, backup: null }

  return {
    ok: true,
    errors: [],
    warnings,
    backup: {
      kind,
      legacy,
      formatVersion: legacy ? 0 : raw.formatVersion,
      schemaVersion: Number.isInteger(raw.schemaVersion) ? raw.schemaVersion : 1,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : null,
      data: normalized,
      attachments,
    },
  }
}

function structuralProblem(value, mod) {
  if (mod.shape === 'array') {
    if (!Array.isArray(value)) return 'expected a list.'
    if (value.some((item) => !isPlainObject(item))) return 'contains entries that are not records.'
    return null
  }
  if (mod.shape === 'bills') {
    if (!isPlainObject(value)) return 'expected an object with bills and connections.'
    for (const field of ['bills', 'connections']) {
      if (value[field] !== undefined && !Array.isArray(value[field])) return `"${field}" must be a list.`
    }
    return null
  }
  if (!isPlainObject(value)) return 'expected an object.'
  return null
}

// ---------------------------------------------------------------------------
// Preview + apply
// ---------------------------------------------------------------------------

// Rows for the confirmation dialog: what the file carries vs what is on this device now.
export function summarizeBackup(backup) {
  const rows = []
  for (const mod of BACKUP_MODULES) {
    if (!(mod.key in backup.data)) continue
    rows.push({
      key: mod.key,
      label: mod.label,
      incoming: describe(backup.data[mod.key], mod),
      current: describe(get(mod.key, null), mod),
    })
  }
  return rows
}

// Replaces every module present in the backup. All-or-nothing for stored data: if any write
// fails (e.g. storage quota) everything written so far is rolled back to the previous raw values.
// Attachments are added/overwritten by id afterwards; existing ones are never deleted.
export async function applyBackup(backup, { restoreAttachments = true } = {}) {
  const keys = BACKUP_MODULES.map((m) => m.key).filter((k) => k in backup.data)
  const previous = new Map(keys.map((k) => [k, getRaw(k)]))
  const written = []

  try {
    for (const key of keys) {
      const value = backup.data[key]
      if (value === null) {
        remove(key)
      } else if (!set(key, value)) {
        throw new Error(`Could not write "${MODULE_BY_KEY[key].label}" (browser storage may be full).`)
      }
      written.push(key)
    }
  } catch (err) {
    for (const key of written) {
      const raw = previous.get(key)
      try {
        if (raw === null) remove(key)
        else setRaw(key, raw)
      } catch {
        // best effort — the pre-import snapshot is the real safety net
      }
    }
    throw err
  }

  let restoredAttachments = 0
  let failedAttachments = 0
  if (restoreAttachments) {
    for (const a of backup.attachments || []) {
      try {
        const blob = new Blob([fromBase64(a.data)], { type: a.mimeType || 'application/octet-stream' })
        await putAttachment({ id: a.id, billId: a.billId, kind: a.kind, filename: a.filename, mimeType: a.mimeType, size: a.size, blob })
        restoredAttachments++
      } catch {
        failedAttachments++
      }
    }
  }

  return { replaced: written, restoredAttachments, failedAttachments }
}
