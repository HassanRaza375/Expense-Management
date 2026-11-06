import { transactionsToCsv, localDayKey } from './reporting.js'

/**
 * THE one place a CSV file is produced and downloaded. The Expenses page (what is on screen) and
 * Settings (everything) both call this, so the format (category NAME, kind column, formula-neutralised cells,
 * UTF-8 BOM for Excel) can never drift apart. The CSV text itself comes from the pure, tested
 * `transactionsToCsv` in utils/reporting.js.
 * Returns the number of rows exported.
 */
export function downloadTransactionsCsv(list, { categoryNames = null, now = new Date(), filenamePrefix = 'hisaab-expenses' } = {}) {
  const csv = transactionsToCsv(list, { categoryNames })
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }) // BOM so Excel reads the rupee sign and accents
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filenamePrefix}-${localDayKey(now)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  return (list || []).length
}
