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
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material'
import ResizableDialog from '../ResizableDialog'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import { getThumbSrc } from '../../utils/thumbnail'

const PickingModal = ({ open, onClose, process, onComplete }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showNotification } = useNotification()

  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(false)
  const [pickedParts, setPickedParts] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [dofName, setDofName] = useState('')

  // Inline PDF viewer state
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfLabel, setPdfLabel] = useState('')

  // Resizable split pane state
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
    if (open && process) {
      loadParts()
      setPickedParts(new Set())
    }
  }, [open, process?.id])

  const loadParts = async () => {
    setLoading(true)
    try {
      const response = await robotAssemblyService.getPickingParts(process.id)
      if (response.data.success) {
        setParts(response.data.parts || [])
        setDofName(response.data.dof_name || '')
      }
    } catch (error) {
      showNotification('Failed to load picking parts', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleTogglePart = (partKey) => {
    setPickedParts(prev => {
      const next = new Set(prev)
      if (next.has(partKey)) {
        next.delete(partKey)
      } else {
        next.add(partKey)
      }
      return next
    })
  }

  const handleToggleAll = () => {
    if (pickedParts.size === parts.length) {
      setPickedParts(new Set())
    } else {
      setPickedParts(new Set(parts.map((_, i) => i)))
    }
  }

  const isAllPicked = parts.length > 0 && pickedParts.size === parts.length

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const picked = []
      const unpicked = []

      parts.forEach((part, idx) => {
        const item = {
          part_id: part.part_id,
          part_number: part.part_number,
          revision: part.revision,
          description: part.description,
          quantity: part.quantity,
          inventory_available: part.inventory,
        }
        if (pickedParts.has(idx)) {
          picked.push(item)
        } else {
          unpicked.push(item)
        }
      })

      const response = await robotAssemblyService.submitPicking(process.id, {
        picked_parts: picked,
        unpicked_parts: unpicked,
      })

      if (response.data.success) {
        showNotification(
          `Picking completed! ${picked.length} picked, ${unpicked.length} unpicked`,
          'success'
        )
        if (onComplete) onComplete()
        onClose()
      }
    } catch (error) {
      const errMsg = error.response?.data?.error || 'Failed to submit picking'
      showNotification(errMsg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setPdfUrl(null)
    setPdfLabel('')
    onClose()
  }

  const handleViewPDF = (partNumber, revision) => {
    if (!partNumber || !revision) return
    if (pdfUrl && pdfLabel === `${partNumber} REV${revision}`) {
      setPdfUrl(null)
      setPdfLabel('')
    } else {
      setPdfUrl(`/api/part-pdf/${partNumber}/${revision}#toolbar=1&navpanes=0`)
      setPdfLabel(`${partNumber} REV${revision}`)
    }
  }

  const handleViewAI = (partNumber) => {
    if (!partNumber) return
    const label = `${partNumber} AI Instructions`
    if (pdfUrl && pdfLabel === label) {
      setPdfUrl(null)
      setPdfLabel('')
    } else {
      setPdfUrl(`/api/part-ai/${partNumber}?t=${Date.now()}#toolbar=1&navpanes=0`)
      setPdfLabel(label)
    }
  }

  return (
    <ResizableDialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      defaultHeight={700}
      id="picking-modal"
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6">
              Part Picking - Stage 2
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {process?.process_number} {dofName && `- ${dofName}`}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={`${pickedParts.size}/${parts.length} picked`}
              color={isAllPicked ? 'success' : 'default'}
              size="small"
            />
            <IconButton onClick={handleClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box ref={containerRef} sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Parts list panel */}
          <Box sx={{ flex: pdfUrl ? `0 0 ${100 - pdfPanelPct}%` : '1 1 100%', overflow: 'auto', transition: pdfUrl ? 'none' : 'flex 0.3s ease' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : parts.length === 0 ? (
              <Alert severity="info" sx={{ m: 2 }}>
                No parts found for this process DOF. Make sure the DOF assembly is correctly mapped.
              </Alert>
            ) : (
              <List sx={{ p: 0 }}>
                {/* Select All Header */}
                <ListItem
                  sx={{
                    borderBottom: `2px solid ${isDark ? theme.palette.primary.light : '#1565c0'}`,
                    bgcolor: isDark ? theme.palette.primary.dark : '#e3f2fd',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}
                >
                  <Checkbox
                    checked={isAllPicked}
                    indeterminate={pickedParts.size > 0 && !isAllPicked}
                    onChange={handleToggleAll}
                    sx={{ mr: 1 }}
                  />
                  <Box sx={{ flex: 1 }}>
                    <Typography
                      variant="body1"
                      sx={{
                        fontWeight: 700,
                        color: isDark ? theme.palette.primary.light : '#1565c0',
                      }}
                    >
                      Select All Parts
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {parts.length} part(s) to pick
                    </Typography>
                  </Box>
                </ListItem>

                <Divider />

                {parts.map((part, idx) => {
                  const isPicked = pickedParts.has(idx)
                  const qty = parseFloat(part.quantity || 1)
                  const inventory = part.inventory || 0

                  let inventoryColor = 'text.primary'
                  let inventoryBgColor = 'transparent'
                  if (inventory === 0) {
                    inventoryColor = isDark ? '#b0b0b0' : '#757575'
                    inventoryBgColor = isDark ? 'rgba(128, 128, 128, 0.2)' : 'rgba(128, 128, 128, 0.15)'
                  } else if (inventory < qty) {
                    inventoryColor = '#f44336'
                    inventoryBgColor = isDark ? 'rgba(244, 67, 54, 0.2)' : 'rgba(244, 67, 54, 0.15)'
                  }

                  return (
                    <ListItem
                      key={idx}
                      sx={{
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        bgcolor: isPicked
                          ? (isDark ? 'rgba(56, 142, 60, 0.2)' : '#e8f5e9')
                          : 'transparent',
                        py: 1.25,
                        cursor: 'pointer',
                        '&:hover': {
                          bgcolor: isPicked
                            ? (isDark ? 'rgba(56, 142, 60, 0.25)' : '#c8e6c9')
                            : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                        },
                      }}
                      onClick={() => handleTogglePart(idx)}
                    >
                      <Checkbox
                        checked={isPicked}
                        onChange={() => handleTogglePart(idx)}
                        onClick={(e) => e.stopPropagation()}
                        sx={{ mr: 1.5 }}
                      />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          {part.thumbnail ? (
                            <Avatar
                              src={getThumbSrc(part.thumbnail)}
                              variant="rounded"
                              sx={{ width: 44, height: 44 }}
                            />
                          ) : (
                            <Avatar variant="rounded" sx={{ width: 44, height: 44, bgcolor: theme.palette.action.hover }}>
                              <ImageIcon />
                            </Avatar>
                          )}

                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.82rem' }}>
                              {part.part_number}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" noWrap>
                              {part.description || 'No description'}
                            </Typography>
                          </Box>

                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mx: 1, flexShrink: 0 }}>
                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                Rev
                              </Typography>
                              <Typography
                                variant="body1"
                                sx={{
                                  fontWeight: 700,
                                  color: isDark ? theme.palette.primary.light : '#1565c0',
                                  bgcolor: isDark ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.1)',
                                  px: 1,
                                  py: 0.25,
                                  borderRadius: 1,
                                }}
                              >
                                {part.revision || '-'}
                              </Typography>
                            </Box>

                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                Qty
                              </Typography>
                              <Typography
                                variant="body1"
                                sx={{
                                  fontWeight: 700,
                                  color: isDark ? theme.palette.primary.light : '#1565c0',
                                  bgcolor: isDark ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.1)',
                                  px: 1,
                                  py: 0.25,
                                  borderRadius: 1,
                                }}
                              >
                                {qty}
                              </Typography>
                            </Box>

                            {part.warehouse_box && (
                              <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                  Box
                                </Typography>
                                <Typography
                                  variant="body1"
                                  sx={{
                                    fontWeight: 700,
                                    color: isDark ? theme.palette.primary.light : '#1565c0',
                                    bgcolor: isDark ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.1)',
                                    px: 1,
                                    py: 0.25,
                                    borderRadius: 1,
                                  }}
                                >
                                  {part.warehouse_box}
                                </Typography>
                              </Box>
                            )}

                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                Stock
                              </Typography>
                              <Typography
                                variant="body1"
                                sx={{
                                  fontWeight: 700,
                                  color: inventoryColor,
                                  bgcolor: inventoryBgColor,
                                  px: 1,
                                  py: 0.25,
                                  borderRadius: 1,
                                }}
                              >
                                {inventory}
                              </Typography>
                            </Box>
                          </Box>

                          {/* PDF + AI buttons */}
                          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                            {part.revision && (
                              <Tooltip title={pdfUrl && pdfLabel === `${part.part_number} REV${part.revision}` ? 'Close PDF' : 'Drawing (PDF)'}>
                                <IconButton
                                  size="small"
                                  onClick={() => handleViewPDF(part.part_number, part.revision)}
                                  sx={{
                                    border: `1px solid ${theme.palette.divider}`,
                                    ...(pdfUrl && pdfLabel === `${part.part_number} REV${part.revision}` ? {
                                      bgcolor: isDark ? 'rgba(211, 47, 47, 0.2)' : 'rgba(211, 47, 47, 0.1)',
                                      borderColor: theme.palette.error.main,
                                    } : {}),
                                  }}
                                >
                                  <PdfIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title="Instructions (AI)">
                              <IconButton
                                size="small"
                                onClick={() => handleViewAI(part.part_number)}
                                sx={{ border: `1px solid ${theme.palette.divider}` }}
                              >
                                <BuildIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </Box>
                      </Box>
                    </ListItem>
                  )
                })}
              </List>
            )}
          </Box>

          {/* Drag handle + Inline PDF viewer panel */}
          {pdfUrl && (
            <>
            <Box
              onMouseDown={handleDragStart}
              onTouchStart={handleDragStart}
              sx={{
                width: 6,
                cursor: 'col-resize',
                bgcolor: theme.palette.divider,
                '&:hover': { bgcolor: theme.palette.primary.main },
                '&:active': { bgcolor: theme.palette.primary.main },
                transition: 'background-color 0.15s',
                flexShrink: 0,
              }}
            />
            <Box sx={{
              flex: `0 0 ${pdfPanelPct}%`,
              display: 'flex',
              flexDirection: 'column',
              bgcolor: isDark ? 'rgba(0,0,0,0.3)' : '#f5f5f5',
            }}>
              {/* PDF header bar */}
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 1.5,
                py: 0.75,
                borderBottom: `1px solid ${theme.palette.divider}`,
                bgcolor: isDark ? 'rgba(211, 47, 47, 0.1)' : 'rgba(211, 47, 47, 0.05)',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <PdfIcon fontSize="small" sx={{ color: theme.palette.error.main }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
                    {pdfLabel}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Tooltip title="Open in new tab">
                    <IconButton size="small" onClick={() => window.open(pdfUrl.split('#')[0], '_blank')}>
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Close PDF">
                    <IconButton size="small" onClick={() => { setPdfUrl(null); setPdfLabel('') }}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              {/* PDF iframe */}
              <Box sx={{ flex: 1, minHeight: 0 }}>
                <iframe
                  src={pdfUrl}
                  style={{ width: '100%', height: '100%', border: 'none', pointerEvents: isDragging ? 'none' : 'auto' }}
                  title={pdfLabel}
                />
              </Box>
            </Box>
          </>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          color="success"
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
          onClick={handleSubmit}
          disabled={submitting || parts.length === 0}
          sx={{ minWidth: 200 }}
        >
          {submitting ? 'Submitting...' : 'Finish Part Picking'}
        </Button>
      </DialogActions>
    </ResizableDialog>
  )
}

export default PickingModal
