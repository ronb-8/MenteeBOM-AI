import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Box,
  Typography,
  Button,
  TextField,
  InputAdornment,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Popover,
  Menu,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material'
import {
  Search as SearchIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  TableChart as SheetsIcon,
  Download as ExcelIcon,
  Article as ArticleIcon,
  PictureAsPdf as PdfIcon,
  Build as BuildIcon,
  CloudUpload as UploadIcon,
  ViewInAr as ViewInArIcon,
  Add as AddIcon,
  CloudSync as CloudSyncIcon,
  Refresh as RefreshIcon,
  LinkOff as LinkOffIcon,
  History as HistoryIcon,
} from '@mui/icons-material'
import MuiGrid from '@mui/material/Grid'
import { DataGrid } from '@mui/x-data-grid'
import { useTheme } from '@mui/material/styles'
import BOMsAndPartsTabBar from '../components/BOMsAndPartsTabBar'
import { bomService } from '../services/bomService'
import { bomCostService } from '../services/bomCostService'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import { hasThumbnail, getThumbnailSrc } from '../utils/thumbnail'

// ── helpers ────────────────────────────────────────────────────────────────

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null
}

const buildTypeChipStyle = (hexColor, isDark) => {
  const rgb = hexToRgb(hexColor || '#6c757d')
  if (!rgb) return { bg: isDark ? '#333' : '#f8f9fa', color: isDark ? '#fff' : '#6c757d', border: isDark ? '#555' : '#dee2e6' }
  if (isDark) {
    return {
      bg: `rgba(${rgb.r},${rgb.g},${rgb.b},0.25)`,
      color: '#fff',
      border: `rgba(${rgb.r},${rgb.g},${rgb.b},0.5)`,
    }
  }
  const blend = (v) => Math.round(v + (255 - v) * 0.88)
  return {
    bg: `rgba(${blend(rgb.r)},${blend(rgb.g)},${blend(rgb.b)},0.8)`,
    color: '#000',
    border: `rgba(${blend(rgb.r)},${blend(rgb.g)},${blend(rgb.b)},0.8)`,
  }
}

// ── component ──────────────────────────────────────────────────────────────

