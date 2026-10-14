import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Chip, Tabs, Tab, CircularProgress, Tooltip, LinearProgress,
} from '@mui/material'
import {
  LocalShipping as ShippingIcon,
  WarningAmber as WarningIcon,
  Schedule as ScheduleIcon,
  Insights as InsightsIcon,
} from '@mui/icons-material'
import { rfqService } from '../services/rfqService'

const CURRENCY_SYMBOL = { USD: '$', EUR: '€', ILS: '₪' }

function fmtDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function fmtCost(po) {
  if (po.total_cost == null) return '-'
  const symbol = CURRENCY_SYMBOL[(po.currency || 'USD').toUpperCase()] || '$'
  return `${symbol}${Number(po.total_cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function POTable({ rows, emptyText, extraColumn }) {
  if (!rows || rows.length === 0) {
    return <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{emptyText}</Typography>
  }
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>PO Number</TableCell>
            <TableCell>Vendor</TableCell>
            <TableCell>Ordered</TableCell>
            <TableCell>Expected</TableCell>
            <TableCell align="right">{extraColumn.header}</TableCell>
            <TableCell align="right">Cost</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(po => (
            <TableRow key={po.id} hover>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {po.po_number}
                  {po.is_delivery && (
                    <Tooltip title="Scheduled delivery of a parent PO">
                      <Chip size="small" label="Delivery" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                    </Tooltip>
                  )}
                </Box>
              </TableCell>
              <TableCell>{po.vendor || '-'}</TableCell>
              <TableCell>{fmtDate(po.po_date)}</TableCell>
              <TableCell>{fmtDate(po.expected_date)}</TableCell>
              <TableCell align="right">{extraColumn.render(po)}</TableCell>
              <TableCell align="right">{fmtCost(po)}</TableCell>
              <TableCell>
                <Chip size="small" variant="outlined" label={po.status || '-'} sx={{ height: 20, fontSize: '0.7rem' }} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export default function DeliveryPerformanceDialog({ open, onClose }) {
  const [tab, setTab] = useState(0)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    rfqService.getDeliveryPerformance()
      .then(res => {
        if (cancelled) return
        if (res.data?.success) setData(res.data)
        else setError(res.data?.error || 'Failed to load delivery performance')
      })
      .catch(() => { if (!cancelled) setError('Failed to load delivery performance') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open])

  const late = data?.late_pos || []
  const upcoming = data?.upcoming_pos || []
  const vendors = data?.vendor_stats || []

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ShippingIcon fontSize="small" />
          Delivery Performance
          {late.length > 0 && (
            <Chip size="small" color="error" label={`${late.length} late`} sx={{ ml: 1 }} />
          )}
        </Box>
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : error ? (
          <Typography color="error" sx={{ py: 2, textAlign: 'center' }}>{error}</Typography>
        ) : (
          <>
            <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 1.5 }}>
              <Tab icon={<WarningIcon fontSize="small" />} iconPosition="start"
                   label={`Late (${late.length})`} sx={{ minHeight: 40 }} />
              <Tab icon={<ScheduleIcon fontSize="small" />} iconPosition="start"
                   label={`Due Soon (${upcoming.length})`} sx={{ minHeight: 40 }} />
              <Tab icon={<InsightsIcon fontSize="small" />} iconPosition="start"
                   label={`Vendor Stats (${vendors.length})`} sx={{ minHeight: 40 }} />
            </Tabs>

            {tab === 0 && (
              <POTable
                rows={late}
                emptyText="No late POs — everything is on schedule 🎉"
                extraColumn={{
                  header: 'Days Overdue',
                  render: (po) => (
                    <Typography variant="body2" color="error.main" fontWeight={600}>
                      {po.days_overdue}
                    </Typography>
                  ),
                }}
              />
            )}

            {tab === 1 && (
              <POTable
                rows={upcoming}
                emptyText={`No POs due in the next ${data?.upcoming_days ?? 7} days`}
                extraColumn={{
                  header: 'Days Until Due',
                  render: (po) => <Typography variant="body2">{po.days_until_due}</Typography>,
                }}
              />
            )}

            {tab === 2 && (
              vendors.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                  No received POs with delivery data yet — statistics build up as POs are received.
                </Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Vendor</TableCell>
                        <TableCell align="right">Received POs</TableCell>
                        <TableCell align="right">On Time</TableCell>
                        <TableCell align="right">Late</TableCell>
                        <TableCell sx={{ minWidth: 160 }}>On-Time Rate</TableCell>
                        <TableCell align="right">Avg Delay (days)</TableCell>
                        <TableCell align="right">Worst Delay</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {vendors.map(v => (
                        <TableRow key={v.vendor} hover>
                          <TableCell>{v.vendor}</TableCell>
                          <TableCell align="right">{v.received_pos}</TableCell>
                          <TableCell align="right">{v.on_time}</TableCell>
                          <TableCell align="right">{v.late}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={v.on_time_rate ?? 0}
                                color={v.on_time_rate >= 80 ? 'success' : v.on_time_rate >= 50 ? 'warning' : 'error'}
                                sx={{ flex: 1, height: 8, borderRadius: 4 }}
                              />
                              <Typography variant="body2" sx={{ minWidth: 44, textAlign: 'right' }}>
                                {v.on_time_rate != null ? `${v.on_time_rate}%` : '-'}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell align="right">{v.avg_delay_days}</TableCell>
                          <TableCell align="right">{v.max_delay_days}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
