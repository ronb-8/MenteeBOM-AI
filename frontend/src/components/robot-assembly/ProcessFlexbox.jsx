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
    case 'on_hold': return 'warning'
    case 'cancelled': return 'error'
    default: return 'default'
  }
}

/**
 * Get stage status from the real stage_statuses map returned by the API.
 * Falls back to inferring from current_stage if stage_statuses not available.
 */
const getStageStatus = (stageKey, process) => {
  const statuses = process.stage_statuses
  if (statuses && statuses[stageKey]) {
    const s = statuses[stageKey]
    if (s === 'completed') return 'completed'
    if (s === 'in_progress') return 'active'
    return 'pending'
  }

  // Fallback: infer from current_stage
  if (process.status === 'completed') return 'completed'
  const rank = { '1': 1, '2': 2, '3.1': 3, '3.2': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9 }
  const stageRank = rank[stageKey] || 0
  if (stageRank < process.current_stage) return 'completed'
  if (stageRank === process.current_stage && process.status === 'active') return 'active'
  return 'pending'
}

const ProcessCard = ({ process, onClick }) => {
  const theme = useTheme()

  return (
    <Card
      sx={{
        width: '100%',
        border: process.status === 'active' ? `1px solid ${theme.palette.primary.main}` : undefined,
      }}
    >
      <CardActionArea onClick={() => onClick(process)}>
        <CardContent sx={{ p: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
            <Typography
              variant="subtitle2"
              fontFamily="monospace"
              fontWeight={700}
              sx={{ fontSize: '0.85rem' }}
            >
              {process.process_number}
            </Typography>
            <Chip
              label={process.status}
              color={getStatusColor(process.status)}
              size="small"
              sx={{ height: 20, fontSize: '0.65rem' }}
            />
          </Box>

          <Typography variant="body2" color="text.secondary" noWrap sx={{ mb: 1 }}>
            {process.name || `${process.limb_name} - ${process.dof_name}`}
          </Typography>

          {/* Mini stage progress: Pick → 3.1∥3.2 → 4(CHE1) → 5 → 6(CHE2) → 7 → 8(CHE3) → 9 */}
          <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5, alignItems: 'center' }}>
            {/* Stages 1 and 2 — linear */}
            {['1', '2'].map((key) => {
              const status = getStageStatus(key, process)
              return (
                <Box
                  key={key}
                  sx={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    bgcolor: status === 'completed'
                      ? 'success.main'
                      : status === 'active'
                        ? 'primary.main'
                        : 'action.disabledBackground',
                    transition: 'background-color 0.3s',
                  }}
                />
              )
            })}

            {/* Parallel fork: 3.1 and 3.2 stacked */}
            <Tooltip title="Motor (3.1) ∥ Gear (3.2) — parallel" arrow placement="top">
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {['3.1', '3.2'].map((key) => {
                  const status = getStageStatus(key, process)
                  return (
                    <Box
                      key={key}
                      sx={{
                        height: 3,
                        borderRadius: 2,
                        bgcolor: status === 'completed'
                          ? 'success.main'
                          : status === 'active'
                            ? 'primary.main'
                            : 'action.disabledBackground',
                        transition: 'background-color 0.3s',
                      }}
                    />
                  )
                })}
              </Box>
            </Tooltip>

            {/* 4(CHE1) → 5(M&G) → 6(CHE2) → 7(Actuator) → 8(CHE3) → 9(DOF) */}
            {['4', '5', '6', '7', '8', '9'].map((key) => {
              const status = getStageStatus(key, process)
              const isCHE = ['4', '6', '8'].includes(key)
              const label = isCHE ? `CHE ${key === '4' ? '1' : key === '6' ? '2' : '3'}` : `Stage ${key}`
              return (
                <Tooltip key={key} title={label} arrow placement="top">
                  <Box
                    sx={{
                      flex: isCHE ? 0.5 : 1,
                      height: isCHE ? 3 : 4,
                      borderRadius: 2,
                      bgcolor: status === 'completed'
                        ? (isCHE ? 'warning.main' : 'success.main')
                        : status === 'active'
                          ? 'primary.main'
                          : 'action.disabledBackground',
                      transition: 'background-color 0.3s',
                    }}
                  />
                </Tooltip>
              )
            })}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {(() => {
              const stages = ['1', '2', '3.1', '3.2', '4', '5', '6', '7', '8', '9']
              const statuses = process.stage_statuses || {}
              const completed = stages.filter(s => statuses[s] === 'completed').length
              return `${completed}/${stages.length} stages`
            })()}
          </Typography>

          {process.menteeflow_url && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
              <ExternalLinkIcon sx={{ fontSize: 12, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary">
                MenteeFlow
              </Typography>
            </Box>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

const ProcessFlexbox = ({ processes, loading, onProcessClick }) => {
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (processes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No processes found. Processes are created by MenteeFlow.
      </Typography>
    )
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 1.5,
        pb: 1,
      }}
    >
      {processes.map((process) => (
        <ProcessCard
          key={process.id}
          process={process}
          onClick={onProcessClick}
        />
      ))}
    </Box>
  )
}

export default ProcessFlexbox
