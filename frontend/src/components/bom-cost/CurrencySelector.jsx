import { Box, ToggleButton, ToggleButtonGroup, Typography, CircularProgress } from '@mui/material'
import { SUPPORTED_CURRENCIES, useCurrency } from '../../context/CurrencyContext'

/** Compact USD / ILS / EUR switch for cost views, with the exchange rate in use */
const CurrencySelector = () => {
  const { currency, activeCurrency, rate, loading, error, setCurrency } = useCurrency()

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
        Currency:
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={currency}
        onChange={(e, v) => v && setCurrency(v)}
        aria-label="Display currency"
      >
        {SUPPORTED_CURRENCIES.map(c => (
          <ToggleButton key={c.code} value={c.code} title={c.label} sx={{ py: 0.25, px: 1, fontSize: '0.75rem', textTransform: 'none' }}>
            {c.symbol} {c.code}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {loading && <CircularProgress size={14} />}
      {!loading && error && (
        <Typography variant="caption" color="error.main">
          {error} — showing USD
        </Typography>
      )}
      {!loading && !error && activeCurrency !== 'USD' && (
        <Typography variant="caption" color="text.secondary">
          1 USD = {rate.toFixed(4)} {activeCurrency}
        </Typography>
      )}
    </Box>
  )
}

export default CurrencySelector
