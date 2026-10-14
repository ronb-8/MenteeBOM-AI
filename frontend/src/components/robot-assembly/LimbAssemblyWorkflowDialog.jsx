import { useState, useEffect, useCallback } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, CircularProgress,
  Paper, LinearProgress, IconButton, Divider, Alert,
  TextField,
} from '@mui/material'
import {
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as PendingIcon,
  PlayArrow as StartIcon,
  Build as AssembleIcon,
  Inventory as PickIcon,
  PrecisionManufacturing as ProcessIcon,
  EmojiEvents as DoneIcon,
  DeleteForever as DeleteIcon,
  Warning as WarningIcon,
  Replay as RollbackIcon,
  SkipNext as SkipIcon,
  FastForward as ForwardIcon,
} from '@mui/icons-material'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import LimbPickingModal from './LimbPickingModal'
import LimbAssemblyModal from './LimbAssemblyModal'

const LimbAssemblyWorkflowDialog = ({ open, onClose, limb, badgeId, initialProcess, isAdmin, readOnly = false, service = robotAssemblyService }) => {
  const { showNotification } = useNotification()
  const [process, setProcess] = useState(null)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [pickingOpen, setPickingOpen] = useState(false)
  const [assemblyOpen, setAssemblyOpen] = useState(false)
  const [activeStage, setActiveStage] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [actionLoading, setActionLoading] = useState(null) // stageLabel being acted on
  // Forward (skip whole stage) state — password-gated, no inventory deduction
  const [forwardStageLabel, setForwardStageLabel] = useState(null)
  const [forwardPassword, setForwardPassword] = useState('')
  const [forwarding, setForwarding] = useState(false)
  const [forwardError, setForwardError] = useState(null)

  const fetchActiveProcess = useCallback(async () => {
    if (!limb?.id || !badgeId) return
    setLoading(true)
    try {
      const resp = await service.getLimbProcesses({
        limb_id: limb.id,
        badge_id: badgeId,
        status: 'active',
      })
      const procs = resp.data.processes || []
      if (procs.length > 0) {
        const detail = await service.getLimbProcess(procs[0].id)
        if (detail.data.success) setProcess(detail.data.process)
      } else {
        setProcess(null)
      }
    } catch {
      setProcess(null)
    } finally {
      setLoading(false)
    }
  }, [limb?.id, badgeId])

  const refreshProcess = useCallback(async (processId) => {
    const id = processId || process?.id
    if (!id) return fetchActiveProcess()
    try {
      const resp = await service.getLimbProcess(id)
      if (resp.data.success) setProcess(resp.data.process)
    } catch { }
  }, [process?.id, fetchActiveProcess])

  const handleRollbackStage = async (stageLabel) => {
    setActionLoading(stageLabel)
    try {
      const resp = await service.rollbackLimbStage(process.id, stageLabel)
      if (resp.data.success) {
        showNotification(`Stage ${stageLabel} rolled back — inventory returned to stock`, 'info')
        await refreshProcess()
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'Rollback failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleForwardStage = async () => {
    if (!forwardStageLabel || !forwardPassword) return
    setForwarding(true)
    setForwardError(null)
    try {
      const resp = await service.skipLimbStage(process.id, forwardStageLabel, forwardPassword)
      if (resp.data.success) {
        showNotification(`Stage ${forwardStageLabel} force-completed (no inventory deducted)`, 'success')
        setForwardStageLabel(null)
        setForwardPassword('')
        setForwardError(null)
        await refreshProcess()
      }
    } catch (err) {
      const status = err.response?.status
      const serverMsg = err.response?.data?.error
      // 403 = wrong override password — show inside the modal, keep it open,
      // clear the field so the user can retype. Other errors → show inline,
      // keep whatever they typed.
      const isWrongPassword = status === 403
      const msg = isWrongPassword
        ? (serverMsg || 'Incorrect password — try again')
        : (serverMsg || 'Failed to skip stage')
      setForwardError(msg)
      if (isWrongPassword) setForwardPassword('')
    } finally {
      setForwarding(false)
    }
  }

  const handleSkipPicking = async (stageLabel) => {
    setActionLoading(stageLabel)
    try {
      const resp = await service.skipLimbPicking(process.id, stageLabel)
      if (resp.data.success) {
        showNotification(`Picking skipped for ${stageLabel}`, 'info')
        await refreshProcess()
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'Skip failed', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancelProcess = async () => {
    setCancelling(true)
    try {
      const resp = await service.cancelLimbProcess(process.id)
      if (resp.data.success) {
        const returned = resp.data.returned_parts || []
        const msg = returned.length > 0
          ? `Process cancelled. ${returned.length} part line(s) returned to stock.`
          : 'Process cancelled.'
        showNotification(msg, 'success')
        setProcess(null)
        setConfirmCancel(false)
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to cancel process'
      showNotification(msg, 'error')
    } finally {
      setCancelling(false)
    }
  }

  useEffect(() => {
    if (!open) {
      setProcess(null)
      setPickingOpen(false)
      setAssemblyOpen(false)
      setActiveStage(null)
      setConfirmCancel(false)
      return
    }
    if (initialProcess) {
      setProcess(initialProcess)
    } else {
      fetchActiveProcess()
    }
  }, [open, initialProcess?.id])

  const handleStart = async () => {
    setStarting(true)
    try {
      const resp = await service.startLimbProcess(limb.id, badgeId)
      if (resp.data.success) {
        setProcess(resp.data.process)
        showNotification('Assembly process started!', 'success')
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to start assembly'
      showNotification(msg, 'error')
    } finally {
      setStarting(false)
    }
  }

  const handleBeginStage = async (stageLabel) => {
    try {
      await service.beginLimbStage(process.id, stageLabel)
      await refreshProcess()
      setActiveStage(stageLabel)
      setPickingOpen(true)
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to begin stage'
      showNotification(msg, 'error')
    }
  }

  const handleWorkPicking = (stageLabel) => {
    setActiveStage(stageLabel)
    setPickingOpen(true)
  }

  const handleWorkAssembly = (stageLabel) => {
    setActiveStage(stageLabel)
    setAssemblyOpen(true)
  }

  const handlePickingComplete = async () => {
    setPickingOpen(false)
    await refreshProcess()
  }

  const handleAssemblyComplete = async () => {
    setAssemblyOpen(false)
    // Backend auto-begins all newly runnable stages on complete — just refresh
    await refreshProcess()
  }

  const stages = process?.stages || []
  const totalStages = stages.length
  const completedCount = stages.filter(s => s.phase === 'completed').length
  const progressPct = totalStages > 0 ? (completedCount / totalStages) * 100 : 0
  const isCompleted = process?.status === 'completed'
  const activeStages = stages.filter(s => s.phase === 'picking' || s.phase === 'assembly')

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { maxHeight: '88vh' } }}
      >
        {/* Header */}
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5, pb: 1 }}>
          <ProcessIcon color="primary" />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" fontSize="1rem" fontWeight={700} noWrap>
              {limb?.name}
            </Typography>
            {process && (
              <Typography variant="caption" color="text.secondary">
                {process.process_number}
              </Typography>
            )}
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        {/* Progress bar (shown when process exists) */}
        {process && !isCompleted && totalStages > 0 && (
          <Box sx={{ px: 2.5, pb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Progress
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  {completedCount} / {totalStages} stages
                </Typography>
                <Typography
                  variant="h6"
                  fontWeight={700}
                  color="primary.main"
                  sx={{ minWidth: 56, textAlign: 'right' }}
                >
                  {Math.round(progressPct)}%
                </Typography>
              </Box>
            </Box>
            <Box sx={{ position: 'relative' }}>
              <LinearProgress
                variant="determinate"
                value={progressPct}
                sx={{
                  height: 16,
                  borderRadius: 8,
                  backgroundColor: (theme) =>
                    theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 8,
                    background: 'linear-gradient(90deg, #7c4dff 0%, #b388ff 100%)',
                    transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                  },
                }}
              />
            </Box>
          </Box>
        )}

        <Divider />

        <DialogContent sx={{ p: 0, overflow: 'auto' }}>
          {/* Loading */}
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress />
            </Box>

          ) : /* All done */ isCompleted ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <DoneIcon sx={{ fontSize: 64, color: 'success.main', mb: 1 }} />
              <Typography variant="h6" fontWeight={700} gutterBottom>Assembly Complete!</Typography>
              <Typography variant="body2" color="text.secondary">
                {process.process_number} — all stages finished.
              </Typography>
            </Box>

          ) : /* No process yet */ !process ? (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <ProcessIcon sx={{ fontSize: 56, color: 'primary.light', mb: 2, opacity: 0.6 }} />
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {limb?.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Ready to begin the assembly process for this limb.
              </Typography>
              <Button
                variant="contained"
                size="large"
                startIcon={starting ? <CircularProgress size={18} color="inherit" /> : <StartIcon />}
                onClick={handleStart}
                disabled={starting}
                sx={{ px: 5, py: 1.5, fontSize: '1rem', fontWeight: 700, borderRadius: 2 }}
              >
                {starting ? 'Starting…' : 'START ASSEMBLY'}
              </Button>
            </Box>

          ) : (
            /* Stage list */
            <Box sx={{ py: 1 }}>
              {stages.map((stage, idx) => {
                const isActive = stage.phase === 'picking' || stage.phase === 'assembly'
                const isDone = stage.phase === 'completed'
                const isPicking = stage.phase === 'picking'
                const isAssembly = stage.phase === 'assembly'

                if (isActive) {
                  /* ── Active stage — prominent card ── */
                  return (
                    <Box key={stage.id || stage.stage_label} sx={{ px: 2, py: 1 }}>
                      <Paper
                        elevation={3}
                        sx={{
                          p: 2,
                          border: '2px solid',
                          borderColor: isPicking ? 'warning.main' : 'primary.main',
                          borderRadius: 2,
                          bgcolor: isPicking ? 'warning.50' : 'primary.50',
                        }}
                      >
                        {/* Stage label + phase badge */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                          <Box
                            sx={{
                              px: 1, py: 0.25, borderRadius: 1,
                              bgcolor: isPicking ? 'warning.main' : 'primary.main',
                              color: 'white',
                              fontFamily: 'monospace',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                            }}
                          >
                            {stage.stage_label}
                          </Box>
                          <Box
                            sx={{
                              px: 1, py: 0.25, borderRadius: 1,
                              bgcolor: isPicking ? 'warning.light' : 'primary.light',
                              color: isPicking ? 'warning.dark' : 'primary.dark',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                            }}
                          >
                            {isPicking ? 'Picking Phase' : 'Assembly Phase'}
                          </Box>
                          {activeStages.length > 1 && (
                            <Box sx={{ px: 0.75, py: 0.25, borderRadius: 1, bgcolor: 'grey.200', fontSize: '0.65rem', fontWeight: 700, color: 'text.secondary' }}>
                              PARALLEL
                            </Box>
                          )}
                        </Box>

                        {/* Stage name */}
                        <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5, fontSize: '1.05rem' }}>
                          {stage.display_name || stage.stage_name}
                        </Typography>
                        {stage.assembly_part_number && (
                          <Typography variant="caption" color="text.secondary" fontFamily="monospace" sx={{ mb: 1.5, display: 'block' }}>
                            Part # {stage.assembly_part_number}
                          </Typography>
                        )}

                        {/* Action button */}
                        {isPicking && (
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'stretch', flexWrap: 'wrap' }}>
                            <Button
                              variant="contained"
                              color="warning"
                              size="large"
                              sx={{ fontWeight: 700, fontSize: '0.95rem', py: 1.25, borderRadius: 2, flex: 1, minWidth: 200 }}
                              startIcon={<PickIcon />}
                              onClick={() => handleWorkPicking(stage.stage_label)}
                            >
                              PICK PARTS →
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="outlined"
                                color="warning"
                                size="large"
                                startIcon={actionLoading === stage.stage_label ? <CircularProgress size={14} /> : <SkipIcon />}
                                onClick={() => handleSkipPicking(stage.stage_label)}
                                disabled={!!actionLoading}
                                sx={{ borderRadius: 2, fontWeight: 600, fontSize: '0.8rem', textTransform: 'none' }}
                              >
                                Skip
                              </Button>
                            )}
                            <Button
                              variant="outlined"
                              color="error"
                              size="large"
                              startIcon={<ForwardIcon />}
                              onClick={() => { setForwardStageLabel(stage.stage_label); setForwardPassword('') }}
                              disabled={!!actionLoading}
                              sx={{ borderRadius: 2, fontWeight: 600, fontSize: '0.8rem', textTransform: 'none' }}
                              title="Force-complete the entire stage (picking + assembly) without deducting inventory. For already-built limbs."
                            >
                              Forward
                            </Button>
                          </Box>
                        )}
                        {isAssembly && (
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'stretch' }}>
                            <Button
                              variant="contained"
                              color="primary"
                              size="large"
                              sx={{ fontWeight: 700, fontSize: '0.95rem', py: 1.25, borderRadius: 2, flex: 1 }}
                              startIcon={<AssembleIcon />}
                              onClick={() => handleWorkAssembly(stage.stage_label)}
                            >
                              ASSEMBLE →
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="outlined"
                                color="warning"
                                size="large"
                                startIcon={actionLoading === stage.stage_label ? <CircularProgress size={14} /> : <RollbackIcon />}
                                onClick={() => handleRollbackStage(stage.stage_label)}
                                disabled={!!actionLoading}
                                sx={{ borderRadius: 2, fontWeight: 600, fontSize: '0.8rem', textTransform: 'none' }}
                              >
                                Re-pick
                              </Button>
                            )}
                          </Box>
                        )}
                      </Paper>
                    </Box>
                  )
                }

                if (isDone) {
                  /* ── Completed stage — compact row ── */
                  const isRollingBack = actionLoading === stage.stage_label
                  return (
                    <Box
                      key={stage.id || stage.stage_label}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1.5,
                        px: 2.5, py: 0.75,
                        borderBottom: idx < stages.length - 1 ? '1px solid' : 'none',
                        borderColor: 'divider',
                      }}
                    >
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20, flexShrink: 0 }} />
                      <Typography
                        variant="body2"
                        fontFamily="monospace"
                        color="success.main"
                        fontWeight={700}
                        sx={{ flexShrink: 0, fontSize: '0.72rem' }}
                      >
                        {stage.stage_label}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ textDecoration: 'line-through', flex: 1 }}
                      >
                        {stage.display_name || stage.stage_name}
                      </Typography>
                      {isAdmin && (
                        <Button
                          size="small"
                          color="warning"
                          startIcon={isRollingBack ? <CircularProgress size={12} /> : <RollbackIcon />}
                          onClick={() => handleRollbackStage(stage.stage_label)}
                          disabled={!!actionLoading}
                          sx={{ fontSize: '0.68rem', textTransform: 'none', py: 0.25, minWidth: 0 }}
                        >
                          Rollback
                        </Button>
                      )}
                    </Box>
                  )
                }

                /* ── Pending stage — compact gray row ── */
                return (
                  <Box
                    key={stage.id || stage.stage_label}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5,
                      px: 2.5, py: 0.75,
                      borderBottom: idx < stages.length - 1 ? '1px solid' : 'none',
                      borderColor: 'divider',
                      opacity: 0.5,
                    }}
                  >
                    <PendingIcon sx={{ color: 'text.disabled', fontSize: 20, flexShrink: 0 }} />
                    <Typography
                      variant="body2"
                      fontFamily="monospace"
                      color="text.disabled"
                      fontWeight={700}
                      sx={{ flexShrink: 0, fontSize: '0.72rem' }}
                    >
                      {stage.stage_label}
                    </Typography>
                    <Typography variant="body2" color="text.disabled" sx={{ flex: 1 }}>
                      {stage.display_name || stage.stage_name}
                    </Typography>
                  </Box>
                )
              })}
            </Box>
          )}
        </DialogContent>

        {/* Admin cancel confirmation banner */}
        {confirmCancel && (
          <Box sx={{ px: 2, pb: 1.5 }}>
            <Alert
              severity="error"
              icon={<WarningIcon />}
              action={
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setConfirmCancel(false)}
                    disabled={cancelling}
                  >
                    No, keep it
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    color="error"
                    onClick={handleCancelProcess}
                    disabled={cancelling}
                    startIcon={cancelling ? <CircularProgress size={12} color="inherit" /> : <DeleteIcon />}
                  >
                    {cancelling ? 'Cancelling…' : 'Yes, delete'}
                  </Button>
                </Box>
              }
            >
              Delete this process? Picked parts will be returned to stock.
            </Alert>
          </Box>
        )}

        <DialogActions sx={{ px: 2, py: 1 }}>
          {isAdmin && process && !isCompleted && !confirmCancel && (
            <Button
              color="error"
              size="small"
              startIcon={<DeleteIcon />}
              onClick={() => setConfirmCancel(true)}
              sx={{ mr: 'auto', textTransform: 'none', fontSize: '0.8rem' }}
            >
              Delete &amp; Restart
            </Button>
          )}
          <Button onClick={onClose} color="inherit">Close</Button>
        </DialogActions>
      </Dialog>

      {/* Nested picking/assembly modals */}
      {process && (
        <>
          <LimbPickingModal
            open={pickingOpen}
            onClose={() => setPickingOpen(false)}
            process={process}
            stageLabel={activeStage}
            onComplete={handlePickingComplete}
            readOnly={readOnly}
            service={service}
          />
          <LimbAssemblyModal
            open={assemblyOpen}
            onClose={() => setAssemblyOpen(false)}
            process={process}
            stageLabel={activeStage}
            onComplete={handleAssemblyComplete}
            readOnly={readOnly}
            service={service}
          />
        </>
      )}

      {/* Forward (skip whole stage) — password confirmation */}
      <Dialog
        open={!!forwardStageLabel}
        onClose={() => {
          if (!forwarding) {
            setForwardStageLabel(null)
            setForwardPassword('')
            setForwardError(null)
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ForwardIcon color="error" />
          Force-complete stage {forwardStageLabel}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This marks the stage <strong>completed</strong> without picking any parts and
            without deducting any inventory (including fasteners). Use only for limbs that
            were physically built outside MenteeBOM.
          </Alert>
          {forwardError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setForwardError(null)}>
              {forwardError}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Enter the override password to confirm:
          </Typography>
          <TextField
            autoFocus
            fullWidth
            type="password"
            size="small"
            value={forwardPassword}
            onChange={(e) => {
              setForwardPassword(e.target.value)
              if (forwardError) setForwardError(null)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && forwardPassword && !forwarding) handleForwardStage() }}
            disabled={forwarding}
            placeholder="Override password"
            error={!!forwardError}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => { setForwardStageLabel(null); setForwardPassword(''); setForwardError(null) }}
            disabled={forwarding}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleForwardStage}
            disabled={!forwardPassword || forwarding}
            startIcon={forwarding ? <CircularProgress size={14} /> : <ForwardIcon />}
          >
            Force complete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default LimbAssemblyWorkflowDialog
