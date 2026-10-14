/**
 * EmbedLimbStageView
 *
 * Iframe wrapper that renders MenteeBOM's existing LimbAssemblyWorkflowDialog
 * inside MenteeFlow. The dialog shows the same stage list, progress bar, and
 * PICK PARTS / ASSEMBLE buttons that floor users see natively — clicking them
 * opens the same picking/assembly modals. API calls are routed through the
 * token-authenticated embedService instead of the cookie-based service.
 *
 * URL: /embed/limb-process/:processNumber/stage/:stageLabel?token=...
 *      &mode=readonly       — repair-flow view: instructions visible, all
 *                             write actions disabled, no webhooks fire.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Box, CircularProgress, Alert } from '@mui/material'
import createEmbedService from '../../services/embedService'
import LimbAssemblyWorkflowDialog from './LimbAssemblyWorkflowDialog'
import LimbAssemblyModal from './LimbAssemblyModal'

const EmbedLimbStageView = () => {
  const { processNumber, stageLabel } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const readOnly = searchParams.get('mode') === 'readonly'

  const service = useMemo(() => {
    const base = createEmbedService(token, processNumber)
    if (!readOnly) return base

    // Repair flow: neutralize every write call so nothing on MenteeBOM mutates
    // and no webhook fires. Reads (status, parts, drawings) pass through.
    const noop = () => Promise.resolve({ data: { success: true, readonly: true } })
    return {
      ...base,
      submitLimbPicking: noop,
      completeLimbStage: noop,
      repickLimbParts: noop,
      beginLimbStage: noop,
      notifyLimbPickingStarted: noop,
    }
  }, [token, processNumber, readOnly])

  const [process, setProcess] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadProcess = useCallback(async () => {
    try {
      const resp = await service.getLimbProcessStatus()
      if (resp.data.success) {
        setProcess(resp.data.process)
      } else {
        setError(resp.data.error || 'Failed to load process')
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [service])

  useEffect(() => {
    if (!token) {
      setError('Missing embed token in URL')
      setLoading(false)
      return
    }
    loadProcess()
  }, [token, loadProcess])

  // Notify MenteeFlow when the user closes the iframe view
  const handleClose = () => {
    try {
      window.parent?.postMessage(
        { type: 'menteebom:limb-dialog-closed', processNumber },
        '*'
      )
    } catch { /* parent unreachable — webhook callback covers state changes */ }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  if (!process) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Process unavailable.</Alert>
      </Box>
    )
  }

  // Banner shown in repair-flow readonly mode
  const readOnlyBanner = readOnly && (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2000,
        bgcolor: 'warning.main',
        color: 'warning.contrastText',
        px: 2,
        py: 1,
        textAlign: 'center',
        fontWeight: 600,
        fontSize: 14,
        boxShadow: 2,
      }}
    >
      Read-only — repair view. Submit actions are disabled.
    </Box>
  )

  // Repair flow: show the specific stage's assembly view directly. The
  // workflow dialog isn't useful here because the process is typically
  // already completed — we'd land on the "Assembly Complete!" trophy view
  // and the operator could never open the stage they need.
  if (readOnly) {
    const stage = (process.stages || []).find((s) => s.stage_label === stageLabel)
    if (!stage) {
      return (
        <>
          {readOnlyBanner}
          <Box sx={{ p: 3, mt: 6 }}>
            <Alert severity="error">
              Stage <strong>{stageLabel}</strong> not found in process {processNumber}.
            </Alert>
          </Box>
        </>
      )
    }
    return (
      <>
        {readOnlyBanner}
        <LimbAssemblyModal
          open
          onClose={handleClose}
          process={process}
          stageLabel={stageLabel}
          readOnly
          service={service}
        />
      </>
    )
  }

  // Normal flow: full workflow dialog with stage navigation.
  return (
    <LimbAssemblyWorkflowDialog
      open
      onClose={handleClose}
      limb={{ id: process.limb_id, name: process.limb_name }}
      badgeId={process.badge_id}
      initialProcess={process}
      isAdmin={false}
      readOnly={false}
      service={service}
    />
  )
}

export default EmbedLimbStageView
