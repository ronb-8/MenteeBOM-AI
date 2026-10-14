/**
 * LimbProcessFlexbox
 * Grid of limb assembly process cards with dynamic stage progress indicators.
 * Similar to ProcessFlexbox but stage labels are dynamic (LL1, LL1.1, LL2, etc.)
 */
import {
  Box,
  Card,
  CardContent,
  CardActionArea,
  Typography,
  Chip,
  CircularProgress,
  useTheme,
  Tooltip,
} from '@mui/material'
import {
  OpenInNew as ExternalLinkIcon,
} from '@mui/icons-material'

const getStatusColor = (status) => {
  switch (status) {
    case 'active': return 'success'
    case 'completed': return 'default'
    case 'cancelled': return 'error'
    default: return 'default'
  }
}

const getPhaseColor = (phase, theme) => {
  switch (phase) {
    case 'completed': return theme.palette.success.main
    case 'picking':
    case 'assembly': return theme.palette.primary.main
    case 'pending': return theme.palette.action.disabled
    case 'skipped': return theme.palette.warning.main
    default: return theme.palette.action.disabled
  }
}

const LimbProcessCard = ({ process, onClick }) => {
  const theme = useTheme()
  const stageStatuses = process.stage_statuses || {}
  const stageLabels = Object.keys(stageStatuses).sort((a, b) => {
    const sa = stageStatuses[a]
    const sb = stageStatuses[b]
    return (sa?.display_order ?? 0) - (sb?.display_order ?? 0)
  })

  // Count completed
  const completedCount = Object.values(stageStatuses).filter(s => s.phase === 'completed').length
  const totalCount = Object.keys(stageStatuses).length

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: process.status === 'active' ? 'primary.main' : 'divider',
        borderWidth: process.status === 'active' ? 1.5 : 1,
        transition: 'border-color 0.2s',
      }}
    >
      <CardActionArea onClick={() => onClick(process)}>
        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
          {/* Header: process number + status */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Typography fontFamily="monospace" fontSize="0.8rem" fontWeight={700} sx={{ flex: 1 }}>
              {process.process_number}
            </Typography>
            <Chip
              label={process.status}
              color={getStatusColor(process.status)}
              size="small"
              sx={{ fontSize: '0.65rem', height: 18 }}
            />
          </Box>

          {/* Limb name */}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {process.limb_name}
          </Typography>

          {/* Stage progress mini-bar */}
          <Box sx={{ display: 'flex', gap: 0.3, mb: 0.5, flexWrap: 'wrap' }}>
            {Object.entries(stageStatuses)
              .sort(([, a], [, b]) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
              .map(([label, info]) => {
                const isSub = label.includes('.')
                return (
                  <Tooltip key={label} title={`${label}: ${info.display_name || info.stage_name} (${info.phase})`}>
                    <Box
                      sx={{
                        height: isSub ? 6 : 8,
                        flex: isSub ? '0 0 auto' : 1,
                        width: isSub ? 16 : undefined,
                        minWidth: 12,
                        borderRadius: 0.5,
                        bgcolor: getPhaseColor(info.phase, theme),
                        opacity: info.phase === 'pending' ? 0.3 : 1,
                      }}
                    />
                  </Tooltip>
                )
              })}
          </Box>

          {/* Stage count */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {completedCount}/{totalCount} stages
            </Typography>
            {process.menteeflow_url && (
              <Tooltip title="Open in MenteeFlow">
                <ExternalLinkIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              </Tooltip>
            )}
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

const LimbProcessFlexbox = ({ processes, loading, onProcessClick }) => {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (!processes || processes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        No limb assembly processes yet.
      </Typography>
    )
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 1,
      }}
    >
      {processes.map((process) => (
        <LimbProcessCard
          key={process.id}
          process={process}
          onClick={onProcessClick}
        />
      ))}
    </Box>
  )
}

export default LimbProcessFlexbox
