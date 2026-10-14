/**
 * Format price with thousand separators (commas) and 2 decimal places
 * @param {number|string} price - The price to format
 * @returns {string} Formatted price string (e.g., "1,234.56")
 */
export const formatPrice = (price) => {
  if (!price && price !== 0) return '0.00'
  const num = typeof price === 'string' ? parseFloat(price) : price
  if (isNaN(num)) return '0.00'
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Format price with currency symbol
 * @param {number|string} price - The price to format
 * @param {string} currency - Currency code (USD, EUR, ILS)
 * @returns {string} Formatted price with currency symbol (e.g., "$1,234.56")
 */
export const formatPriceWithCurrency = (price, currency = 'USD') => {
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
  return `${currencySymbol}${formatPrice(price)}`
}
