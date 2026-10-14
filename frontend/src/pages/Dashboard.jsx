import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
  CardContent,
  CardActionArea,
  Typography,
  Box,
  CircularProgress,
  Chip,
  LinearProgress,
  Divider,
  useTheme,
} from '@mui/material'
import {
  List as ListIcon,
  Receipt as ReceiptIcon,
  ShoppingCart as CartIcon,
  PrecisionManufacturing as RobotIcon,
  CheckCircle as CheckIcon,
  HourglassEmpty as PendingIcon,
  Send as SentIcon,
  Cancel as CancelIcon,
  ArrowForward as ArrowIcon,
} from '@mui/icons-material'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import { bomService } from '../services/bomService'

// Shared row style for list items
const rowSx = (isDark) => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  px: 1.5, py: 0.75, borderRadius: 0.5, textDecoration: 'none', color: 'inherit',
  bgcolor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
  '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' },
  transition: 'background-color 0.15s',
})

const Dashboard = () => {
  const { user } = useAuth()
  const { showNotification, liveVersions } = useNotification()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const role = user?.role || 'floor'
  const canSeePurchases = role !== 'floor'

  useEffect(() => { loadDashboardData() }, [])

  // Live update: refresh stats/recent activity when data changes anywhere
  const liveInitRef = useRef(true)
  useEffect(() => {
    if (liveInitRef.current) {
      liveInitRef.current = false
      return
    }
    loadDashboardData()
  }, [liveVersions.boms, liveVersions.purchases, liveVersions.parts])

  const loadDashboardData = async () => {
    try {
      const response = await bomService.getDashboardStats()
      if (response.data.success) setData(response.data)
      else showNotification('Error loading dashboard', 'error')
    } catch (error) {
      console.error('Error loading dashboard:', error)
      showNotification('Error loading dashboard', 'error')
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return ''
    const d = new Date(dateString)
    const diff = Date.now() - d
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return d.toLocaleDateString()
  }

  const formatCurrency = (amount, currency = 'USD') => {
    if (amount == null) return '-'
    const sym = currency === 'ILS' ? '\u20AA' : currency === 'EUR' ? '\u20AC' : '$'
    return `${sym}${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 44px)' }}>
        <CircularProgress size={36} />
      </Box>
    )
  }

  const stats = data?.stats || {}
  const poPipeline = data?.po_pipeline
  const rfqPipeline = data?.rfq_pipeline
  const recentActivity = data?.recent_activity || []
  const recentPos = data?.recent_pos || []
  const recentRfqs = data?.recent_rfqs || []
  const assemblyStats = data?.assembly_stats
  const recentProcesses = data?.recent_processes || []

  const poStatusCfg = {
    pending: { label: 'Pending', color: 'warning' },
    sent_to_vendor: { label: 'Sent', color: 'info' },
    received: { label: 'Received', color: 'success' },
    cancelled: { label: 'Cancelled', color: 'default' },
  }
  const rfqStatusCfg = {
    active: { label: 'Active', color: 'success' },
    converted_to_po: { label: 'Converted', color: 'info' },
    cancelled: { label: 'Cancelled', color: 'default' },
  }
  const bomStatusCfg = {
    active: { label: 'Active', color: 'success' },
    obsolete: { label: 'Obsolete', color: 'default' },
  }

  // -- Compact stat card --
  const StatCard = ({ title, value, icon, color, to }) => {
    const inner = (
      <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, fontSize: '0.65rem' }}>
              {title}
            </Typography>
            <Typography sx={{ fontWeight: 700, fontSize: '1.2rem', lineHeight: 1.2, mt: 0.25 }}>
              {value}
            </Typography>
          </Box>
          <Box sx={{ color: `${color}.main`, opacity: 0.7, display: 'flex' }}>
            {icon}
          </Box>
        </Box>
      </CardContent>
    )
    return (
      <Card variant="outlined" sx={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
        {to ? <CardActionArea component={Link} to={to}>{inner}</CardActionArea> : inner}
      </Card>
    )
  }

  // -- Pipeline bar --
  const PipelineBar = ({ counts, config, total }) => {
    if (!counts || total === 0) return <Typography variant="caption" color="text.secondary">No data yet</Typography>
    return (
      <Box>
        <Box sx={{ display: 'flex', borderRadius: 0.5, overflow: 'hidden', height: 6, mb: 0.75 }}>
          {Object.entries(config).map(([status, cfg]) => {
            const count = counts[status] || 0
            if (count === 0) return null
            return (
              <Box key={status} sx={{ width: `${(count / total) * 100}%`, bgcolor: `${cfg.color}.main`, minWidth: count > 0 ? 3 : 0 }} />
            )
          })}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {Object.entries(config).map(([status, cfg]) => {
            const count = counts[status] || 0
            if (count === 0) return null
            return (
              <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: `${cfg.color}.main` }} />
                <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                  {cfg.label}: <b>{count}</b>
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  }

  // Section header helper
  const SectionHeader = ({ title, to }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
      <Typography sx={{ fontWeight: 600, fontSize: '0.85rem' }}>{title}</Typography>
      {to && (
        <Chip
          label="View All" size="small" component={Link} to={to} clickable variant="outlined"
          icon={<ArrowIcon />}
          sx={{ height: 22, '& .MuiChip-label': { fontSize: '0.65rem', px: 0.5 }, '& .MuiChip-icon': { fontSize: 13 } }}
        />
      )}
    </Box>
  )

  return (
    <Box sx={{ width: '100%', height: 'calc(100vh - 44px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header - compact */}
      <Box sx={{ px: 1.5, pt: 0.75, pb: 0.25, flexShrink: 0 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.95rem' }}>
          Welcome back, {user?.username || 'User'}
        </Typography>
      </Box>

      {/* Scrollable content */}
      <Box sx={{ flex: 1, minHeight: 0, px: 1.5, pb: 1, overflowY: 'auto' }}>

        {/* ── Stat cards row ── */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 45%', md: '1 1 0' }, minWidth: 140 }}>
            <StatCard title="Total BOMs" value={stats.total_boms ?? 0} icon={<ListIcon sx={{ fontSize: 22 }} />} color="primary" to="/assembly-bom" />
          </Box>
          {canSeePurchases && poPipeline && (
            <>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 45%', md: '1 1 0' }, minWidth: 140 }}>
                <StatCard title="Active POs" value={(poPipeline.pending || 0) + (poPipeline.sent_to_vendor || 0)} icon={<CartIcon sx={{ fontSize: 22 }} />} color="info" to="/purchases" />
              </Box>
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 45%', md: '1 1 0' }, minWidth: 140 }}>
                <StatCard title="Active RFQs" value={rfqPipeline?.active || 0} icon={<ReceiptIcon sx={{ fontSize: 22 }} />} color="success" to="/purchases" />
              </Box>
            </>
          )}
          {assemblyStats && (
            <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 45%', md: '1 1 0' }, minWidth: 140 }}>
              <StatCard title="Active Assemblies" value={assemblyStats.active || 0} icon={<RobotIcon sx={{ fontSize: 22 }} />} color="warning" to="/robot-assembly" />
            </Box>
          )}
        </Box>

        {/* ── Main grid ── */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, gap: 1.5 }}>

          {/* Left column */}
          <Box sx={{ flex: { lg: 3 }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>

            {/* Purchase Pipeline */}
            {canSeePurchases && poPipeline && (
              <Card variant="outlined" sx={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                  <SectionHeader title="Purchase Pipeline" to="/purchases" />

                  <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}>
                    Purchase Orders ({poPipeline.total || 0})
                  </Typography>
                  <PipelineBar counts={poPipeline} config={poStatusCfg} total={poPipeline.total || 0} />

                  <Divider sx={{ my: 1.25 }} />

                  <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}>
                    Requests for Quote ({rfqPipeline?.total || 0})
                  </Typography>
                  <PipelineBar counts={rfqPipeline} config={rfqStatusCfg} total={rfqPipeline?.total || 0} />

                  {recentPos.length > 0 && (
                    <>
                      <Divider sx={{ my: 1.25 }} />
                      <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}>Recent POs</Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        {recentPos.map((po) => {
                          const cfg = poStatusCfg[po.status] || poStatusCfg.pending
                          return (
                            <Box key={po.id} component={Link} to="/purchases" sx={rowSx(isDark)}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }} noWrap>{po.po_number}</Typography>
                                <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }} noWrap>{po.vendor}</Typography>
                              </Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                                <Typography sx={{ fontSize: '0.8rem', fontWeight: 500 }}>
                                  {formatCurrency(po.total_cost, po.currency)}
                                </Typography>
                                <Chip label={cfg.label} color={cfg.color} size="small" sx={{ height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.65rem' } }} />
                              </Box>
                            </Box>
                          )
                        })}
                      </Box>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Assembly Processes */}
            {assemblyStats && recentProcesses.length > 0 && (
              <Card variant="outlined" sx={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                  <SectionHeader title="Active Assemblies" to="/robot-assembly" />
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {recentProcesses.map((proc) => (
                      <Box key={proc.id} component={Link} to={`/robot-assembly/process/${proc.id}`} sx={rowSx(isDark)}>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }}>{proc.process_number}</Typography>
                            {proc.status === 'on_hold' && (
                              <Chip label="Hold" color="warning" size="small" variant="outlined" sx={{ height: 16, '& .MuiChip-label': { px: 0.5, fontSize: '0.6rem' } }} />
                            )}
                          </Box>
                          <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }} noWrap>
                            {proc.badge_name}{proc.limb_name ? ` \u2022 ${proc.limb_name}` : ''}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
                          <Chip label={`${proc.current_stage}/6`} size="small" color="primary" sx={{ fontWeight: 700, height: 20, minWidth: 36, '& .MuiChip-label': { fontSize: '0.7rem' } }} />
                          <Box sx={{ width: 48 }}>
                            <LinearProgress variant="determinate" value={(proc.current_stage / 6) * 100} sx={{ height: 4, borderRadius: 2 }} />
                          </Box>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                  {assemblyStats.completed > 0 && (
                    <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary', mt: 1 }}>
                      {assemblyStats.completed} completed
                    </Typography>
                  )}
                </CardContent>
              </Card>
            )}
          </Box>

          {/* Right column */}
          <Box sx={{ flex: { lg: 2 }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>

            {/* Recent BOMs */}
            <Card variant="outlined" sx={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
              <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                <SectionHeader title="Recent BOMs" to="/assembly-bom" />
                {recentActivity.length === 0 ? (
                  <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>No recent activity</Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {recentActivity.map((bom) => {
                      const cfg = bomStatusCfg[bom.status] || bomStatusCfg.active
                      return (
                        <Box key={bom.id} component={Link} to={`/assembly-bom?bom_id=${bom.id}`} sx={rowSx(isDark)}>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }} noWrap>{bom.name}</Typography>
                            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                              Rev {bom.version || '-'} {'\u2022'} {formatDate(bom.updated_at)}
                            </Typography>
                          </Box>
                          <Chip label={cfg.label} color={cfg.color} size="small" sx={{ ml: 1, height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.65rem' } }} />
                        </Box>
                      )
                    })}
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Recent RFQs */}
            {canSeePurchases && recentRfqs.length > 0 && (
              <Card variant="outlined" sx={{ borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' }}>
                <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                  <SectionHeader title="Recent RFQs" />
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {recentRfqs.map((rfq) => {
                      const cfg = rfqStatusCfg[rfq.status] || rfqStatusCfg.active
                      return (
                        <Box key={rfq.id} component={Link} to="/purchases" sx={rowSx(isDark)}>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600 }} noWrap>{rfq.rfq_name}</Typography>
                            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>
                              {rfq.parts_count} parts {'\u2022'} {formatDate(rfq.created_date)}
                            </Typography>
                          </Box>
                          <Chip label={cfg.label} color={cfg.color} size="small" sx={{ ml: 1, height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.65rem' } }} />
                        </Box>
                      )
                    })}
                  </Box>
                </CardContent>
              </Card>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default Dashboard
