/**
 * LimbSubAssemblyModal
 * Build modal for a sub-assembly node within a limb's assembly tree.
 * Shows parts list with inventory, PDF and AI instruction links.
 * "Collect Parts" reduces inventory in the DB (MenteeBOM only, no MenteeFlow connection).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Typography,
  List,
  ListItem,
  Button,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Chip,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material'
import {
  Close as CloseIcon,
  PictureAsPdf as PdfIcon,
  Build as BuildIcon,
  CheckCircle as CheckIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material'
import { useTheme } from '@mui/material/styles'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import ResizableDialog from '../ResizableDialog'
import ThumbnailZoom from './ThumbnailZoom'
import { getThumbSrc } from '../../utils/thumbnail'

const LimbSubAssemblyModal = ({ open, onClose, node }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showNotification } = useNotification()

  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [collected, setCollected] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

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

  // node.bom_instance_id may be present if the assembly has its own BOM ID
  // Otherwise we show the immediate children from the effective tree node
  const bomInstanceId = node?.bom_instance_id || null

  useEffect(() => {
    if (!open || !node) return
    setCollected(false)
    setErrorMsg(null)

    if (bomInstanceId) {
      // Fetch from dedicated endpoint
      setLoading(true)
      robotAssemblyService.getAssemblyBuildData(bomInstanceId)
        .then(resp => {
          if (resp.data.success) setParts(resp.data.parts)
          else setErrorMsg(resp.data.error || 'Failed to load parts')
        })
        .catch(() => setErrorMsg('Failed to load parts'))
        .finally(() => setLoading(false))
    } else {
      // Use the children already in the effective tree node
      const childParts = (node.children || []).map(child => ({
        part_id: child.part_id,
        part_number: child.part_number,
        revision: child.revision || '',
        part_name: child.part_name || '',
        description: child.description || '',
        quantity: child.quantity,
        inventory: child.inventory,
        warehouse_box: child.warehouse_box || '',
        datasheet_drive_url: child.datasheet_drive_url || null,
        thumbnail: child.thumbnail || null,
        is_assembly: child.is_assembly || false,
        level: child.level || 1,
      }))
      setParts(childParts)
    }
  }, [open, node, bomInstanceId])

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

  const handleCollectParts = async () => {
    const collectableParts = parts.filter(p => !p.is_assembly && p.part_id)
    if (collectableParts.length === 0) {
      showNotification('No parts to collect', 'warning')
      return
    }
    setCollecting(true)
    try {
      const partsPayload = collectableParts.map(p => ({
        part_id: p.part_id,
        qty: p.quantity,
      }))

      const resp = bomInstanceId
        ? await robotAssemblyService.collectAssemblyParts(bomInstanceId, partsPayload)
        : await robotAssemblyService.collectPartsDirect(partsPayload)

      if (resp.data.success) {
        setCollected(true)
        showNotification(resp.data.message || 'Parts collected and inventory updated', 'success')
        const updatedMap = {}
        resp.data.updated.forEach(u => { updatedMap[u.part_id] = u.new_inventory })
        setParts(prev => prev.map(p => updatedMap[p.part_id] !== undefined
          ? { ...p, inventory: updatedMap[p.part_id] }
          : p
        ))
      } else {
        showNotification(resp.data.error || 'Collection failed', 'error')
      }
    } catch {
      showNotification('Failed to collect parts', 'error')
    } finally {
      setCollecting(false)
    }
  }

  const assemblyName = node?.description || node?.part_name || node?.part_number || 'Assembly'
  const assemblyPN = node?.part_number || ''
  const assemblyRev = node?.revision || ''

  return (
    <ResizableDialog open={open} onClose={onClose} maxWidth="md" fullWidth defaultHeight={600} id="limb-sub-assembly-modal">
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ThumbnailZoom
              src={node?.thumbnail ? getThumbSrc(node.thumbnail) : null}
              alt={assemblyName}
              size={52}
            />
            <Box>
              <Typography variant="h6">{assemblyName}</Typography>
              <Typography variant="body2" color="text.secondary">
                {assemblyPN}{assemblyRev ? ` · Rev ${assemblyRev}` : ''} · {parts.length} part(s)
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Assembly-level PDF & AI */}
            {assemblyPN && assemblyRev && (
              <Tooltip title="Assembly Drawing (PDF)">
                <IconButton size="small" onClick={() => handleViewPDF(assemblyPN, assemblyRev)}
                  sx={{ border: `1px solid ${theme.palette.divider}` }}>
                  <PdfIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {assemblyPN && (
              <Tooltip title="Assembly Instructions (AI)">
                <IconButton size="small" onClick={() => handleViewAI(assemblyPN)}
                  sx={{ border: `1px solid ${theme.palette.divider}` }}>
                  <BuildIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box ref={containerRef} sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* Parts list panel */}
          <Box sx={{ flex: pdfUrl ? `0 0 ${100 - pdfPanelPct}%` : '1 1 100%', overflow: 'auto', transition: pdfUrl ? 'none' : 'flex 0.3s ease' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
            ) : errorMsg ? (
              <Alert severity="warning" sx={{ m: 2 }}>{errorMsg}</Alert>
            ) : collected ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 5, gap: 2 }}>
                <CheckIcon sx={{ fontSize: 64, color: 'success.main' }} />
                <Typography variant="h6" color="success.main">Parts Collected!</Typography>
                <Typography variant="body2" color="text.secondary">Inventory has been updated.</Typography>

                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    For assembly instructions use:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    {assemblyPN && assemblyRev && (
                      <Button
                        variant="outlined"
                        size="large"
                        startIcon={<PdfIcon sx={{ fontSize: 28 }} />}
                        onClick={() => handleViewPDF(assemblyPN, assemblyRev)}
                        sx={{ px: 3, py: 1.5, fontSize: '0.95rem' }}
                      >
                        Drawing (PDF)
                      </Button>
                    )}
                    {assemblyPN && (
                      <Button
                        variant="outlined"
                        size="large"
                        startIcon={<BuildIcon sx={{ fontSize: 28 }} />}
                        onClick={() => handleViewAI(assemblyPN)}
                        sx={{ px: 3, py: 1.5, fontSize: '0.95rem' }}
                      >
                        Assembly Instructions (AI)
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            ) : parts.length === 0 ? (
              <Alert severity="info" sx={{ m: 2 }}>No parts found for this assembly.</Alert>
            ) : (
              <List sx={{ p: 0 }}>
                {/* Sticky header */}
                <ListItem
                  sx={{
                    bgcolor: isDark ? 'rgba(25,118,210,0.15)' : '#e3f2fd',
                    borderBottom: `2px solid ${theme.palette.primary.main}`,
                    position: 'sticky', top: 0, zIndex: 1, py: 0.75,
                  }}
                >
                  <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 130 }}>Part Number</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>Description</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 40, textAlign: 'right' }}>Qty</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60, textAlign: 'right' }}>Stock</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, textAlign: 'right' }}>Box</Typography>
                    <Box sx={{ width: 60 }} />
                  </Box>
                </ListItem>

                {parts.map((part, idx) => {
                  const isLow = part.inventory !== null && part.inventory < part.quantity
                  return (
                    <ListItem
                      key={idx}
                      sx={{
                        borderBottom: `1px solid ${theme.palette.divider}`,
                        bgcolor: isLow ? (isDark ? 'rgba(211,47,47,0.12)' : '#ffebee') : 'transparent',
                        py: 1,
                      }}
                    >
                      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                        {/* Thumbnail */}
                        <ThumbnailZoom
                          src={part.thumbnail ? getThumbSrc(part.thumbnail) : null}
                          alt={part.part_number}
                          size={40}
                        />

                        {/* Part number */}
                        <Box sx={{ minWidth: 130 }}>
                          <Typography fontFamily="monospace" fontSize="0.82rem" fontWeight={600}>
                            {part.part_number}
                          </Typography>
                          {part.revision && (
                            <Typography variant="caption" color="text.secondary">Rev {part.revision}</Typography>
                          )}
                          {part.is_assembly && (
                            <Chip label="Assembly" size="small" color="primary" variant="outlined"
                              sx={{ fontSize: '0.6rem', height: 16, ml: 0.5 }} />
                          )}
                        </Box>

                        {/* Description */}
                        <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }} noWrap title={part.description || part.part_name}>
                          {part.description || part.part_name}
                        </Typography>

                        {/* Quantity */}
                        <Typography variant="body2" sx={{ minWidth: 40, textAlign: 'right', fontWeight: 600 }}>
                          {part.quantity}
                        </Typography>

                        {/* Inventory */}
                        <Typography
                          variant="body2"
                          sx={{
                            minWidth: 60, textAlign: 'right',
                            color: isLow ? 'error.main' : 'success.main',
                            fontWeight: 600,
                          }}
                        >
                          {part.inventory ?? '—'}
                        </Typography>

                        {/* Warehouse box */}
                        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, textAlign: 'right' }}>
                          {part.warehouse_box || '—'}
                        </Typography>

                        {/* PDF + AI buttons */}
                        <Box sx={{ display: 'flex', gap: 0.5, width: 60, justifyContent: 'flex-end' }}>
                          {part.revision && (
                            <Tooltip title={pdfUrl && pdfLabel === `${part.part_number} REV${part.revision}` ? 'Close PDF' : 'Drawing (PDF)'}>
                              <IconButton
                                size="small"
                                onClick={() => handleViewPDF(part.part_number, part.revision)}
                                sx={pdfUrl && pdfLabel === `${part.part_number} REV${part.revision}` ? {
                                  bgcolor: isDark ? 'rgba(211, 47, 47, 0.2)' : 'rgba(211, 47, 47, 0.1)',
                                  color: theme.palette.error.main,
                                } : {}}
                              >
                                <PdfIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Assembly Instructions (AI)">
                            <IconButton size="small" onClick={() => handleViewAI(part.part_number)}>
                              <BuildIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
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
        <Button onClick={onClose}>Close</Button>
        {collected && (
          <Button
            variant="contained"
            color="success"
            onClick={onClose}
            startIcon={<CheckIcon />}
          >
            Finished Assembly
          </Button>
        )}
        {!collected && !loading && parts.length > 0 && (
          <Button
            variant="contained"
            color="success"
            onClick={handleCollectParts}
            disabled={collecting}
            startIcon={collecting ? <CircularProgress size={16} /> : <CheckIcon />}
          >
            {collecting ? 'Collecting...' : 'Collect Parts & Update Inventory'}
          </Button>
        )}
      </DialogActions>
    </ResizableDialog>
  )
}

export default LimbSubAssemblyModal
