import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import axios from 'axios'
import { formatPriceWithCurrency } from '../utils/priceFormatter'

/**
 * Display-currency context for cost views.
 *
 * All costs in the backend are stored in USD. This context lets a page pick a
 * display currency (USD / ILS / EUR) and exposes `formatCost(usdAmount)`,
 * which converts using the cached USD-based exchange rate and formats it with
 * the right symbol. Components rendered outside a provider fall back to USD,
 * so shared components keep their existing behavior elsewhere in the app.
 */

export const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$', label: 'Dollar' },
  { code: 'ILS', symbol: '₪', label: 'Shekel' },
  { code: 'EUR', symbol: '€', label: 'Euro' },
]

const STORAGE_KEY = 'menteebom_bom_cost_currency'

const loadStoredCurrency = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return SUPPORTED_CURRENCIES.some(c => c.code === stored) ? stored : 'USD'
  } catch {
    return 'USD'
  }
}

const saveStoredCurrency = (code) => {
  try {
    localStorage.setItem(STORAGE_KEY, code)
  } catch {
    // localStorage unavailable — the choice just won't be remembered
  }
}

const defaultValue = {
  currency: 'USD',
  rate: 1,
  loading: false,
  error: null,
  setCurrency: () => {},
  convert: (usd) => usd,
  formatCost: (usd) => formatPriceWithCurrency(usd, 'USD'),
}

const CurrencyContext = createContext(defaultValue)

export const CurrencyProvider = ({ children }) => {
  const [currency, setCurrencyState] = useState(loadStoredCurrency)
  const [rates, setRates] = useState({ USD: 1 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Fetch the USD -> target rate on demand (the backend caches it and refreshes stale rates)
  useEffect(() => {
    if (currency === 'USD' || rates[currency]) return
    let cancelled = false
    setLoading(true)
    setError(null)
    axios.get('/api/currency/convert', { params: { amount: 1, from: 'USD', to: currency } })
      .then(res => {
        if (cancelled) return
        const rate = res.data?.converted_amount
        if (res.data?.success && rate > 0) {
          setRates(prev => ({ ...prev, [currency]: rate }))
        } else {
          setError(res.data?.error || `No exchange rate available for ${currency}`)
        }
      })
      .catch(err => {
        if (cancelled) return
        setError(err.response?.data?.error || `Failed to load exchange rate for ${currency}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [currency, rates])

  const setCurrency = useCallback((code) => {
    if (!SUPPORTED_CURRENCIES.some(c => c.code === code)) return
    setError(null)
    setCurrencyState(code)
    saveStoredCurrency(code)
  }, [])

  // Until a rate is available, keep showing USD so we never mislabel amounts
  const activeCurrency = rates[currency] ? currency : 'USD'
  const rate = rates[activeCurrency]

  const value = useMemo(() => ({
    currency,
    activeCurrency,
    rate,
    loading,
    error,
    setCurrency,
    convert: (usd) => (Number(usd) || 0) * rate,
    formatCost: (usd) => formatPriceWithCurrency((Number(usd) || 0) * rate, activeCurrency),
  }), [currency, activeCurrency, rate, loading, error, setCurrency])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export const useCurrency = () => useContext(CurrencyContext)
