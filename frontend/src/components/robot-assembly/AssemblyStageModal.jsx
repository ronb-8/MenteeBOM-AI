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
  Inventory2 as AssemblyIcon,
  BrokenImage as DamagedIcon,
  ShoppingCart as PickIcon,
  Warning as WarningIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material'
import ResizableDialog from '../ResizableDialog'
import RepickModal from './RepickModal'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import { getThumbSrc } from '../../utils/thumbnail'

const STAGE_NAMES = {
  '3.1': 'Motor Assembly',
  '3.2': 'Gear Assembly',
  '5': 'Motor and Gear Assembly',
  '7': 'Actuator Assembly',
  '9': 'DOF Assembly',
}

const AssemblyStageModal = ({ open, onClose, process, stage, onComplete, previewMode = false }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showNotification } = useNotification()

  const [assembly, setAssembly] = useState(null)
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Unpicked blocking state
  const [unpickedCheck, setUnpickedCheck] = useState(null)
  const [repickModalOpen, setRepickModalOpen] = useState(false)

  // Damaged part state
  const [replacements, setReplacements] = useState([])

  // Default drawing state
  const [defaultDrawing, setDefaultDrawing] = useState(null)

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

  const stageLabel = stage ? `${stage}` : ''
  const stageName = STAGE_NAMES[stageLabel] || `Stage ${stageLabel}`

  useEffect(() => {
    if (open && process && stage) {
      loadDefaultDrawing()
      if (!previewMode) {
        loadStageParts()
        checkUnpicked()
        loadReplacements()
      }
    }
  }, [open, process?.id, stage, previewMode])

  const loadStageParts = async () => {
    setLoading(true)
    setErrorMsg('')
    setAssembly(null)
    setParts([])
    try {
      const response = await robotAssemblyService.getStageParts(process.id, stageLabel)
      if (response.data.success) {
        setAssembly(response.data.assembly)
        setParts(response.data.parts || [])
        if (!response.data.assembly) {
          setErrorMsg(response.data.message || 'No assembly found for this stage')
        }
      }
    } catch (error) {
      const msg = error.response?.data?.error || 'Failed to load assembly parts'
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }

  const checkUnpicked = async () => {
    try {
      const response = await robotAssemblyService.checkUnpickedBlocking(process.id, stageLabel)
      if (response.data.success) {
        setUnpickedCheck(response.data)
      }
    } catch (error) {
      // Non-critical — just don't show blocking UI
      console.error('Failed to check unpicked blocking:', error)
      setUnpickedCheck(null)
    }
  }

  const loadDefaultDrawing = async () => {
    try {
      const response = await robotAssemblyService.getStageDefaultDrawing(process.id, stageLabel)
      if (response.data.success && response.data.default_drawing) {
        setDefaultDrawing(response.data.default_drawing)
        // Auto-open the default drawing in the PDF viewer
        const partNum = response.data.default_drawing.drawing_part_number
        if (partNum) {
          setPdfUrl(`/api/part-ai/${partNum}?t=${Date.now()}#toolbar=1&navpanes=0`)
          setPdfLabel(`${partNum} AI Instructions`)
        }
      }
    } catch {
      // Non-critical — default drawing is optional enhancement
    }
  }

  const loadReplacements = async () => {
    try {
      const response = await robotAssemblyService.getReplacements(process.id)
      if (response.data.success) {
        setReplacements(response.data.replacements || [])
      }
    } catch {
      // Non-critical
    }
  }

  const handleComplete = async () => {
    setCompleting(true)
    try {
      const response = await robotAssemblyService.completeStage(process.id, stageLabel, {})
      if (response.data.success) {
        showNotification(`${stageName} completed!`, 'success')
        if (onComplete) onComplete()
        onClose()
      }
    } catch (error) {
      const errData = error.response?.data
      if (errData?.blocking) {
        // Server-side blocking check caught it
        showNotification('Cannot complete — missing unpicked parts', 'error')
        checkUnpicked() // Refresh the blocking info
      } else {
        const errMsg = errData?.error || `Failed to complete ${stageName}`
        showNotification(errMsg, 'error')
      }
    } finally {
      setCompleting(false)
    }
  }

  const handleViewPDF = (partNumber, revision) => {
    if (!partNumber || !revision) return
    if (pdfUrl && pdfLabel === `${partNumber} REV${revision}`) {
      // Toggle off if same PDF
      setPdfUrl(null)
      setPdfLabel('')
    } else {
      setPdfUrl(`/api/part-pdf/${partNumber}/${revision}?t=${Date.now()}#toolbar=1&navpanes=0`)
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

  const handleRepickComplete = () => {
    // Re-check blocking status and refresh parts
    checkUnpicked()
    loadStageParts()
  }

  const handleDamagedPart = async (part) => {
    const confirmed = window.confirm(
      `Damaged part: ${part.part_number}\nTake 1x replacement from inventory?`
    )
    if (!confirmed) return
    try {
      const response = await robotAssemblyService.replacePart(process.id, {
        old_part_id: part.part_id,
        quantity: 1,
        reason: 'damaged',
        stage: stageLabel,
      })
      if (response.data.success) {
        showNotification(`Replacement taken from inventory: ${part.part_number}`, 'success')
        loadStageParts()
        loadReplacements()
      }
    } catch (error) {
      const errMsg = error.response?.data?.error || 'Failed to take replacement'
      showNotification(errMsg, 'error')
    }
  }

  // Check if a part has been replaced in this process
  const getReplacementInfo = (partNumber) => {
    return replacements.find(r =>
      r.old_part_number === partNumber || r.new_part_number === partNumber
    )
  }

  const isBlocking = unpickedCheck?.blocking === true

  return (
    <ResizableDialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      defaultHeight={650}
      id={`assembly-stage-${stageLabel}`}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {/* Assembly thumbnail */}
            {assembly?.thumbnail ? (
              <Avatar
                src={getThumbSrc(assembly.thumbnail)}
                variant="rounded"
                sx={{ width: 56, height: 56 }}
              />
            ) : (
              <Avatar
                variant="rounded"
                sx={{
                  width: 56,
                  height: 56,
                  bgcolor: isDark ? theme.palette.warning.dark : '#fff3e0',
                  color: isDark ? theme.palette.warning.light : '#e65100',
                }}
              >
                <AssemblyIcon />
              </Avatar>
            )}
            <Box>
              <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                {stageName}
              </Typography>
              {assembly && (
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'monospace', mt: 0.25 }}>
                  {assembly.part_number}
                  {assembly.revision && ` rev ${assembly.revision}`}
                </Typography>
              )}
              {assembly?.description && (
                <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 400 }}>
                  {assembly.description}
                </Typography>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Typography variant="caption" color="text.secondary">
                  {process?.process_number}
                </Typography>
                {previewMode && (
                  <Chip label="Preview" size="small" color="info" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
                )}
              </Box>
              {defaultDrawing && (
                <Chip
                  label={`Default: ${defaultDrawing.drawing_part_number || defaultDrawing.match_info?.match_key || 'Auto'}`}
                  size="small"
                  color="info"
                  variant="outlined"
                  sx={{ mt: 0.5 }}
                  onClick={() => {
                    const pn = defaultDrawing.drawing_part_number
                    if (pn) handleViewAI(pn)
                  }}
                />
              )}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {assembly && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Button
                  variant="contained"
                  onClick={() => {
                    // Stages 3.2, 5, 7 only use default drawing (no fallback to assembly's own part number)
                    const needsMapping = ['3.2', '5', '7'].includes(stageLabel)
                    const aiPn = needsMapping
                      ? defaultDrawing?.drawing_part_number
                      : (defaultDrawing?.drawing_part_number || assembly.part_number)
                    if (aiPn) handleViewAI(aiPn)
                  }}
                  sx={{
                    minWidth: 56,
                    minHeight: 56,
                    borderRadius: 2,
                    bgcolor: isDark ? theme.palette.warning.dark : '#ed6c02',
                    '&:hover': { bgcolor: isDark ? theme.palette.warning.main : '#e65100' },
                  }}
                >
                  <BuildIcon sx={{ fontSize: 28 }} />
                </Button>
                <Typography
                  variant="caption"
                  sx={{ mt: 0.5, fontWeight: 600, color: isDark ? theme.palette.warning.light : '#e65100', textAlign: 'center', lineHeight: 1.1 }}
                >
                  Assembly<br />Instructions
                </Typography>
              </Box>
            )}
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Preview mode: show only the drawing, full width */}
        {previewMode && (
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {pdfUrl ? (
              <>
                <Box sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  px: 1.5, py: 0.75, borderBottom: `1px solid`, borderColor: 'divider',
                  bgcolor: 'action.hover',
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PdfIcon fontSize="small" sx={{ color: 'error.main' }} />
                    <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>{pdfLabel}</Typography>
                  </Box>
                  <IconButton size="small" onClick={() => window.open(pdfUrl.split('#')[0], '_blank')}>
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Box sx={{ flex: 1, minHeight: 0 }}>
                  <iframe src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} title={pdfLabel} />
                </Box>
              </>
            ) : (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                {loading ? <CircularProgress /> : (
                  <Typography variant="body2" color="text.secondary">
                    No drawing found for this stage. Try clicking the Assembly Instructions button above.
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* Normal mode: unpicked parts blocking alert */}
        {!previewMode && isBlocking && (
          <Alert
            severity="error"
            icon={<WarningIcon />}
            sx={{ m: 2, mb: 0, flexShrink: 0 }}
            action={
              <Button
                color="error"
                variant="outlined"
                size="small"
                startIcon={<PickIcon />}
                onClick={() => setRepickModalOpen(true)}
              >
                Re-pick Parts
              </Button>
            }
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Missing Parts — Cannot Complete Stage
            </Typography>
            <Typography variant="body2">
              {unpickedCheck.missing_parts.length} part(s) were not picked during Stage 2.
              You must re-pick them before completing this stage.
            </Typography>
          </Alert>
        )}

        {/* Normal mode: parts list + optional PDF viewer side by side */}
        {!previewMode && <Box ref={containerRef} sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Parts list panel */}
          <Box sx={{ flex: pdfUrl ? `0 0 ${100 - pdfPanelPct}%` : '1 1 100%', overflow: 'auto', transition: pdfUrl ? 'none' : 'flex 0.3s ease' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : errorMsg ? (
              <Alert severity="warning" sx={{ m: 2 }}>{errorMsg}</Alert>
            ) : parts.length === 0 ? (
              <Alert severity="info" sx={{ m: 2 }}>
                No parts found for this assembly stage.
              </Alert>
            ) : (
              <List sx={{ p: 0 }}>
                {/* Sticky header */}
                <ListItem
                  sx={{
                    borderBottom: `2px solid ${isDark ? theme.palette.warning.light : '#ed6c02'}`,
                    bgcolor: isDark ? 'rgba(237, 108, 2, 0.15)' : '#fff3e0',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    py: 1,
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 700, color: isDark ? theme.palette.warning.light : '#e65100' }}
                    >
                      {parts.length} part(s) in this assembly
                    </Typography>
                  </Box>
                </ListItem>

                {parts.map((part, idx) => {
                  const qty = parseFloat(part.quantity || 1)
                  const inventory = part.inventory || 0
                  const isSubAssembly = part.is_assembly
                  const replacement = getReplacementInfo(part.part_number)
                  const isMissing = unpickedCheck?.missing_parts?.some(
                    mp => mp.part_number === part.part_number && (mp.revision || '') === (part.revision || '')
                  )

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
                        py: 1.25,
                        bgcolor: isMissing
                          ? (isDark ? 'rgba(244, 67, 54, 0.08)' : 'rgba(244, 67, 54, 0.04)')
                          : isSubAssembly
                            ? (isDark ? 'rgba(25, 118, 210, 0.08)' : 'rgba(25, 118, 210, 0.04)')
                            : 'transparent',
                      }}
                    >
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
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                {part.part_number}
                              </Typography>
                              {isSubAssembly && (
                                <Chip
                                  label="Assembly"
                                  size="small"
                                  color="primary"
                                  variant="outlined"
                                  sx={{ fontSize: '0.65rem', height: 18 }}
                                />
                              )}
                              {isMissing && (
                                <Chip
                                  label="Not Picked"
                                  size="small"
                                  color="error"
                                  sx={{ fontSize: '0.65rem', height: 18 }}
                                />
                              )}
                              {replacement && (
                                <Chip
                                  label="Replaced"
                                  size="small"
                                  color="warning"
                                  sx={{ fontSize: '0.65rem', height: 18 }}
                                />
                              )}
                            </Box>
                            <Typography variant="body2" color="text.secondary" noWrap>
                              {part.description || 'No description'}
                            </Typography>
                          </Box>

                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mx: 1, flexShrink: 0 }}>
                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Rev</Typography>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 700,
                                  color: isDark ? theme.palette.primary.light : '#1565c0',
                                  bgcolor: isDark ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.1)',
                                  px: 1, py: 0.25, borderRadius: 1,
                                }}
                              >
                                {part.revision || '-'}
                              </Typography>
                            </Box>
                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Qty</Typography>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 700,
                                  color: isDark ? theme.palette.primary.light : '#1565c0',
                                  bgcolor: isDark ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.1)',
                                  px: 1, py: 0.25, borderRadius: 1,
                                }}
                              >
                                {qty}
                              </Typography>
                            </Box>
                            {!isSubAssembly && (
                              <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Stock</Typography>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 700,
                                    color: inventoryColor,
                                    bgcolor: inventoryBgColor,
                                    px: 1, py: 0.25, borderRadius: 1,
                                  }}
                                >
                                  {inventory}
                                </Typography>
                              </Box>
                            )}
                          </Box>

                          {/* Per-part action buttons */}
                          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
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
        </Box>}
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose}>Close</Button>
        {!previewMode && (
          <Button
            variant="contained"
            color="success"
            startIcon={completing ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
            onClick={handleComplete}
            disabled={completing || isBlocking}
            sx={{ minWidth: 220 }}
          >
            {completing ? 'Completing...' : `Finished ${stageName}`}
          </Button>
        )}
      </DialogActions>

      {/* Re-pick Modal */}
      <RepickModal
        open={repickModalOpen}
        onClose={() => setRepickModalOpen(false)}
        process={process}
        missingParts={unpickedCheck?.missing_parts || []}
        onComplete={handleRepickComplete}
      />

    </ResizableDialog>
  )
}

export default AssemblyStageModal
