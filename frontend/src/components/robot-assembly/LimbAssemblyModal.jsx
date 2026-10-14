/**
 * LimbAssemblyModal
 * Assembly interface for limb assembly stages.
 * Same UX as AssemblyStageModal (DOF) but uses limb process API endpoints.
 * Shows parts for the assembly, allows opening drawing, marking damaged, completing stage.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Typography,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Avatar,
  List,
  ListItem,
  CircularProgress,
  Chip,
  Alert,
  Tooltip,
  useTheme,
} from '@mui/material'
import {
  Close as CloseIcon,
  Image as ImageIcon,
  CheckCircle as CheckCircleIcon,
  PictureAsPdf as PdfIcon,
  Build as BuildIcon,
  Warning as WarningIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material'
import ResizableDialog from '../ResizableDialog'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import RepickModal from './RepickModal'
import { getThumbSrc } from '../../utils/thumbnail'

const LimbAssemblyModal = ({ open, onClose, process, stageLabel, onComplete, readOnly = false, service = robotAssemblyService }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showNotification } = useNotification()

  const [parts, setParts] = useState([])
  const [assembly, setAssembly] = useState(null)
  const [loading, setLoading] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [unpickedCheck, setUnpickedCheck] = useState(null)
  const [repickOpen, setRepickOpen] = useState(false)

  // PDF viewer
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfLabel, setPdfLabel] = useState('')
  const [pdfPanelPct, setPdfPanelPct] = useState(55)
  const containerRef = useRef(null)
  const draggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const handleDragStart = useCallback((e) => {
    e.preventDefault()
    draggingRef.current = true
    setIsDragging(true)
    const onMove = (ev) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = (ev.clientX || ev.touches?.[0]?.clientX) - rect.left
      const pct = ((rect.width - x) / rect.width) * 100
      setPdfPanelPct(Math.min(80, Math.max(20, pct)))
    }
    const onUp = () => {
      draggingRef.current = false
      setIsDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchmove', onMove)
    document.addEventListener('touchend', onUp)
  }, [])

  useEffect(() => {
    if (open && process && stageLabel) {
      loadParts()
      checkUnpicked()
      setPdfUrl(null)
    }
  }, [open, process?.id, stageLabel])

  const loadParts = async () => {
    setLoading(true)
    try {
      const response = await service.getLimbStageParts(process.id, stageLabel)
      if (response.data.success) {
        setParts(response.data.parts || [])
        setAssembly(response.data.assembly)
      }
    } catch (error) {
      showNotification('Failed to load assembly parts', 'error')
    } finally {
      setLoading(false)
    }
  }

  const checkUnpicked = async () => {
    try {
      const response = await service.checkLimbUnpickedBlocking(process.id, stageLabel)
      if (response.data.success) {
        setUnpickedCheck(response.data)
      }
    } catch {
      // Not critical
    }
  }

  const handleComplete = async () => {
    setCompleting(true)
    try {
      const response = await service.completeLimbStage(process.id, stageLabel, {})
      if (response.data.success) {
        showNotification(`${stageLabel} assembly completed!`, 'success')
        onComplete?.()
        onClose()
      }
    } catch (error) {
      const msg = error.response?.data?.error || 'Failed to complete stage'
      showNotification(msg, 'error')
    } finally {
      setCompleting(false)
    }
  }

  const openPdf = (partNumber, revision) => {
    setPdfUrl(service.getPartPdfUrl(partNumber, revision))
    setPdfLabel(`${partNumber} REV ${revision || 'A'}`)
  }

  const openAI = (partNumber) => {
    setPdfUrl(service.getPartAiUrl(partNumber))
    setPdfLabel(`AI: ${partNumber}`)
  }

  const isBlocking = unpickedCheck?.blocking

  if (!open) return null

  return (
    <ResizableDialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { height: '85vh' } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5 }}>
        <BuildIcon color="primary" />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" fontSize="0.95rem" fontWeight={600}>
            Assembly — {stageLabel}: {assembly?.display_name || assembly?.stage_name || ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Process: {process?.process_number}
            {assembly?.part_number && ` | Assembly: ${assembly.part_number}`}
          </Typography>
        </Box>

        {/* Open assembly drawing */}
        {assembly?.part_number && (
          <Tooltip title="Open assembly AI instructions">
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<BuildIcon />}
              onClick={() => openAI(assembly.part_number)}
              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
              Assembly Instructions
            </Button>
          </Tooltip>
        )}

        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent ref={containerRef} sx={{ display: 'flex', gap: 0, p: 0, overflow: 'hidden' }}>
        {/* Parts list */}
        <Box
          sx={{
            flex: pdfUrl ? `0 0 ${100 - pdfPanelPct}%` : 1,
            overflow: 'auto',
            p: 1.5,
            transition: isDragging ? 'none' : 'flex 0.2s',
          }}
        >
          {/* Unpicked blocking alert */}
          {isBlocking && (
            <Alert
              severity="error"
              icon={<WarningIcon />}
              action={!readOnly ? (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setRepickOpen(true)}
                >
                  Re-pick Parts
                </Button>
              ) : null}
              sx={{ mb: 1 }}
            >
              <strong>{unpickedCheck.missing_parts?.length || 0} parts not picked</strong>{!readOnly && ' — these must be picked before completing this stage.'}
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <List disablePadding>
              {parts.map((part, idx) => {
                const isMissing = unpickedCheck?.missing_parts?.some(m => m.part_number === part.part_number)
                return (
                  <ListItem
                    key={`${part.part_number}-${idx}`}
                    disablePadding
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                      py: 0.5,
                      px: 1,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      bgcolor: isMissing
                        ? (isDark ? 'rgba(244,67,54,0.08)' : '#fce4ec')
                        : 'transparent',
                    }}
                  >
                    <Avatar
                      src={part.thumbnail ? getThumbSrc(part.thumbnail) : undefined}
                      variant="rounded"
                      sx={{ width: 28, height: 28 }}
                    >
                      <ImageIcon fontSize="small" />
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontFamily="monospace" fontSize="0.78rem" fontWeight={600}>
                        {part.part_number}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {part.description || part.part_name}
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 30, textAlign: 'right' }}>
                      x{part.quantity}
                    </Typography>
                    {part.part_type === 'Assembly' && (
                      <Chip label="Assembly" size="small" color="info" sx={{ fontSize: '0.6rem', height: 18 }} />
                    )}
                    {isMissing && (
                      <Chip label="Not Picked" size="small" color="error" sx={{ fontSize: '0.6rem', height: 18 }} />
                    )}
                    <Tooltip title="Open drawing PDF">
                      <IconButton size="small" onClick={() => openPdf(part.part_number, part.revision)}>
                        <PdfIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </ListItem>
                )
              })}
            </List>
          )}
        </Box>

        {/* Drag handle + PDF viewer */}
        {pdfUrl && (
          <>
            <Box
              onMouseDown={handleDragStart}
              onTouchStart={handleDragStart}
              sx={{
                width: 6,
                cursor: 'col-resize',
                bgcolor: isDragging ? 'primary.main' : 'divider',
                '&:hover': { bgcolor: 'primary.light' },
                flexShrink: 0,
              }}
            />
            <Box sx={{ flex: `0 0 ${pdfPanelPct}%`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }} noWrap>
                  {pdfLabel}
                </Typography>
                <Tooltip title="Open in new window">
                  <IconButton size="small" onClick={() => window.open(pdfUrl, '_blank', 'noopener')}>
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <IconButton size="small" onClick={() => setPdfUrl(null)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
              <iframe
                src={pdfUrl}
                title="PDF Viewer"
                style={{ flex: 1, border: 'none', width: '100%' }}
              />
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1 }}>
        <Button onClick={onClose} disabled={completing}>Close</Button>
        {!readOnly && (
          <Button
            variant="contained"
            onClick={handleComplete}
            disabled={completing || isBlocking}
            startIcon={completing ? <CircularProgress size={16} /> : <CheckCircleIcon />}
          >
            Finished {stageLabel} Assembly
          </Button>
        )}
      </DialogActions>

      {/* Re-pick modal — wraps RepickModal with limb process API */}
      {repickOpen && (
        <RepickModal
          open={repickOpen}
          onClose={() => setRepickOpen(false)}
          process={process}
          missingParts={unpickedCheck?.missing_parts || []}
          onComplete={async () => {
            await checkUnpicked()
          }}
          customRepickFn={async (partsToRepick) => {
            return service.repickLimbParts(process.id, {
              stage_label: stageLabel,
              repicked_parts: partsToRepick,
            })
          }}
        />
      )}
    </ResizableDialog>
  )
}

export default LimbAssemblyModal
