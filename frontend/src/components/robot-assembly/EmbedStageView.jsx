import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  Box,
  Typography,
  Avatar,
  List,
  ListItem,
  Divider,
  CircularProgress,
  Chip,
  Alert,
  Button,
  Checkbox,
  IconButton,
  Tooltip,
  Dialog,
  useTheme,
} from '@mui/material'
import {
  CheckCircle as CheckCircleIcon,
  Image as ImageIcon,
  Warning as WarningIcon,
  PictureAsPdf as PdfIcon,
  Build as BuildIcon,
  OpenInNew as OpenInNewIcon,
  Close as CloseIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  BrokenImage as DamagedIcon,
} from '@mui/icons-material'
import createEmbedService from '../../services/embedService'
import { getThumbSrc } from '../../utils/thumbnail'

/** Sort priority by part_type — lower = first. Mechanical types come first. */
const TYPE_SORT_ORDER = {
  'Mechanical part': 0,
  '3D Printing part': 1,
  'Bearings': 2,
  'Cross Roller Bearings': 3,
  'Gears': 4,
  'Motors': 5,
  'OTS': 6,
  'Assembly': 7,
  'Cables': 8,
  'Battery': 9,
  'Electrical OTS': 10,
  'Inhouse Electrical Part': 11,
  'Fasteners': 12,
  'Unknown': 13,
}
const getTypeSortKey = (partType) => TYPE_SORT_ORDER[partType] ?? 7

const STAGE_NAMES = {
  '2': 'Part Picking',
  '3.1': 'Motor Assembly',
  '3.2': 'Gear Assembly',
  '4': 'CHE 1',
  '5': 'Motor and Gear Assembly',
  '6': 'CHE 2',
  '7': 'Actuator Assembly',
  '8': 'CHE 3',
  '9': 'DOF Assembly',
}

/**
 * Embedded stage view for MenteeFlow iframes.
 * Renders without app shell (no nav, no login).
 * Communicates completion via postMessage to parent window.
 */
