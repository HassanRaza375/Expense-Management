export function formatCurrency(amount, symbol = '₨') {
  const value = Number(amount) || 0
  const formatted = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  const sign = value < 0 ? '-' : ''
  return `${sign}${symbol} ${formatted}`
}

export function parseAmount(input) {
  const n = parseFloat(String(input).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}