const PartsDatabase = () => {
  const { user } = useAuth()
  const { showNotification, liveVersions } = useNotification()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const canEdit = user?.role === 'admin' || user?.role === 'engineer'
  const canEditInventory = canEdit || user?.role === 'floor_manager' || user?.role === 'floor'

  // ── data state ──────────────────────────────────────────────────────────
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(false)
  const [partTypeColors, setPartTypeColors] = useState({})
  const [availableTypes, setAvailableTypes] = useState([])

  // ── UI state ────────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState([])
  const [editMode, setEditMode] = useState(false)
  const [pendingEdits, setPendingEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // thumbnail hover state
  const [hoveredPart, setHoveredPart] = useState(null)
  const [thumbnailAnchor, setThumbnailAnchor] = useState(null)

  // datasheet upload state
  const [datasheetDialog, setDatasheetDialog] = useState(null) // { partId, partNumber }
  const [datasheetFile, setDatasheetFile] = useState(null)
  const [uploadingDatasheet, setUploadingDatasheet] = useState(false)

  // add-part dialog state
  const [addPartOpen, setAddPartOpen] = useState(false)
  const [addPartLookingUp, setAddPartLookingUp] = useState(false)
  const [addPartCreating, setAddPartCreating] = useState(false)
  const [addPartForm, setAddPartForm] = useState({
    part_number: '', revision: '', description: '', material: '', finish1: '', finish2: '',
    state: '', part_type: '', vendor: '', manufacturer: '', manufacturer_pn: '',
    unit_cost: '', lead_time: '', inventory: '', warehouse_box_number: '', notes: '',
    has_pdf: false, has_ai_pdf: false, has_step: false, has_xt: false, step_files: [],
  })
  const [addPartPDMFetched, setAddPartPDMFetched] = useState(false)
  const [addPartExisting, setAddPartExisting] = useState(null) // { id } when part already exists

  // Orphan filter + bulk PDM refresh state
  const [orphanOnly, setOrphanOnly] = useState(false)
  const [refreshingPartId, setRefreshingPartId] = useState(null)
  const [historyDialog, setHistoryDialog] = useState(null) // { partId, partNumber }
  const [historyData, setHistoryData] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const openInventoryHistory = async (partId, partNumber) => {
    setHistoryDialog({ partId, partNumber })
    setHistoryData(null)
    setHistoryLoading(true)
    try {
      const res = await bomService.getPartInventoryHistory(partId)
      if (res.data?.success) setHistoryData(res.data)
      else showNotification(res.data?.error || 'Failed to load history', 'error')
    } catch (err) {
      showNotification('Failed to load inventory history', 'error')
    } finally {
      setHistoryLoading(false)
    }
  }
  const [refreshingBulk, setRefreshingBulk] = useState(false)
  const [refreshResult, setRefreshResult] = useState(null) // last result for display

  // ── helpers ──────────────────────────────────────────────────────────────
  const handleViewPDF = (partNumber, revision) => {
    if (!partNumber || !revision) return
    window.open(`/api/part-pdf/${partNumber}/${revision}?t=${Date.now()}`, '_blank')
  }
  const handleViewAI = (partNumber) => {
    if (!partNumber) return
    window.open(`/api/part-ai/${partNumber}`, '_blank')
  }
  const [stepMenuAnchor, setStepMenuAnchor] = useState(null)
  const [stepMenuFiles, setStepMenuFiles] = useState([])
  const [stepMenuContext, setStepMenuContext] = useState({})

  const handleDownloadSTEP = (event, partNumber, revision, stepFiles) => {
    if (!partNumber || !revision) return
    if (!stepFiles || stepFiles.length <= 1) {
      window.open(`/api/part-step/${partNumber}/${revision}`, '_blank')
    } else {
      setStepMenuAnchor(event.currentTarget)
      setStepMenuFiles(stepFiles)
      setStepMenuContext({ partNumber, revision })
    }
  }
  const isPdmPart = (partType) => {
    if (!partType) return false
    const t = partType.toLowerCase()
    return t === 'mp' || t.includes('mechanic') || t === 'as' || t.includes('assembly')
  }

  // ── load data ───────────────────────────────────────────────────────────
  const loadParts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await bomService.getAllPartsLatest()
      if (res.data.success) setParts(res.data.parts || [])
    } catch {
      if (!silent) showNotification('Error loading parts', 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [showNotification])

  const resetAddPartForm = () => {
    setAddPartForm({
      part_number: '', revision: '', description: '', material: '', finish1: '', finish2: '',
      state: '', part_type: '', vendor: '', manufacturer: '', manufacturer_pn: '',
      unit_cost: '', lead_time: '', inventory: '', warehouse_box_number: '', notes: '',
      has_pdf: false, has_ai_pdf: false, has_step: false, has_xt: false, step_files: [],
    })
    setAddPartPDMFetched(false)
    setAddPartExisting(null)
  }

  const handleOpenAddPart = () => {
    resetAddPartForm()
    setAddPartOpen(true)
  }

  const handleCloseAddPart = () => {
    if (addPartLookingUp || addPartCreating) return
    setAddPartOpen(false)
    resetAddPartForm()
  }

  const handleLookupPDM = async () => {
    const pn = (addPartForm.part_number || '').trim()
    if (!pn) {
      showNotification('Enter a part number first', 'warning')
      return
    }
    setAddPartLookingUp(true)
    try {
      const res = await bomService.lookupPartFromPDM(pn, (addPartForm.revision || '').trim())
      if (res.data.success) {
        const d = res.data.pdm_data || {}
        const revStripped = (res.data.revision_normalized || '').replace(/^REV/i, '')
        setAddPartForm(prev => ({
          ...prev,
          revision: revStripped || prev.revision,
          description: d.description || prev.description,
          material: d.material || prev.material,
          finish1: d.finish1 || prev.finish1,
          finish2: d.finish2 || prev.finish2,
          state: d.state || prev.state,
          part_type: d.part_type || prev.part_type,
          has_pdf: !!d.has_pdf,
          has_ai_pdf: !!d.has_ai_pdf,
          has_step: !!d.has_step,
          has_xt: !!d.has_xt,
          step_files: d.step_files || [],
        }))
        setAddPartPDMFetched(true)
        if (res.data.already_exists) {
          setAddPartExisting({ id: res.data.existing_part_id })
          showNotification('Part already exists in database — values pre-filled from PDM', 'warning')
        } else {
          setAddPartExisting(null)
          showNotification(`Pulled from PDM (state: ${d.state || 'unknown'})`, 'success')
        }
      } else {
        showNotification(res.data.error || 'PDM lookup failed', 'error')
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'PDM lookup failed', 'error')
    } finally {
      setAddPartLookingUp(false)
    }
  }

  const handleRefreshFromPDM = async ({ partIds = null, allOrphans = false } = {}) => {
    const payload = allOrphans ? { all_orphans: true } : { part_ids: partIds }
    try {
      const res = await bomService.refreshPartsFromPDM(payload)
      if (res.data.success) {
        const s = res.data.summary || {}
        setRefreshResult(res.data)
        const bits = []
        if (s.refreshed) bits.push(`${s.refreshed} part(s) refreshed`)
        if (s.new_revisions_added) bits.push(`${s.new_revisions_added} new revision(s) added`)
        if (s.errors) bits.push(`${s.errors} error(s)`)
        showNotification(bits.join(', ') || 'Refresh complete', s.errors ? 'warning' : 'success')
        loadParts()
      } else {
        showNotification(res.data.error || 'Refresh failed', 'error')
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'Refresh failed', 'error')
    }
  }

  const handleRefreshOne = async (partId) => {
    setRefreshingPartId(partId)
    try {
      await handleRefreshFromPDM({ partIds: [partId] })
    } finally {
      setRefreshingPartId(null)
    }
  }

  const handleRefreshAllOrphans = async () => {
    const orphanCount = parts.filter(p => p.is_orphan).length
    if (orphanCount === 0) {
      showNotification('No orphan parts to refresh', 'info')
      return
    }
    if (!window.confirm(`Refresh ${orphanCount} orphan part(s) from PDM? This will re-read metadata, refresh file flags, and add new Part rows for any newer revisions found in PDM.`)) return
    setRefreshingBulk(true)
    try {
      await handleRefreshFromPDM({ allOrphans: true })
    } finally {
      setRefreshingBulk(false)
    }
  }

  const handleCreatePart = async () => {
    const pn = (addPartForm.part_number || '').trim()
    if (!pn) {
      showNotification('Part number is required', 'warning')
      return
    }
    if (addPartExisting) {
      showNotification('This part already exists — edit it from the parts table instead', 'warning')
      return
    }
    setAddPartCreating(true)
    try {
      const payload = {
        ...addPartForm,
        part_number: pn,
        revision: (addPartForm.revision || '').trim(),
        part_type_manual: !!addPartForm.part_type,
      }
      const res = await bomService.createPart(payload)
      if (res.data.success) {
        showNotification(`Created ${res.data.part.part_number} ${res.data.part.revision}`, 'success')
        setAddPartOpen(false)
        resetAddPartForm()
        loadParts()
      } else {
        showNotification(res.data.error || 'Failed to create part', 'error')
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'Failed to create part', 'error')
    } finally {
      setAddPartCreating(false)
    }
  }

  const loadPartTypes = useCallback(async () => {
    try {
      const res = await bomCostService.getPartTypes()
      if (res.data.success) {
        const colors = {}
        ;(res.data.types_with_colors || []).forEach(({ name, color }) => {
          colors[name] = color
        })
        setPartTypeColors(colors)
        setAvailableTypes(res.data.types || [])
      }
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    loadParts()
    loadPartTypes()
  }, [loadParts, loadPartTypes])

  // Live update: silently re-fetch when another user changes parts.
  // Skipped while edit mode is active so an in-progress edit isn't clobbered.
  const liveInitRef = useRef(true)
  useEffect(() => {
    if (liveInitRef.current) {
      liveInitRef.current = false
      return
    }
    if (!editMode) loadParts(true)
  }, [liveVersions.parts])

  // ── filtering ───────────────────────────────────────────────────────────
  const filteredParts = useMemo(() => {
    return parts.filter(p => {
      const matchSearch =
        !searchTerm ||
        (p.part_number && p.part_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()))
      const matchType =
        typeFilter.length === 0 ||
        (p.part_type && typeFilter.some(t => t.toLowerCase() === p.part_type.toLowerCase()))
      const matchOrphan = !orphanOnly || p.is_orphan === true
      return matchSearch && matchType && matchOrphan
    })
  }, [parts, searchTerm, typeFilter, orphanOnly])

  const orphanCount = useMemo(() => parts.filter(p => p.is_orphan).length, [parts])

  // ── edit mode helpers ───────────────────────────────────────────────────
  const processRowUpdate = useCallback((newRow) => {
    if (editMode) {
      setPendingEdits(prev => ({ ...prev, [newRow.id]: newRow }))
    }
    return newRow
  }, [editMode])

  const handleCancelEdits = () => {
    setPendingEdits({})
    setEditMode(false)
  }

  const handleSaveEdits = async () => {
    if (Object.keys(pendingEdits).length === 0) {
      setEditMode(false)
      return
    }
    setSaving(true)
    try {
      const originalById = Object.fromEntries(parts.map(p => [p.id, p]))
      const updates = Object.values(pendingEdits).map(edited => {
        const orig = originalById[edited.id] || {}
        const update = { part_number: edited.part_number, revision: edited.revision }
        if (edited.description !== orig.description) update.description = edited.description
        if (edited.manufacturer !== orig.manufacturer) update.manufacturer = edited.manufacturer
        if (edited.manufacturer_pn !== orig.manufacturer_pn) update.manufacturer_pn = edited.manufacturer_pn
        if (edited.vendor !== orig.vendor) update.vendor = edited.vendor
        // Send '' (not null/undefined) when cleared so the backend clears the box
        if ((edited.warehouse_box_number ?? '') !== (orig.warehouse_box_number ?? '')) {
          update.warehouse_box_number = edited.warehouse_box_number ?? ''
        }
        if (edited.unit_cost !== orig.unit_cost && edited.unit_cost > 0) update.unit_cost = edited.unit_cost
        // Require a real number — a cleared cell yields null, and null >= 0 is
        // true (coerces to 0), which would silently zero the part's inventory
        if (edited.inventory !== orig.inventory && typeof edited.inventory === 'number' && Number.isFinite(edited.inventory) && edited.inventory >= 0) {
          update.add_inventory = edited.inventory - (orig.inventory || 0)
        }
        return update
      }).filter(u => Object.keys(u).length > 2) // must have more than just part_number + revision

      if (updates.length === 0) {
        showNotification('No changes to save', 'info')
        setEditMode(false)
        setPendingEdits({})
        return
      }

      const res = await bomCostService.updatePartPrices(updates)
      if (res.data.success) {
        showNotification('Parts updated successfully', 'success')
        setPendingEdits({})
        setEditMode(false)
        await loadParts()
      } else {
        showNotification('Failed to save changes', 'error')
      }
    } catch {
      showNotification('Error saving changes', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── export ──────────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    setExporting(true)
    try {
      const res = await bomService.exportPartsExcel()
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'parts_database.xlsx'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showNotification('Parts exported to Excel', 'success')
    } catch {
      showNotification('Error exporting to Excel', 'error')
    } finally {
      setExporting(false)
    }
  }

  const handleExportSheets = async () => {
    setExporting(true)
    try {
      const res = await bomService.exportPartsSheets()
      if (res.data.success) {
        showNotification('Parts exported to Google Sheets', 'success')
        if (res.data.spreadsheet_url) {
          window.open(res.data.spreadsheet_url, '_blank', 'noopener,noreferrer')
        }
      } else {
        showNotification('Failed to export to Google Sheets', 'error')
      }
    } catch {
      showNotification('Error exporting to Google Sheets', 'error')
    } finally {
      setExporting(false)
    }
  }

  // ── datasheet upload ─────────────────────────────────────────────────────
  const handleDatasheetUpload = async () => {
    if (!datasheetFile || !datasheetDialog) return
    setUploadingDatasheet(true)
    try {
      const formData = new FormData()
      formData.append('datasheet', datasheetFile)
      const res = await bomService.uploadPartDatasheet(datasheetDialog.partId, formData)
      if (res.data.success) {
        showNotification('Datasheet uploaded successfully', 'success')
        setDatasheetDialog(null)
        setDatasheetFile(null)
        await loadParts()
      } else {
        showNotification('Failed to upload datasheet', 'error')
      }
    } catch {
      showNotification('Error uploading datasheet', 'error')
    } finally {
      setUploadingDatasheet(false)
    }
  }

  // ── columns ──────────────────────────────────────────────────────────────
  const columns = useMemo(() => {
    const isEditable = (field) => {
      if (!editMode) return false
      if (field === 'inventory' || field === 'warehouse_box_number') return canEditInventory
      return canEdit
    }

    return [
      {
        field: 'part_number',
        headerName: 'Part Number',
        width: 230,
        renderCell: (params) => {
          const pn = params.value || 'N/A'
          const rev = params.row.revision || ''
          const thumb = params.row.thumbnail || {}
          const hasThumb = hasThumbnail(thumb)
          const isPdm = isPdmPart(params.row.part_type)

          const handleMouseEnter = (e) => {
            if (hasThumb) {
              setHoveredPart({ partNumber: pn, thumbnail: thumb })
              setThumbnailAnchor(e.currentTarget)
            }
          }
          const handleMouseLeave = () => {
            if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
              setHoveredPart(null)
              setThumbnailAnchor(null)
            }
          }
          const handleClick = (e) => {
            if (hasThumb) {
              if (hoveredPart?.partNumber === pn && thumbnailAnchor) {
                setHoveredPart(null)
                setThumbnailAnchor(null)
              } else {
                setHoveredPart({ partNumber: pn, thumbnail: thumb })
                setThumbnailAnchor(e.currentTarget)
              }
            }
          }

          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
              <Typography
                variant="body2"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                sx={{
                  cursor: hasThumb ? 'pointer' : 'default',
                  textDecoration: hoveredPart?.partNumber === pn ? 'underline' : 'none',
                  '&:hover': { textDecoration: hasThumb ? 'underline' : 'none' },
                }}
              >
                {pn}
              </Typography>
              {pn !== 'N/A' && rev && params.row.has_pdf && (
                <Tooltip title={`View PDF for ${pn}`}>
                  <IconButton
                    size="small"
                    onClick={e => { e.stopPropagation(); handleViewPDF(pn, rev) }}
                    sx={{ color: 'error.main' }}
                  >
                    <PdfIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {pn !== 'N/A' && params.row.has_ai_pdf && (
                <Tooltip title={`View AI file for ${pn}`}>
                  <IconButton
                    size="small"
                    onClick={e => { e.stopPropagation(); handleViewAI(pn) }}
                    sx={{ color: 'primary.main' }}
                  >
                    <BuildIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {pn !== 'N/A' && rev && params.row.has_step && (
                <Tooltip title={`Download STEP file for ${pn}`}>
                  <IconButton
                    size="small"
                    onClick={e => { e.stopPropagation(); handleDownloadSTEP(e, pn, rev, params.row.step_files) }}
                    sx={{ color: 'success.main' }}
                  >
                    <ViewInArIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {params.row.datasheet_drive_url && (
                <Tooltip title={`View datasheet for ${pn}`}>
                  <IconButton
                    size="small"
                    component="a"
                    href={params.row.datasheet_drive_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: 'info.main' }}
                    onClick={e => e.stopPropagation()}
                  >
                    <ArticleIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <Tooltip title={`Upload datasheet for ${pn}`}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDatasheetDialog({ partId: params.row.id, partNumber: pn })
                    setDatasheetFile(null)
                  }}
                  sx={{ color: 'text.disabled', '&:hover': { color: 'info.main' } }}
                >
                  <UploadIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          )
        },
      },
      {
        field: 'revision',
        headerName: 'Rev',
        width: 70,
        valueGetter: (value) => (value || '').replace(/^REV/i, ''),
      },
      {
        field: 'description',
        headerName: 'Description',
        width: 220,
      },
      {
        field: 'part_type',
        headerName: 'Type',
        width: 130,
        renderCell: (params) => {
          if (!params.value) return null
          const style = buildTypeChipStyle(partTypeColors[params.value], isDark)
          return (
            <Box sx={{
              backgroundColor: style.bg, color: style.color,
              border: `1px solid ${style.border}`,
              px: 1, py: 0.5, borderRadius: 1,
              fontSize: '0.75rem', fontWeight: 500,
              whiteSpace: 'normal', wordWrap: 'break-word',
              width: '100%', lineHeight: 1.4,
            }}>
              {params.value}
            </Box>
          )
        },
      },
      {
        field: 'manufacturer',
        headerName: 'Manufacturer',
        width: 150,
        editable: isEditable('manufacturer'),
        cellClassName: editMode && canEdit ? 'editable-cell' : '',
      },
      {
        field: 'manufacturer_pn',
        headerName: 'Manufacturer PN',
        width: 160,
        editable: isEditable('manufacturer_pn'),
        cellClassName: editMode && canEdit ? 'editable-cell' : '',
      },
      {
        field: 'vendor',
        headerName: 'Vendor',
        width: 140,
        editable: isEditable('vendor'),
        cellClassName: editMode && canEdit ? 'editable-cell' : '',
      },
      {
        field: 'unit_cost',
        headerName: 'Unit Cost',
        width: 110,
        type: 'number',
        editable: isEditable('unit_cost'),
        cellClassName: editMode && canEdit ? 'editable-cell' : '',
        renderCell: (params) =>
          params.value != null ? (
            <Typography variant="body2">${Number(params.value).toFixed(2)}</Typography>
          ) : (
            <Typography variant="body2" color="text.disabled">-</Typography>
          ),
      },
      {
        field: 'inventory',
        headerName: 'Inventory',
        width: 130,
        type: 'number',
        editable: isEditable('inventory'),
        cellClassName: editMode && canEditInventory ? 'editable-cell' : '',
        renderCell: (params) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%', justifyContent: 'flex-end' }}>
            <Typography variant="body2">{params.value != null ? params.value : '-'}</Typography>
            <Tooltip title="Inventory history">
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); openInventoryHistory(params.row.id, params.row.part_number) }}
                sx={{ p: 0.25 }}
              >
                <HistoryIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
      {
        field: 'warehouse_box_number',
        headerName: 'Box',
        width: 90,
        editable: isEditable('warehouse_box_number'),
        cellClassName: editMode && canEditInventory ? 'editable-cell' : '',
      },
      {
        field: '_actions',
        headerName: 'Actions',
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (params) => {
          if (!canEdit) return null
          const isOrphan = params.row.is_orphan === true
          if (!isOrphan) {
            return (
              <Tooltip title="Linked to a BOM — re-sync via BOM import">
                <Chip label="In BOM" size="small" variant="outlined" color="default" sx={{ height: 20, fontSize: '0.65rem' }} />
              </Tooltip>
            )
          }
          const refreshing = refreshingPartId === params.row.id
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Chip label="Orphan" size="small" color="warning" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
              <Tooltip title="Refresh this part from PDM (metadata, file flags, latest revision)">
                <span>
                  <IconButton
                    size="small"
                    color="warning"
                    disabled={refreshing}
                    onClick={(e) => { e.stopPropagation(); handleRefreshOne(params.row.id) }}
                  >
                    {refreshing ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          )
        },
      },
    ]
  }, [editMode, canEdit, canEditInventory, partTypeColors, isDark, refreshingPartId])

  // ── rows with pending edits merged ────────────────────────────────────────
  const rows = useMemo(() => {
    return filteredParts.map(p => {
      const edit = pendingEdits[p.id]
      return edit ? { ...p, ...edit } : p
    })
  }, [filteredParts, pendingEdits])

  // ── toolbar component ────────────────────────────────────────────────────
  const Toolbar = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
      <TextField
        size="small"
        placeholder="Search parts…"
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        sx={{ width: 220 }}
      />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Type:</Typography>
        {availableTypes.map(t => (
          <Chip
            key={t}
            label={t}
            size="small"
            clickable
            color={typeFilter.includes(t) ? 'primary' : 'default'}
            variant={typeFilter.includes(t) ? 'filled' : 'outlined'}
            onClick={() => setTypeFilter(prev =>
              prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
            )}
          />
        ))}
        {typeFilter.length > 0 && (
          <Chip label="Clear" size="small" variant="outlined" color="error" onClick={() => setTypeFilter([])} />
        )}
        <Chip
          icon={<LinkOffIcon style={{ fontSize: 14 }} />}
          label={`Orphans${orphanCount ? ` (${orphanCount})` : ''}`}
          size="small"
          clickable
          color={orphanOnly ? 'warning' : 'default'}
          variant={orphanOnly ? 'filled' : 'outlined'}
          onClick={() => setOrphanOnly(v => !v)}
        />
      </Box>

      <Box sx={{ flexGrow: 1 }} />

      {canEdit && !editMode && orphanCount > 0 && (
        <Tooltip title={`Re-pull PDM data for all ${orphanCount} orphan part(s)`}>
          <span>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={refreshingBulk ? <CircularProgress size={14} /> : <RefreshIcon />}
              onClick={handleRefreshAllOrphans}
              disabled={refreshingBulk}
            >
              {refreshingBulk ? 'Refreshing…' : 'Refresh Orphans'}
            </Button>
          </span>
        </Tooltip>
      )}

      {canEdit && !editMode && (
        <Button size="small" variant="contained" color="primary" startIcon={<AddIcon />} onClick={handleOpenAddPart}>
          Add Part
        </Button>
      )}

      {!editMode ? (
        (canEdit || canEditInventory) && (
          <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => setEditMode(true)}>
            Edit Mode
          </Button>
        )
      ) : (
        <>
          <Button size="small" variant="contained" color="success" startIcon={saving ? <CircularProgress size={14} /> : <SaveIcon />}
            onClick={handleSaveEdits} disabled={saving}>
            Save
          </Button>
          <Button size="small" variant="outlined" color="error" startIcon={<CancelIcon />}
            onClick={handleCancelEdits} disabled={saving}>
            Cancel
          </Button>
          {Object.keys(pendingEdits).length > 0 && (
            <Chip label={`${Object.keys(pendingEdits).length} change(s)`} size="small" color="warning" />
          )}
        </>
      )}

      <Tooltip title="Export to Excel">
        <span>
          <Button size="small" variant="outlined" color="info" startIcon={<ExcelIcon />}
            onClick={handleExportExcel} disabled={exporting}>
            Excel
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="Export to Google Sheets">
        <span>
          <Button size="small" variant="outlined" color="success" startIcon={<SheetsIcon />}
            onClick={handleExportSheets} disabled={exporting}>
            Sheets
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        <IconButton size="small" onClick={() => setFullscreen(f => !f)}>
          {fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
        </IconButton>
      </Tooltip>
    </Box>
  )

  // ── grid ─────────────────────────────────────────────────────────────────
  const Grid = (
    <>
      {Toolbar}
      <DataGrid
        rows={rows}
        columns={columns}
        loading={loading}
        processRowUpdate={processRowUpdate}
        disableRowSelectionOnClick
        density="compact"
        sx={{
          flexGrow: 1,
          '& .editable-cell': {
            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(25,118,210,0.04)',
          },
        }}
        initialState={{ pagination: { paginationModel: { pageSize: 50 } } }}
        pageSizeOptions={[25, 50, 100]}
      />
    </>
  )

  return (
    <Box sx={{ width: '100%', height: 'calc(100vh - 44px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, pt: 0.75, pb: 0.25, flexShrink: 0 }}>
        <BOMsAndPartsTabBar />
        <Typography variant="h5" sx={{ fontSize: '0.95rem', fontWeight: 600, mb: 0.25 }}>
          Parts List in DataBase
        </Typography>
        <Typography variant="body2" color="text.secondary">
          All parts — latest revision per part number
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflow: 'hidden', px: 1.5, pb: 0.25, display: 'flex', flexDirection: 'column' }}>
        {Grid}
      </Box>

      {/* Fullscreen dialog */}
      <Dialog open={fullscreen} onClose={() => setFullscreen(false)} fullScreen>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', p: 2 }}>
          {Grid}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFullscreen(false)} startIcon={<FullscreenExitIcon />}>
            Exit Fullscreen
          </Button>
        </DialogActions>
      </Dialog>

      {/* Thumbnail hover popover */}
      <Popover
        open={!!hoveredPart && !!thumbnailAnchor}
        anchorEl={thumbnailAnchor}
        onClose={() => { setHoveredPart(null); setThumbnailAnchor(null) }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        disableRestoreFocus
        sx={{ pointerEvents: ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 'auto' : 'none' }}
        PaperProps={{
          onMouseLeave: () => {
            if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
              setHoveredPart(null)
              setThumbnailAnchor(null)
            }
          },
          onClick: () => {
            if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
              setHoveredPart(null)
              setThumbnailAnchor(null)
            }
          },
          sx: { pointerEvents: 'auto', p: 1, maxWidth: 300, maxHeight: 300 },
        }}
      >
        {hasThumbnail(hoveredPart?.thumbnail) ? (
          <Box sx={{ textAlign: 'center' }}>
            <img
              src={getThumbnailSrc(hoveredPart.thumbnail)}
              alt={hoveredPart.partNumber}
              style={{ maxWidth: 250, maxHeight: 250, width: 'auto', height: 'auto', display: 'block', margin: '0 auto' }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {hoveredPart.partNumber}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ p: 2, textAlign: 'center', minWidth: 150 }}>
            <Typography variant="body2" color="text.secondary">No thumbnail available</Typography>
          </Box>
        )}
      </Popover>

      {/* Add Part dialog */}
      <Dialog open={addPartOpen} onClose={handleCloseAddPart} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddIcon /> Add Part to Database
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Create a part in the master library without a BOM. Enter the part number and revision, then pull metadata from PDM. When a BOM later references this part (same part number + revision), it will auto-link.
          </Typography>

          <MuiGrid container spacing={2} sx={{ mt: 0.5 }}>
            <MuiGrid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth size="small" required
                label="Part Number"
                value={addPartForm.part_number}
                onChange={e => setAddPartForm(p => ({ ...p, part_number: e.target.value }))}
                disabled={addPartLookingUp || addPartCreating}
              />
            </MuiGrid>
            <MuiGrid size={{ xs: 12, sm: 3 }}>
              <TextField
                fullWidth size="small"
                label="Revision"
                placeholder="e.g. 01"
                value={addPartForm.revision}
                onChange={e => setAddPartForm(p => ({ ...p, revision: e.target.value }))}
                disabled={addPartLookingUp || addPartCreating}
              />
            </MuiGrid>
            <MuiGrid size={{ xs: 12, sm: 3 }}>
              <Button
                fullWidth variant="outlined" color="info"
                startIcon={addPartLookingUp ? <CircularProgress size={14} /> : <CloudSyncIcon />}
                onClick={handleLookupPDM}
                disabled={addPartLookingUp || addPartCreating || !addPartForm.part_number.trim()}
              >
                {addPartLookingUp ? 'Looking up…' : 'Pull from PDM'}
              </Button>
            </MuiGrid>

            {addPartPDMFetched && (
              <MuiGrid size={12}>
                <Box sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>PDM:</Typography>
                  {addPartForm.state && <Chip size="small" label={`State: ${addPartForm.state}`} color="primary" />}
                  {addPartForm.part_type && <Chip size="small" label={addPartForm.part_type} variant="outlined" />}
                  <Chip size="small" label={`PDF ${addPartForm.has_pdf ? '✓' : '✗'}`} color={addPartForm.has_pdf ? 'success' : 'default'} variant="outlined" />
                  <Chip size="small" label={`AI PDF ${addPartForm.has_ai_pdf ? '✓' : '✗'}`} color={addPartForm.has_ai_pdf ? 'success' : 'default'} variant="outlined" />
                  <Chip size="small" label={`STEP ${addPartForm.has_step ? '✓' : '✗'}`} color={addPartForm.has_step ? 'success' : 'default'} variant="outlined" />
                  <Chip size="small" label={`X_T ${addPartForm.has_xt ? '✓' : '✗'}`} color={addPartForm.has_xt ? 'success' : 'default'} variant="outlined" />
                  {addPartExisting && (
                    <Chip size="small" label="Already in DB" color="warning" />
                  )}
                </Box>
              </MuiGrid>
            )}

            <MuiGrid size={12}>
              <TextField fullWidth size="small" label="Description" multiline maxRows={3}
                value={addPartForm.description}
                onChange={e => setAddPartForm(p => ({ ...p, description: e.target.value }))}
                disabled={addPartCreating} />
            </MuiGrid>
            <MuiGrid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Material"
                value={addPartForm.material}
                onChange={e => setAddPartForm(p => ({ ...p, material: e.target.value }))}
                disabled={addPartCreating} />
            </MuiGrid>
            <MuiGrid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Part Type"
                value={addPartForm.part_type}
                onChange={e => setAddPartForm(p => ({ ...p, part_type: e.target.value }))}
                disabled={addPartCreating} />
            </MuiGrid>
            <MuiGrid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Finish 1"
                value={addPartForm.finish1}
                onChange={e => setAddPartForm(p => ({ ...p, finish1: e.target.value }))}
                disabled={addPartCreating} />
            </MuiGrid>
            <MuiGrid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth size="small" label="Finish 2"
                value={addPartForm.finish2}
                onChange={e => setAddPartForm(p => ({ ...p, finish2: e.target.value }))}
                disabled={addPartCreating} />
            </MuiGrid>

          </MuiGrid>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAddPart} disabled={addPartLookingUp || addPartCreating}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleCreatePart}
            disabled={addPartLookingUp || addPartCreating || !addPartForm.part_number.trim() || !!addPartExisting}
            startIcon={addPartCreating ? <CircularProgress size={14} /> : <SaveIcon />}
          >
            {addPartCreating ? 'Creating…' : 'Create Part'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Datasheet upload dialog */}
      <Dialog open={!!datasheetDialog} onClose={() => { setDatasheetDialog(null); setDatasheetFile(null) }} maxWidth="sm" fullWidth>
        <DialogTitle>Upload Datasheet — {datasheetDialog?.partNumber}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            The datasheet will be saved to Google Drive and linked to this part (all revisions).
          </Typography>
          <Button variant="outlined" component="label" startIcon={<UploadIcon />}>
            {datasheetFile ? datasheetFile.name : 'Choose file…'}
            <input type="file" hidden accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
              onChange={e => setDatasheetFile(e.target.files?.[0] || null)} />
          </Button>
          {datasheetDialog && parts.find(p => p.id === datasheetDialog.partId)?.datasheet_drive_url && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Current:{' '}
                <a href={parts.find(p => p.id === datasheetDialog.partId).datasheet_drive_url}
                  target="_blank" rel="noopener noreferrer">
                  View existing datasheet
                </a>
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDatasheetDialog(null); setDatasheetFile(null) }}>Cancel</Button>
          <Button variant="contained" onClick={handleDatasheetUpload}
            disabled={!datasheetFile || uploadingDatasheet}
            startIcon={uploadingDatasheet ? <CircularProgress size={14} /> : <UploadIcon />}>
            Upload
          </Button>
        </DialogActions>
      </Dialog>

      {/* Inventory history dialog */}
      <Dialog open={!!historyDialog} onClose={() => setHistoryDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <HistoryIcon fontSize="small" />
            Inventory History — {historyDialog?.partNumber}
            {historyData && (
              <Chip size="small" label={`Current stock: ${historyData.current_inventory}`} color="primary" sx={{ ml: 1 }} />
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          {historyLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : !historyData || historyData.transactions.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No inventory movements recorded yet. History starts from the moment this feature was deployed.
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 440 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>When</TableCell>
                    <TableCell>Rev</TableCell>
                    <TableCell align="right">Change</TableCell>
                    <TableCell align="right">Before → After</TableCell>
                    <TableCell>Reason</TableCell>
                    <TableCell>Reference</TableCell>
                    <TableCell>By</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {historyData.transactions.map(t => (
                    <TableRow key={t.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {t.created_at ? new Date(t.created_at + 'Z').toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>{t.revision || '-'}</TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" fontWeight={600}
                          color={t.qty_change > 0 ? 'success.main' : 'error.main'}>
                          {t.qty_change > 0 ? `+${t.qty_change}` : t.qty_change}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {t.qty_before != null ? t.qty_before : '?'} → {t.qty_after != null ? t.qty_after : '?'}
                      </TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={t.reason} sx={{ height: 20, fontSize: '0.7rem' }} />
                      </TableCell>
                      <TableCell>{t.reference || '-'}</TableCell>
                      <TableCell>{t.username || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryDialog(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* STEP files dropdown menu */}
      <Menu
        anchorEl={stepMenuAnchor}
        open={Boolean(stepMenuAnchor)}
        onClose={() => setStepMenuAnchor(null)}
      >
        {stepMenuFiles.map((filename) => (
          <MenuItem
            key={filename}
            onClick={() => {
              window.open(`/api/part-step-file/${encodeURIComponent(filename)}`, '_blank')
              setStepMenuAnchor(null)
            }}
          >
            {filename.replace(/\.(step|stp)$/i, '')}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}

export default PartsDatabase