const EmbedStageView = () => {
  const { processNumber, stageNumber } = useParams()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const embedService = useMemo(() => createEmbedService(token), [token])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [parts, setParts] = useState([])
  const [assembly, setAssembly] = useState(null)
  const [completed, setCompleted] = useState(false)
  // Read-only "template" preview (DOF template process) — all write actions disabled
  const [readOnly, setReadOnly] = useState(false)

  // Picking state (stage 2)
  const [pickedParts, setPickedParts] = useState(new Set())

  // Unpicked blocking state (stages 3-6)
  const [blocking, setBlocking] = useState(false)
  const [missingParts, setMissingParts] = useState([])

  // Enlarged thumbnail state
  const [enlargedThumb, setEnlargedThumb] = useState(null) // { src, label }

  // Default drawing state
  const [defaultDrawing, setDefaultDrawing] = useState(null)
  // Fallback drawing options (shown when auto-resolution finds nothing)
  const [drawingOptions, setDrawingOptions] = useState([])

  // Inline PDF viewer state
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfLabel, setPdfLabel] = useState('')

  // Resizable split pane state
  const [pdfPanelPct, setPdfPanelPct] = useState(55)
  const [pdfFullscreen, setPdfFullscreen] = useState(false)
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

  const isPicking = stageNumber === '2'
  const isAssemblyStage = ['3.1', '3.2', '5', '7', '9'].includes(stageNumber)
  const stageName = STAGE_NAMES[stageNumber] || `Stage ${stageNumber}`

  useEffect(() => {
    if (!token) {
      setError('No embed token provided')
      setLoading(false)
      return
    }
    loadData()
  }, [token, processNumber, stageNumber])

  const loadData = async () => {
    setLoading(true)
    setError('')
    try {
      if (isPicking) {
        const resp = await embedService.getPickingParts(processNumber)
        if (resp.data.success) {
          setReadOnly(!!(resp.data.read_only || resp.data.is_template))
          const loadedParts = resp.data.parts || []
          setParts(loadedParts)

          // Restore previously saved picks
          const savedPicked = resp.data.saved_picked_parts || []
          if (savedPicked.length > 0) {
            const savedSet = new Set(savedPicked.map(sp => sp.part_number))
            const restoredIndices = new Set()
            loadedParts.forEach((part, idx) => {
              if (savedSet.has(part.part_number)) restoredIndices.add(idx)
            })
            setPickedParts(restoredIndices)
          }
        } else {
          setError(resp.data.error || 'Failed to load parts')
        }
      } else {
        const [stageResp, blockResp] = await Promise.all([
          embedService.getStageParts(processNumber, stageNumber),
          embedService.checkUnpickedBlocking(processNumber, stageNumber).catch(() => null),
        ])

        if (stageResp.data.success) {
          setReadOnly(!!(stageResp.data.read_only || stageResp.data.is_template))
          setAssembly(stageResp.data.assembly)
          setParts(stageResp.data.parts || [])
        } else {
          setError(stageResp.data.error || 'Failed to load stage parts')
        }

        if (blockResp?.data) {
          setBlocking(!!blockResp.data.blocking)
          setMissingParts(blockResp.data.missing_parts || [])
        }

        // Load default drawing and auto-open it
        const needsMapping = ['3.2', '5', '7'].includes(stageNumber)
        try {
          const drawingResp = await embedService.getDefaultDrawing(processNumber, stageNumber)
          if (drawingResp.data.success && drawingResp.data.default_drawing) {
            const dd = drawingResp.data.default_drawing
            setDefaultDrawing(dd)
            setDrawingOptions([])
            if (dd.drawing_part_number) {
              setPdfUrl(`${embedService.getPartAiUrl(dd.drawing_part_number)}#toolbar=1&navpanes=0`)
              setPdfLabel(`${dd.drawing_part_number} AI Instructions`)
            }
          } else if (needsMapping) {
            // No drawing resolved — fetch all options for this stage so user can pick manually
            try {
              const optResp = await embedService.getDrawingOptions(processNumber, stageNumber)
              if (optResp.data.success) setDrawingOptions(optResp.data.options || [])
            } catch { /* non-critical */ }
          }
        } catch {
          // Non-critical
        }
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to load data'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const notifyParent = (type, data = {}) => {
    try {
      window.parent.postMessage({
        source: 'menteebom-embed',
        type,
        processNumber,
        stage: stageNumber,
        ...data,
      }, '*')
    } catch {
      // Ignore cross-origin postMessage failures
    }
  }

  // --- PDF viewer handlers ---
  const handleViewPDF = (partNumber, revision) => {
    if (!partNumber || !revision) return
    const label = `${partNumber} REV${revision}`
    if (pdfUrl && pdfLabel === label) {
      setPdfUrl(null)
      setPdfLabel('')
    } else {
      setPdfUrl(`${embedService.getPartPdfUrl(partNumber, revision)}#toolbar=1&navpanes=0`)
      setPdfLabel(label)
    }
  }

  const handleViewAI = (partNumber) => {
    if (!partNumber) return
    const label = `${partNumber} AI Instructions`
    if (pdfUrl && pdfLabel === label) {
      setPdfUrl(null)
      setPdfLabel('')
    } else {
      setPdfUrl(`${embedService.getPartAiUrl(partNumber)}#toolbar=1&navpanes=0`)
      setPdfLabel(label)
    }
  }

  // --- Damaged part handler ---
  const handleDamagedPart = async (part) => {
    const confirmed = window.confirm(
      `Damaged part: ${part.part_number}\nTake 1x replacement from inventory?`
    )
    if (!confirmed) return
    try {
      await embedService.damagedPart(processNumber, stageNumber, {
        part_id: part.part_id,
      })
      // Reload parts to refresh inventory numbers
      loadData()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to withdraw replacement')
    }
  }

  // --- Late pick handler (assembly stages) ---
  const handleLatePick = async (part) => {
    const confirmed = window.confirm(
      `Pick ${part.part_number}?\nThis will withdraw ${part.quantity || 1}x from inventory.`
    )
    if (!confirmed) return
    try {
      await embedService.pickPart(processNumber, stageNumber, {
        part_id: part.part_id,
        part_number: part.part_number,
        revision: part.revision,
        quantity: part.quantity || 1,
      })
      loadData()
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to pick part')
    }
  }

  // --- Picking handlers ---
  const handleTogglePick = (idx) => {
    if (readOnly) return
    setPickedParts(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleToggleAll = () => {
    if (readOnly) return
    if (pickedParts.size === parts.length) {
      setPickedParts(new Set())
    } else {
      setPickedParts(new Set(parts.map((_, i) => i)))
    }
  }

  // Build picked/unpicked arrays from current state
  const buildPickingData = useCallback(() => {
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
      if (pickedParts.has(idx)) picked.push(item)
      else unpicked.push(item)
    })
    return { picked, unpicked }
  }, [parts, pickedParts])

  // Save partial picking progress (no stage completion)
  const savePicking = useCallback(async () => {
    if (!isPicking || parts.length === 0) return
    const { picked, unpicked } = buildPickingData()
    try {
      const resp = await embedService.savePicking(processNumber, {
        picked_parts: picked,
        unpicked_parts: unpicked,
      })
      if (resp.data.success) {
        notifyParent('picking-saved', {
          picked_count: picked.length,
          unpicked_count: unpicked.length,
        })
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save picking')
    }
  }, [isPicking, parts, buildPickingData, processNumber, embedService])

  // Batch late-pick all missing parts in assembly stages (called by check-all)
  const handlePickAllMissing = useCallback(async () => {
    const toPick = parts
      .filter(part => {
        const missing = missingParts.some(
          mp => mp.part_number === part.part_number && (mp.revision || '') === (part.revision || '')
        )
        return missing && !part.is_assembly
      })
      .map(part => ({
        part_id: part.part_id,
        part_number: part.part_number,
        revision: part.revision,
        quantity: part.quantity || 1,
      }))

    if (toPick.length === 0) return

    try {
      await embedService.pickAllMissing(processNumber, stageNumber, { parts: toPick })
      loadData()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to pick all missing parts')
    }
  }, [parts, missingParts, embedService, processNumber, stageNumber])

  // Listen for postMessage from MenteeFlow parent (e.g. save command, check-all)
  useEffect(() => {
    const handleMessage = (event) => {
      const msg = event.data
      if (!msg || msg.target !== 'menteebom-embed') return
      if (readOnly) return  // template preview — ignore parent write commands

      if (msg.action === 'save') {
        savePicking()
      }
      if (msg.action === 'check-all') {
        if (isPicking) {
          setPickedParts(new Set(parts.map((_, i) => i)))
        } else if (isAssemblyStage) {
          handlePickAllMissing()
        }
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [savePicking, parts, handlePickAllMissing, readOnly])

  const isAllPicked = parts.length > 0 && pickedParts.size === parts.length

  // Sort parts by type (mechanical first), preserving original index for picking
  const sortedParts = useMemo(() => {
    const indexed = parts.map((p, i) => ({ ...p, _origIdx: i }))
    indexed.sort((a, b) => {
      const aKey = getTypeSortKey(a.part_type)
      const bKey = getTypeSortKey(b.part_type)
      if (aKey !== bKey) return aKey - bKey
      return (a.part_number || '').localeCompare(b.part_number || '')
    })
    return indexed
  }, [parts])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
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

  if (completed) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', gap: 2 }}>
        <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main' }} />
        <Typography variant="h5">{stageName} Completed</Typography>
        <Typography variant="body1" color="text.secondary">
          Process {processNumber}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{
        p: 2, borderBottom: `2px solid ${theme.palette.divider}`,
        bgcolor: isDark ? 'rgba(25, 118, 210, 0.08)' : '#e3f2fd',
        flexShrink: 0,
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6">{stageName}</Typography>
            <Typography variant="body2" color="text.secondary">
              Process {processNumber}
              {assembly && ` — ${assembly.part_number}`}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Assembly-level AI button for non-picking stages */}
            {!isPicking && assembly?.part_number && (() => {
              // Stages 3.2, 5, 7 only use default drawing (no fallback to assembly's own part number)
              const needsMapping = ['3.2', '5', '7'].includes(stageNumber)
              const aiPartNumber = needsMapping
                ? defaultDrawing?.drawing_part_number
                : (defaultDrawing?.drawing_part_number || assembly.part_number)
              if (!aiPartNumber) return null
              return (
                <Tooltip title="Assembly Instructions (AI)">
                  <IconButton
                    size="small"
                    onClick={() => handleViewAI(aiPartNumber)}
                    sx={{
                      border: `1px solid ${theme.palette.divider}`,
                      ...(pdfUrl && pdfLabel === `${aiPartNumber} AI Instructions` ? {
                        bgcolor: isDark ? 'rgba(237, 108, 2, 0.2)' : 'rgba(237, 108, 2, 0.1)',
                        borderColor: theme.palette.warning.main,
                      } : {}),
                    }}
                  >
                    <BuildIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )
            })()}
            {isPicking && (
              <Chip
                label={`${pickedParts.size}/${parts.length} picked`}
                color={isAllPicked ? 'success' : 'default'}
                size="small"
              />
            )}
          </Box>
        </Box>
      </Box>

      {/* Read-only template preview banner */}
      {readOnly && (
        <Alert severity="info" sx={{ m: 2, mb: 0, flexShrink: 0 }}>
          Template — read-only preview of this DOF's stages. Picking and assembly actions are disabled.
        </Alert>
      )}

      {/* Blocking alert */}
      {blocking && !isPicking && !readOnly && (
        <Alert severity="error" icon={<WarningIcon />} sx={{ m: 2, mb: 0, flexShrink: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Missing Parts — Cannot Complete Stage
          </Typography>
          <Typography variant="body2">
            {missingParts.length} part(s) were not picked during Stage 2.
          </Typography>
        </Alert>
      )}

      {/* Drawing picker — shown when no drawing was auto-resolved for mapped stages */}
      {!defaultDrawing && drawingOptions.length > 0 && (
        <Box sx={{
          px: 2, py: 1, borderBottom: `1px solid ${theme.palette.divider}`,
          bgcolor: isDark ? 'rgba(255,152,0,0.06)' : 'rgba(255,152,0,0.06)',
          flexShrink: 0,
        }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            No drawing matched automatically — select the correct assembly drawing:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {drawingOptions.map((opt) => (
              <Chip
                key={opt.id}
                label={opt.display_label || opt.match_key}
                size="small"
                variant={pdfUrl && pdfLabel === `${opt.drawing_part_number} AI Instructions` ? 'filled' : 'outlined'}
                color={pdfUrl && pdfLabel === `${opt.drawing_part_number} AI Instructions` ? 'warning' : 'default'}
                onClick={() => handleViewAI(opt.drawing_part_number)}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Main content: parts list + optional PDF viewer */}
      <Box ref={containerRef} sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Parts list panel */}
        <Box sx={{ flex: pdfUrl ? `0 0 ${100 - pdfPanelPct}%` : '1 1 100%', overflow: 'auto', transition: pdfUrl ? 'none' : 'flex 0.3s ease' }}>
          {parts.length === 0 ? (
            <Alert severity="info" sx={{ m: 2 }}>No parts found.</Alert>
          ) : (
            <List sx={{ p: 0 }}>
              {isPicking && (
                <>
                  <ListItem
                    sx={{
                      borderBottom: `2px solid ${isDark ? theme.palette.primary.light : '#1565c0'}`,
                      bgcolor: isDark ? theme.palette.primary.dark : '#e3f2fd',
                      position: 'sticky', top: 0, zIndex: 1,
                    }}
                  >
                    <Checkbox
                      checked={isAllPicked}
                      indeterminate={pickedParts.size > 0 && !isAllPicked}
                      onChange={handleToggleAll}
                      disabled={readOnly}
                      sx={{ mr: 1 }}
                    />
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body1" sx={{ fontWeight: 700, color: isDark ? theme.palette.primary.light : '#1565c0' }}>
                        Select All Parts
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {parts.length} part(s) to pick
                      </Typography>
                    </Box>
                  </ListItem>
                  <Divider />
                </>
              )}

              {sortedParts.map((part) => {
                const idx = part._origIdx
                const qty = parseFloat(part.quantity || 1)
                const inventory = part.inventory || 0
                const isPicked = isPicking ? pickedParts.has(idx) : false
                const isMissing = missingParts.some(
                  mp => mp.part_number === part.part_number && (mp.revision || '') === (part.revision || '')
                )

                let inventoryColor = 'text.primary'
                if (inventory === 0) inventoryColor = isDark ? '#b0b0b0' : '#757575'
                else if (inventory < qty) inventoryColor = '#f44336'

                return (
                  <ListItem
                    key={idx}
                    sx={{
                      borderBottom: `1px solid ${theme.palette.divider}`,
                      py: 1.5,
                      cursor: isPicking && !readOnly ? 'pointer' : 'default',
                      bgcolor: isPicked
                        ? (isDark ? 'rgba(56, 142, 60, 0.2)' : '#e8f5e9')
                        : isMissing
                          ? (isDark ? 'rgba(244, 67, 54, 0.08)' : 'rgba(244, 67, 54, 0.04)')
                          : 'transparent',
                      '&:hover': isPicking ? {
                        bgcolor: isPicked
                          ? (isDark ? 'rgba(56, 142, 60, 0.25)' : '#c8e6c9')
                          : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                      } : {},
                    }}
                    onClick={isPicking && !readOnly ? () => handleTogglePick(idx) : undefined}
                  >
                    {isPicking && (
                      <Checkbox
                        checked={isPicked}
                        onChange={() => handleTogglePick(idx)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={readOnly}
                        sx={{ mr: 1 }}
                      />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        {part.thumbnail ? (
                          <Avatar
                            src={getThumbSrc(part.thumbnail)}
                            variant="rounded"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEnlargedThumb({
                                src: getThumbSrc(part.thumbnail),
                                label: part.part_number,
                              })
                            }}
                            sx={{
                              width: 48, height: 48, cursor: 'pointer',
                              transition: 'transform 0.15s, box-shadow 0.15s',
                              '&:hover': {
                                transform: 'scale(1.15)',
                                boxShadow: 3,
                              },
                            }}
                          />
                        ) : (
                          <Avatar variant="rounded" sx={{ width: 48, height: 48, bgcolor: theme.palette.action.hover }}>
                            <ImageIcon />
                          </Avatar>
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                              {part.part_number}
                            </Typography>
                            {part.part_type && (
                              <Chip label={part.part_type} size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />
                            )}
                            {isMissing && (
                              <Chip label="Not Picked" size="small" color="error" sx={{ fontSize: '0.65rem', height: 18 }} />
                            )}
                            {part.is_assembly && (
                              <Chip label="Assembly" size="small" color="primary" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                            )}
                          </Box>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {part.description || 'No description'}
                          </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                          <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              Qty
                            </Typography>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                              {qty}
                            </Typography>
                          </Box>
                          {!part.is_assembly && (
                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Stock</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, color: inventoryColor }}>
                                {inventory}
                              </Typography>
                            </Box>
                          )}
                          {part.warehouse_box && (
                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Box</Typography>
                              <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.78rem' }}>
                                {part.warehouse_box}
                              </Typography>
                            </Box>
                          )}
                        </Box>

                        {/* Action buttons */}
                        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          {/* Pick button — for unpicked parts in assembly stages */}
                          {isAssemblyStage && isMissing && !part.is_assembly && !readOnly && (
                            <Button
                              size="small"
                              variant="contained"
                              color="warning"
                              onClick={() => handleLatePick(part)}
                              sx={{ fontSize: '0.7rem', minWidth: 0, px: 1, py: 0.25, textTransform: 'none' }}
                            >
                              Pick
                            </Button>
                          )}
                          {/* Damaged Part button — assembly stages only, non-assembly parts */}
                          {isAssemblyStage && !part.is_assembly && !readOnly && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              startIcon={<DamagedIcon sx={{ fontSize: 16 }} />}
                              onClick={() => handleDamagedPart(part)}
                              sx={{ fontSize: '0.7rem', minWidth: 0, px: 1, py: 0.25, textTransform: 'none' }}
                            >
                              Damaged
                            </Button>
                          )}
                          {/* PDF button — picking: all parts; assembly: mechanical parts only */}
                          {part.revision && (isPicking || ['Mechanical part', '3D Printing part'].includes(part.part_type)) && (
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
        {pdfUrl && !pdfFullscreen && (
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
        )}
        {pdfUrl && (
          <Box sx={{
            ...(pdfFullscreen
              ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1300 }
              : { flex: `0 0 ${pdfPanelPct}%` }),
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
              flexShrink: 0,
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <PdfIcon fontSize="small" sx={{ color: theme.palette.error.main, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }} noWrap>
                  {pdfLabel}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                <Tooltip title={pdfFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                  <IconButton size="small" onClick={() => setPdfFullscreen(f => !f)}>
                    {pdfFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Open in new tab">
                  <IconButton size="small" onClick={() => window.open(pdfUrl.split('#')[0], '_blank')}>
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Close PDF">
                  <IconButton size="small" onClick={() => { setPdfUrl(null); setPdfLabel(''); setPdfFullscreen(false) }}>
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
        )}
      </Box>

      {/* Enlarged thumbnail dialog */}
      <Dialog
        open={!!enlargedThumb}
        onClose={() => setEnlargedThumb(null)}
        maxWidth="sm"
        PaperProps={{ sx: { bgcolor: 'transparent', boxShadow: 'none', overflow: 'visible' } }}
      >
        {enlargedThumb && (
          <Box sx={{ position: 'relative', textAlign: 'center' }}>
            <Box
              component="img"
              src={enlargedThumb.src}
              alt={enlargedThumb.label}
              sx={{
                maxWidth: '80vw',
                maxHeight: '70vh',
                borderRadius: 2,
                boxShadow: 6,
                bgcolor: 'background.paper',
              }}
            />
            <Typography
              variant="subtitle2"
              sx={{
                mt: 1,
                color: 'common.white',
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                fontFamily: 'monospace',
              }}
            >
              {enlargedThumb.label}
            </Typography>
          </Box>
        )}
      </Dialog>
    </Box>
  )
}

export default EmbedStageView
