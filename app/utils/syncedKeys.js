// The storage keys that travel to the account when signed in (everything else the app stores is device-only). Plain JS on purpose: storage.js imports it, and the
// plain-Node tests load storage.js. tests/syncAdapters.test.ts checks this list is exactly the adapters' keys, and app/lib/sync/inventory.ts classifies every other key.
export const SYNCED_KEYS = [
  'settings',
  'categories',
  'expenses',
  'income',
  'recurring',
  'bills',
  'meterReadings',
  'assets',
  'lending',
  'investments',
  'accounts',
  'vehicles',
  'vehicleLogs',
  'fuelLogs',
  'vehicleTags',
  'goals',
  'vault',
]
