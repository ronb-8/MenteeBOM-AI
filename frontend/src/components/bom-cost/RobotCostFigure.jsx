import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import RobotFigure from '../robot-assembly/RobotFigure'
import { formatPrice } from '../../utils/priceFormatter'

const RobotCostFigure = ({ config, badgeId, selectedLimb, onLimbClick, selectedItemKeys = [] }) => {
  // Build limbMeta for cost-specific overlays
  const limbMeta = useMemo(() => {
    if (!config?.limbs) return {}

    const meta = {}
    for (const limb of config.limbs) {
      const items = limb.assigned_items || []
      const hasAssigned = items.length > 0
      const totalCost = limb.total_cost || 0

      // Build keys for each assigned item to check selection
      const itemKeys = items.map(it =>
        it.type === 'dissolved' ? `dissolved-${it.dissolved_bom_id}` : `bom-${it.bom_id}`
      )
      const hasSelectedItems = itemKeys.some(k => selectedItemKeys.includes(k))

      meta[limb.id] = {
        showLabel: hasAssigned,
        label: hasAssigned ? `$${formatPrice(totalCost)}` : null,
        tooltip: hasAssigned
          ? `${limb.name} — $${formatPrice(totalCost)} (${items.length} item${items.length > 1 ? 's' : ''})`
          : `${limb.name} — No BOMs assigned`,
        tintColor: hasSelectedItems
          ? 'rgba(46, 125, 50, 0.15)'
          : hasAssigned
            ? 'rgba(46, 125, 50, 0.08)'
            : 'rgba(150, 150, 150, 0.06)',
        strokeColor: hasAssigned
          ? 'rgba(46, 125, 50, 0.35)'
          : 'rgba(150, 150, 150, 0.2)',
      }
    }
    return meta
  }, [config, selectedItemKeys])

  if (!config) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography color="text.secondary" variant="body2">
          No robot configuration found for this project.
          <br />
          Set one up in Admin &gt; BOM Cost Robot.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <RobotFigure
        config={config}
        badgeId={badgeId}
        selectedLimb={selectedLimb}
        onLimbClick={onLimbClick}
        limbMeta={limbMeta}
      />
    </Box>
  )
}

export default RobotCostFigure
