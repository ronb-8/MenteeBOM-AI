import { Box, Card, CardContent, Typography } from '@mui/material'
import AttachMoneyIcon from '@mui/icons-material/AttachMoney'
import ListAltIcon from '@mui/icons-material/ListAlt'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import { formatPrice } from '../../utils/priceFormatter'

const MetricCard = ({ icon: Icon, label, value, color = 'primary.main', subtitle }) => (
  <Card
    variant="outlined"
    sx={{
      flex: '1 1 200px',
      minWidth: 180,
      borderLeft: 3,
      borderLeftColor: color,
    }}
  >
    <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Icon sx={{ fontSize: 18, color }} />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {subtitle && (
        <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
      )}
    </CardContent>
  </Card>
)

const CostSummaryCards = ({ totalCost = 0, bomCount = 0, limbCount = 0, topLimb = null }) => {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
      <MetricCard
        icon={AttachMoneyIcon}
        label="Total Cost"
        value={`$${formatPrice(totalCost)}`}
        color="primary.main"
      />
      <MetricCard
        icon={ListAltIcon}
        label="BOMs Selected"
        value={bomCount}
        color="info.main"
      />
      <MetricCard
        icon={AccountTreeIcon}
        label="Limbs Configured"
        value={limbCount}
        color="success.main"
      />
      {topLimb && (
        <MetricCard
          icon={TrendingUpIcon}
          label="Most Expensive Limb"
          value={topLimb.name}
          subtitle={`$${formatPrice(topLimb.cost)}`}
          color="warning.main"
        />
      )}
    </Box>
  )
}

export default CostSummaryCards
