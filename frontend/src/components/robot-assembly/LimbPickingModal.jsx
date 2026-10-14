/**
 * LimbPickingModal
 * Picking interface for limb assembly stages.
 * Same UX as PickingModal (DOF) but uses limb process API endpoints.
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
  Checkbox,
  Avatar,
  List,
  ListItem,
  Divider,
  CircularProgress,
  Chip,
  Tooltip,
  useTheme,
} from '@mui/material'
import {
  Close as CloseIcon,
  Image as ImageIcon,
  CheckCircle as CheckCircleIcon,
  PictureAsPdf as PdfIcon,
} from '@mui/icons-material'
import ResizableDialog from '../ResizableDialog'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import { getThumbSrc } from '../../utils/thumbnail'

const LimbPickingModal = ({ open, onClose, process, stageLabel, onComplete, readOnly = false, service = robotAssemblyService }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showNotification } = useNotification()

  const [parts, setParts] = useState([])
  const [assembly, setAssembly] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pickedParts, setPickedParts] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)

  // Inline PDF viewer state
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfLabel, setPdfLabel] = useState('')

  // Resizable split pane
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
      setPickedParts(new Set())
      setPdfUrl(null)
      // Tell MenteeFlow that picking just started — fires the stage-DOF /
      // EL-components payload BEFORE the user picks anything.
      service.notifyLimbPickingStarted?.(process.id, stageLabel).catch(() => { })
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
      showNotification('Failed to load stage parts', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleTogglePick = (idx) => {
    setPickedParts(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleSelectAll = () => {
    if (pickedParts.size === parts.length) {
      setPickedParts(new Set())
    } else {
      setPickedParts(new Set(parts.map((_, i) => i)))
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const picked = parts.filter((_, i) => pickedParts.has(i)).map(p => ({
        part_id: p.part_id,
        part_number: p.part_number,
        revision: p.revision,
        quantity: p.quantity,
      }))
      const unpicked = parts.filter((_, i) => !pickedParts.has(i)).map(p => ({
        part_id: p.part_id,
        part_number: p.part_number,
        revision: p.revision,
        quantity: p.quantity,
      }))

      const response = await service.submitLimbPicking(process.id, stageLabel, {
        picked_parts: picked,
        unpicked_parts: unpicked,
      })

      if (response.data.success) {
        showNotification(`Picking completed for ${stageLabel}`, 'success')
        onComplete?.()
        onClose()
      }
    } catch (error) {
      showNotification('Failed to submit picking', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const openPdf = (partNumber, revision) => {
    setPdfUrl(service.getPartPdfUrl(partNumber, revision))
    setPdfLabel(`${partNumber} REV ${revision || 'A'}`)
  }

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
        <PdfIcon color="primary" />
        <Box sx={{ flex: 1 }}>
          <Typography variant="h6" fontSize="0.95rem" fontWeight={600}>
            Part Picking — {stageLabel}: {assembly?.display_name || assembly?.stage_name || ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Process: {process?.process_number}
          </Typography>
        </Box>
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
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : (
            <>
              {/* Select all header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 1, py: 0.5 }}>
                <Checkbox
                  size="small"
                  checked={parts.length > 0 && pickedParts.size === parts.length}
                  indeterminate={pickedParts.size > 0 && pickedParts.size < parts.length}
                  onChange={handleSelectAll}
                  disabled={readOnly}
                />
                <Typography variant="caption" fontWeight={600}>
                  {readOnly ? `${parts.length} parts (read-only)` : `${pickedParts.size}/${parts.length} picked`}
                </Typography>
              </Box>

              <List disablePadding>
                {parts.map((part, idx) => {
                  const isPicked = pickedParts.has(idx)
                  const lowStock = (part.inventory || 0) < (part.quantity || 1)
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
                        bgcolor: isPicked
                          ? (isDark ? 'rgba(76,175,80,0.08)' : '#f1f8e9')
                          : 'transparent',
                      }}
                    >
                      <Checkbox
                        size="small"
                        checked={isPicked}
                        onChange={() => handleTogglePick(idx)}
                        disabled={readOnly}
                      />
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
                      <Chip
                        label={part.inventory ?? 0}
                        size="small"
                        color={lowStock ? 'error' : 'default'}
                        sx={{ fontSize: '0.65rem', height: 18, minWidth: 30 }}
                      />
                      {part.warehouse_box && (
                        <Chip label={part.warehouse_box} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />
                      )}
                      {part.revision && (
                        <Tooltip title="Open drawing PDF">
                          <IconButton size="small" onClick={() => openPdf(part.part_number, part.revision)}>
                            <PdfIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </ListItem>
                  )
                })}
              </List>
            </>
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
        <Button onClick={onClose} disabled={submitting}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || pickedParts.size === 0}
            startIcon={submitting ? <CircularProgress size={16} /> : <CheckCircleIcon />}
          >
            Finish Part Picking ({pickedParts.size}/{parts.length})
          </Button>
        )}
      </DialogActions>
    </ResizableDialog>
  )
}

export default LimbPickingModal
