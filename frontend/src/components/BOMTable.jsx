import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { getSemanticColors } from '../utils/themeColors'
import { DataGrid } from '@mui/x-data-grid'
import {
  Box,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
  IconButton,
  Tooltip,
  Chip,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Checkbox,
  useTheme,
  CircularProgress,
  Popover,
  Dialog,
  Menu,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import { formatPrice } from '../utils/priceFormatter'
import {
  Search as SearchIcon,
  Image as ImageIcon,
  PictureAsPdf as PdfIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Build as BuildIcon,
  Upload as UploadIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  SwapHoriz as SwapHorizIcon,
  Article as ArticleIcon,
  ViewInAr as ViewInArIcon,
  ThreeDRotation as ThreeDIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material'
import { bomService } from '../services/bomService'
import { bomCostService } from '../services/bomCostService'
import { useNotification } from '../context/NotificationContext'
import { useAuth } from '../context/AuthContext'
import ResizableDialog from './ResizableDialog'
import { hasThumbnail, getThumbnailSrc } from '../utils/thumbnail'

// Returns true for part types that have PDM drawings (Mechanical Parts, Assemblies)
const isPdmPart = (partType) => {
  if (!partType) return false
  const t = partType.toLowerCase()
  return t === 'mp' || t.includes('mechanic') || t === 'as' || t.includes('assembly')
}

// Helper function to classify part type based on part number
const classifyPartType = (partNumber, state) => {
  if (!partNumber || partNumber === 'N/A') return null
  const partNum = partNumber.toLowerCase()
  if (partNum.includes('bearing') || partNum.includes('brg')) return 'Bearing'
  if (partNum.includes('fastener') || partNum.includes('bolt') || partNum.includes('screw') || partNum.includes('nut')) return 'Fastener'
  if (partNum.includes('electrical') || partNum.includes('wire') || partNum.includes('cable')) return 'electrical'
  if (partNum.includes('3d') || partNum.includes('print')) return '3D Printing part'
  if (state && state.toLowerCase() === 'assembly') return 'Assembly'
  return null
}

const BOMTable = ({ data, canEdit = false, canEditInventory = false, onRefresh, selectedParts = new Set(), onSelectionChange }) => {
  const { showNotification } = useNotification()
  const { user } = useAuth()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const tc = getSemanticColors(theme)
  const isAdmin = user?.role === 'admin'
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState([])
  const [thumbnailDialog, setThumbnailDialog] = useState(null)
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const fileInputRef = useRef(null)
  const [editMode, setEditMode] = useState(false)
  const [pendingEdits, setPendingEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [ecoDialog, setEcoDialog] = useState(null)
  const [ecoEditData, setEcoEditData] = useState({ description: '', backwardCompatible: true })
  const [savingEco, setSavingEco] = useState(false)
  const [columnWidths, setColumnWidths] = useState({})
  const [hoveredPart, setHoveredPart] = useState(null)
  const [thumbnailAnchor, setThumbnailAnchor] = useState(null)
  const [partTypeDialog, setPartTypeDialog] = useState(null)
  const [availablePartTypes, setAvailablePartTypes] = useState([])
  const [availableFilterTypes, setAvailableFilterTypes] = useState([])
  const [partTypeColors, setPartTypeColors] = useState({}) // Map of part type name to color
  const [loadingPartTypes, setLoadingPartTypes] = useState(false)
  const [updatingPartType, setUpdatingPartType] = useState(false)
  const [fullscreenOpen, setFullscreenOpen] = useState(false)
  const [replacePartDialog, setReplacePartDialog] = useState(null)
  const [searchResults, setSearchResults] = useState([])
  const [searchingParts, setSearchingParts] = useState(false)
  const [selectedReplacementPart, setSelectedReplacementPart] = useState(null)
  const [partSearchQuery, setPartSearchQuery] = useState('')
  const searchTimeoutRef = useRef(null)

  const handleSearchParts = useCallback(async (searchQuery) => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }

    setSearchingParts(true)
    try {
      const response = await bomService.searchParts(searchQuery.trim())
      if (response.data.success) {
        setSearchResults(response.data.parts || [])
      } else {
        setSearchResults([])
        showNotification('Error searching parts', 'error')
      }
    } catch (error) {
      console.error('Error searching parts:', error)
      setSearchResults([])
      showNotification('Error searching parts', 'error')
    } finally {
      setSearchingParts(false)
    }
  }, [showNotification])

  // Debounce part search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    if (partSearchQuery && partSearchQuery.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        handleSearchParts(partSearchQuery)
      }, 300) // 300ms debounce
    } else {
      setSearchResults([])
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [partSearchQuery, handleSearchParts])

  // Load part types for filter dropdown and colors on mount
  useEffect(() => {
    const loadFilterTypes = async () => {
      try {
        const response = await bomCostService.getPartTypes()
        if (response.data.success) {
          setAvailableFilterTypes(response.data.types || [])
          // Store colors
          if (response.data.types_with_colors) {
            const colorMap = {}
            response.data.types_with_colors.forEach(t => {
              colorMap[t.name] = t.color || '#6c757d'
            })
            setPartTypeColors(colorMap)
          }
        }
      } catch (error) {
        console.error('Error loading part types for filter:', error)
      }
    }
    loadFilterTypes()
  }, [])

  // Floor users can only edit inventory, while admin/engineer can edit all fields
  const showEditButton = canEdit || canEditInventory
  
  // Ensure selectedParts is always a Set
  const selectedPartsSet = selectedParts instanceof Set ? selectedParts : new Set(selectedParts || [])

  // Handle both old format (data.items) and new format (data.flat_data.items)
  const items = data?.items || data?.flat_data?.items || []

  // Get assembly information
  const assemblyPartNumber = data?.flat_data?.metadata?.assembly_name || data?.flat_data?.name || data?.name || 'Unknown Assembly'
  const assemblyRevision = data?.version || 'N/A'

  if (!data || items.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 5 }}>
        <p>No items in this BOM</p>
      </Box>
    )
  }

  // Transform data for DataGrid - Find parent assembly from items and move to top
  const rows = useMemo(() => {
    // Transform all items first
    const allRows = items.map((item, index) => {
      // Handle both old format and new format with uppercase field names
      // Thumbnail might already be an object or a JSON string
      let thumbnail = {}
      if (item.thumbnail) {
        if (typeof item.thumbnail === 'string') {
          try {
            thumbnail = JSON.parse(item.thumbnail)
          } catch (e) {
            thumbnail = {}
          }
        } else if (typeof item.thumbnail === 'object') {
          thumbnail = item.thumbnail
        }
      }
      return {
        id: item.id || item.bom_part_id || item.part_id || index,
        part_number: item.part_number || item['PART NUMBER'] || item.name || 'N/A',
        revision: item.revision || item['Revision'] || '',
        description: item.description || item['DESCRIPTION'] || item['PART NAME'] || '',
        material: item.material || item['Material'] || '',
        finish1: item.finish1 || item['FINISH1'] || '',
        finish2: item.finish2 || item['FINISH2'] || '',
        qty: item.qty || item.quantity || item['QTY.'] || '1',
        vendor: item.vendor || item['Vendor'] || '',
        manufacturer: item.manufacturer || item['Manufacturer'] || '',
        manufacturer_pn: item.manufacturer_pn || item['Manufacturer PN'] || item['ManufacturerPN'] || '',
        order_qty: item.order_qty || item['Order Qty'] || '',
        unit_cost: item.unit_cost || item['Unit Cost'] || '',
        price_per_bom: item.price_per_bom || item['Price/BOM'] || '',
        source_currency: item.source_currency || null,
        source_unit_cost: item.source_unit_cost || null,
        po_orders: item.po_orders || item['PO Orders'] || '',
        inventory: item.inventory !== undefined ? item.inventory : (item['Inventory'] || 0),
        warehouse_box: item.warehouse_box_number || item['Warehouse Box'] || '',
        part_type: item.part_type || item['Type'] || item['Part Type'] || classifyPartType(item['PART NUMBER'] || item.part_number || '', item['State'] || item.state || '') || 'Unknown',
        state: item.state || item['State'] || 'Active',
        eco_number: item.eco_number || item['ECO Number'] || '',
        eco_description: item.eco_description || item['ECO Description'] || '',
        backward_compatible: item.backward_compatible || item['Backward Compatible'],
        thumbnail: thumbnail,
        part_id: item.part_id,
        bom_part_id: item.bom_part_id,
        ...item, // Include all other fields
      }
    })

    // Find the parent assembly row - it matches the assembly part number OR is marked as Assembly type
    const parentIndex = allRows.findIndex(row =>
      row.part_number === assemblyPartNumber ||
      row.part_type === 'Assembly' ||
      (row.state && row.state.toLowerCase() === 'assembly')
    )

    // If parent found, mark it and move to top
    if (parentIndex !== -1) {
      const parentRow = { ...allRows[parentIndex], isParent: true }
      const childRows = [
        ...allRows.slice(0, parentIndex).map(row => ({ ...row, isParent: false })),
        ...allRows.slice(parentIndex + 1).map(row => ({ ...row, isParent: false }))
      ]
      return [parentRow, ...childRows]
    }

    // If no parent found in items, mark all as children
    return allRows.map(row => ({ ...row, isParent: false }))
  }, [items, assemblyPartNumber, assemblyRevision])

  // Filter rows - ONLY filter child parts, always keep parent
  const filteredRows = useMemo(() => {
    const parent = rows.find(row => row.isParent)
    const children = rows.filter(row => !row.isParent)

    const filteredChildren = children.filter((row) => {
      const matchesSearch =
        !searchTerm ||
        (row.part_number && row.part_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (row.description && row.description.toLowerCase().includes(searchTerm.toLowerCase()))

      const matchesType =
        typeFilter.length === 0 ||
        (row.part_type && typeFilter.some(t => t.toLowerCase() === row.part_type.toLowerCase()))

      return matchesSearch && matchesType
    })

    // Always return parent first, then filtered children
    return parent ? [parent, ...filteredChildren] : filteredChildren
  }, [rows, searchTerm, typeFilter])

  const handleViewPDF = (partNumber, revision) => {
    if (!partNumber || !revision) return
    // Open PDF viewer - this would call the API to get PDF
    window.open(`/api/part-pdf/${partNumber}/${revision}?t=${Date.now()}`, '_blank')
  }

  const handleViewAI = (partNumber) => {
    if (!partNumber) return
    // Open AI file viewer
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

  const handleOpen3DViewer = (partNumber, revision) => {
    // Download the .easm file silently — eDrawings will open it via file association
    const link = document.createElement('a')
    link.href = `/api/open-3d-viewer/${partNumber}/${revision}`
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const [refreshingPart, setRefreshingPart] = useState(null)

  const handleGetLatestForPart = async (partNumber, revision, partType) => {
    if (!partNumber || !revision) return
    setRefreshingPart(partNumber)
    try {
      const response = await bomService.getLatestAndScan([{
        part_number: partNumber,
        revision: revision,
        part_type: partType || ''
      }])

      if (response.data.success) {
        const retrieved = response.data.retrieved_count || 0
        showNotification(`Refreshed files for ${partNumber}${retrieved > 0 ? ` (${retrieved} retrieved)` : ''}`, 'success')
        if (onRefresh) onRefresh()
      } else {
        showNotification(response.data.error || 'Error refreshing files', 'error')
      }
    } catch (error) {
      console.error('Error getting latest for part:', error)
      showNotification(`Error refreshing files for ${partNumber}`, 'error')
    } finally {
      setRefreshingPart(null)
    }
  }

  const handleSaveEco = async () => {
    if (!ecoDialog) return
    setSavingEco(true)
    try {
      const response = await bomService.updateECO(ecoDialog.ecoNumber, {
        description: ecoEditData.description,
        backward_compatible: ecoEditData.backwardCompatible === 'true' || ecoEditData.backwardCompatible === true,
      })
      if (response.data.success) {
        showNotification(`ECO ${ecoDialog.ecoNumber} updated`, 'success')
        // Also update the part's eco fields
        if (ecoDialog.partNumber) {
          const partRow = rows.find(r => r.part_number === ecoDialog.partNumber && r.revision === ecoDialog.revision)
          if (partRow?.part_id) {
            await bomService.updatePart(partRow.part_id, {
              eco_description: ecoEditData.description,
              backward_compatible: ecoEditData.backwardCompatible === 'true' || ecoEditData.backwardCompatible === true,
            })
          }
        }
        setEcoDialog(null)
        if (onRefresh) onRefresh()
      } else {
        showNotification(response.data.error || 'Error updating ECO', 'error')
      }
    } catch (error) {
      console.error('Error saving ECO:', error)
      showNotification('Error updating ECO', 'error')
    } finally {
      setSavingEco(false)
    }
  }

  const handleReplacePart = async () => {
    if (!replacePartDialog || !selectedReplacementPart) {
      showNotification('Please select a replacement part', 'warning')
      return
    }

    setSaving(true)
    try {
      const response = await bomService.replaceBOMPart(
        replacePartDialog.bomPartId,
        selectedReplacementPart.id
      )

      if (response.data.success) {
        showNotification(
          `Part replaced: ${replacePartDialog.currentPart.part_number} → ${selectedReplacementPart.part_number}`,
          'success'
        )
        setReplacePartDialog(null)
        setSelectedReplacementPart(null)
        setSearchResults([])
        setPartSearchQuery('')
        
        // Refresh BOM data
        if (onRefresh) {
          onRefresh()
        } else {
          window.location.reload()
        }
      } else {
        showNotification(response.data.error || 'Error replacing part', 'error')
      }
    } catch (error) {
      console.error('Error replacing part:', error)
      showNotification(
        error.response?.data?.error || 'Error replacing part',
        'error'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleThumbnailClick = (thumbnail, partNumber, partId) => {
    // Allow opening dialog even without thumbnail (for upload)
    setThumbnailDialog({ thumbnail, partNumber, partId })
  }

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']
    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))
    
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      showNotification('Invalid file type. Please select PNG, JPG, JPEG, GIF, or WebP image.', 'error')
      event.target.value = '' // Reset input
      return
    }

    // Validate file size (2MB max)
    const maxSize = 2 * 1024 * 1024 // 2MB
    if (file.size > maxSize) {
      showNotification(`File size exceeds 2MB limit. Current size: ${(file.size / 1024 / 1024).toFixed(2)}MB`, 'error')
      event.target.value = '' // Reset input
      return
    }

    setSelectedFile(file)
  }

  const handleUploadThumbnail = async () => {
    if (!selectedFile || !thumbnailDialog || !thumbnailDialog.partId) {
      showNotification('Please select a file to upload', 'warning')
      return
    }

    setUploadingThumbnail(true)
    try {
      const formData = new FormData()
      formData.append('thumbnail', selectedFile)

      const response = await bomService.uploadPartThumbnail(thumbnailDialog.partId, formData)
      
      if (response.data.success) {
        showNotification('Thumbnail uploaded successfully', 'success')
        
        // Update the dialog with new thumbnail
        setThumbnailDialog({
          ...thumbnailDialog,
          thumbnail: response.data.thumbnail
        })
        
        // Reset file selection
        setSelectedFile(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        
        // Refresh data if onRefresh is available
        if (onRefresh) {
          onRefresh()
        }
      } else {
        showNotification(response.data.error || 'Failed to upload thumbnail', 'error')
      }
    } catch (error) {
      console.error('Error uploading thumbnail:', error)
      showNotification(error.response?.data?.error || 'Error uploading thumbnail', 'error')
    } finally {
      setUploadingThumbnail(false)
    }
  }

  // Handle part selection
  const handleTogglePart = (partKey) => {
    if (onSelectionChange) {
      const newSelected = new Set(selectedPartsSet)
      if (newSelected.has(partKey)) {
        newSelected.delete(partKey)
      } else {
        newSelected.add(partKey)
      }
      onSelectionChange(newSelected)
    }
  }

  const handleSelectAll = () => {
    if (onSelectionChange) {
      const allParts = new Set()
      // Only select child parts, not parent assembly
      filteredRows.forEach(row => {
        if (!row.isParent) {
          const partKey = `${row.part_number}_${row.revision}`
          allParts.add(partKey)
        }
      })
      onSelectionChange(allParts)
    }
  }

  const handleDeselectAll = () => {
    if (onSelectionChange) {
      onSelectionChange(new Set())
    }
  }

  // Helper function to determine if a field is editable based on user permissions
  const isFieldEditable = (fieldName) => {
    if (!editMode) return false
    if (canEdit) return true // admin/engineer can edit all fields
    if (canEditInventory) return fieldName === 'inventory' // floor can only edit inventory
    return false
  }

  // Define columns with ALL fields from old template - use useMemo to make it reactive to editMode
  const columns = useMemo(() => [
    {
      field: 'select',
      headerName: '',
      width: 50,
      sortable: false,
      renderHeader: () => {
        const childRows = filteredRows.filter(row => !row.isParent)
        return (
          <Checkbox
            checked={childRows.length > 0 && childRows.every(row => {
              const partKey = `${row.part_number}_${row.revision}`
              return selectedPartsSet.has(partKey)
            })}
            indeterminate={
              childRows.some(row => {
                const partKey = `${row.part_number}_${row.revision}`
                return selectedPartsSet.has(partKey)
              }) && !childRows.every(row => {
                const partKey = `${row.part_number}_${row.revision}`
                return selectedPartsSet.has(partKey)
              })
            }
            onChange={(e) => {
              if (e.target.checked) {
                handleSelectAll()
              } else {
                handleDeselectAll()
              }
            }}
          />
        )
      },
      renderCell: (params) => {
        // Don't show checkbox for parent assembly row
        if (params.row.isParent) return null

        const partKey = `${params.row.part_number}_${params.row.revision}`
        const isChecked = selectedPartsSet.has(partKey)
        return (
          <Checkbox
            checked={isChecked}
            onChange={(e) => {
              e.stopPropagation()
              handleTogglePart(partKey)
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )
      },
    },
    {
      field: 'part_type',
      headerName: 'Type',
      width: 105,
      renderCell: (params) => {
        // Get color from managed part types
        const hexColor = partTypeColors[params.value] || '#6c757d'
        
        // Convert hex to RGB
        const hexToRgb = (hex) => {
          const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
          return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
          } : null
        }
        
        const rgb = hexToRgb(hexColor)
        let style
        
        if (!rgb) {
          style = { bg: tc.chipFallbackBg, color: tc.chipFallbackColor, border: tc.chipFallbackBorder }
        } else {
          // Generate colors with transparent backgrounds and white text for better contrast
          const blendWithWhite = (colorValue, factor) => Math.round(colorValue + (255 - colorValue) * factor)
          
          if (isDark) {
            // Dark mode: use the color with transparency for background
            // More transparent background for subtle appearance
            style = {
              bg: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`, // 25% opacity for dark mode
              color: '#ffffff', // White text for contrast on dark/colored background
              border: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)` // 50% opacity border
            }
          } else {
            // Light mode: lighter background with black text and lower transparency (more opaque)
            const bgR = blendWithWhite(rgb.r, 0.88)
            const bgG = blendWithWhite(rgb.g, 0.88)
            const bgB = blendWithWhite(rgb.b, 0.88)
            
            // Border: medium blend
            const borderR = blendWithWhite(rgb.r, 0.88)
            const borderG = blendWithWhite(rgb.g, 0.88)
            const borderB = blendWithWhite(rgb.b, 0.88)
            
            style = {
              bg: `rgba(${bgR}, ${bgG}, ${bgB}, 0.8)`, // 70% opacity for light mode - more opaque
              color: '#000000', // Black text for light mode
              border: `rgba(${borderR}, ${borderG}, ${borderB}, 0.8)` // 80% opacity border - more opaque
            }
          }
        }
        
        return (
          <Box
            onDoubleClick={(e) => {
              e.stopPropagation()
              if (params.row.bom_part_id || params.row.id) {
                handlePartTypeDoubleClick(params.row)
              }
            }}
            sx={{
              backgroundColor: style.bg,
              color: style.color,
              border: `1px solid ${style.border}`,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              fontSize: '0.7rem',
              fontWeight: 500,
              whiteSpace: 'normal',
              wordWrap: 'break-word',
              width: '100%',
              lineHeight: 1.3,
              cursor: 'pointer',
              '&:hover': {
                opacity: 0.8,
              },
            }}
          >
            {params.value || 'Unknown'}
          </Box>
        )
      },
    },
    {
      field: 'part_number',
      headerName: 'Part Number',
      width: 280,
      renderCell: (params) => {
        const partNumber = params.value || 'N/A'
        const revision = params.row.revision || ''
        const thumbnail = params.row.thumbnail || {}
        const hasThumb = hasThumbnail(thumbnail)
        const partId = params.row.part_id

        const handleMouseEnter = (event) => {
          if (hasThumb) {
            setHoveredPart({ partNumber, thumbnail, partId })
            setThumbnailAnchor(event.currentTarget)
          }
        }

        const handleMouseLeave = () => {
          // Only close on mouse leave if not a touch device
          if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
            setHoveredPart(null)
            setThumbnailAnchor(null)
          }
        }

        const handleClick = (event) => {
          if (hasThumb) {
            // Toggle popover on click for touch devices
            if (hoveredPart?.partNumber === partNumber && thumbnailAnchor) {
              setHoveredPart(null)
              setThumbnailAnchor(null)
            } else {
              setHoveredPart({ partNumber, thumbnail, partId })
              setThumbnailAnchor(event.currentTarget)
            }
          }
        }

        return (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, width: '100%', flexWrap: 'wrap' }}>
            <Typography 
              variant="body2" 
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onClick={handleClick}
              sx={{ 
                whiteSpace: 'normal', 
                wordWrap: 'break-word', 
                overflowWrap: 'break-word', 
                flex: 1, 
                minWidth: 0,
                cursor: hasThumb ? 'pointer' : 'default',
                textDecoration: hoveredPart?.partNumber === partNumber ? 'underline' : 'none',
                '&:hover': {
                  textDecoration: hasThumb ? 'underline' : 'none',
                }
              }}
            >
              {partNumber}
            </Typography>
            {partNumber !== 'N/A' && revision && (
              <>
              {params.row.has_pdf && (
                <Tooltip title={`View PDF for ${partNumber} REV${revision}`}>
                  <IconButton
                    size="small"
                    onClick={() => handleViewPDF(partNumber, revision)}
                    sx={{ color: 'error.main' }}
                  >
                    <PdfIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {params.row.has_ai_pdf && (
                <Tooltip title={`View Assembly Instructions for ${partNumber}`}>
                  <IconButton
                    size="small"
                    onClick={() => handleViewAI(partNumber)}
                    sx={{ color: 'primary.main' }}
                  >
                    <BuildIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {params.row.has_step && (
                <Tooltip title={`Download STEP file for ${partNumber}`}>
                  <IconButton
                    size="small"
                    onClick={(e) => handleDownloadSTEP(e, partNumber, revision, params.row.step_files)}
                    sx={{ color: 'success.main' }}
                  >
                    <ViewInArIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {partNumber && partNumber.includes('-AS-') && (
                <Tooltip title={`Open 3D viewer for ${partNumber}`}>
                  <IconButton
                    size="small"
                    onClick={() => handleOpen3DViewer(partNumber, revision)}
                    sx={{ color: tc.highlightIcon }}
                  >
                    <ThreeDIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {(isPdmPart(params.row.part_type) || (params.row.part_type && params.row.part_type.toLowerCase().includes('3d'))) && (
                <Tooltip title={`Get latest files from PDM for ${partNumber}`}>
                  <IconButton
                    size="small"
                    onClick={() => handleGetLatestForPart(partNumber, revision, params.row.part_type)}
                    disabled={refreshingPart === partNumber}
                    sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
                  >
                    {refreshingPart === partNumber ? (
                      <CircularProgress size={16} />
                    ) : (
                      <RefreshIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              )}
                {params.row.datasheet_drive_url && (
                  <Tooltip title={`View datasheet for ${partNumber}`}>
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
                {isAdmin && params.row.bom_part_id && (
                  <Tooltip title={`Replace part ${partNumber} REV${revision}`}>
                    <IconButton
                      size="small"
                      onClick={() => setReplacePartDialog({
                        bomPartId: params.row.bom_part_id,
                        currentPart: {
                          id: partId,
                          part_number: partNumber,
                          revision: revision,
                        }
                      })}
                      sx={{ color: 'warning.main' }}
                    >
                      <SwapHorizIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </>
            )}
          </Box>
        )
      },
    },
    {
      field: 'revision',
      headerName: 'Rev',
      width: 70,
    },
    {
      field: 'eco_number',
      headerName: 'ECO',
      width: 90,
      renderCell: (params) => {
        const ecoNumber = params.value
        const backwardCompatible = params.row.backward_compatible
        const ecoDescription = params.row.eco_description || ''
        const partNumber = params.row.part_number || 'N/A'
        const revision = params.row.revision || ''
        const partDescription = params.row.description || ''
        const thumbnail = params.row.thumbnail || null
        const hasPdf = !!params.row.has_pdf
        const hasAiPdf = !!params.row.has_ai_pdf

        if (!ecoNumber) return <Typography variant="body2" color="text.secondary">-</Typography>

        const compatibleText = backwardCompatible ? 'Compatible' : 'Not Compatible'

        const baseDialog = {
          ecoNumber, ecoDescription, partNumber, revision,
          partDescription, thumbnail, backwardCompatible,
          hasPdf, hasAiPdf,
        }

        return (
          <Chip
            label={ecoNumber}
            size="small"
            color={backwardCompatible ? 'success' : 'warning'}
            sx={{
              fontSize: '0.7rem',
              cursor: 'pointer',
              '&:hover': {
                opacity: 0.8,
              }
            }}
            onClick={() => setEcoDialog({ ...baseDialog, editMode: false })}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEcoEditData({
                description: ecoDescription || '',
                backwardCompatible: backwardCompatible ? 'true' : 'false',
              })
              setEcoDialog({ ...baseDialog, editMode: true })
            }}
            title={`Click for details, double-click to edit - ${compatibleText}`}
          />
        )
      },
    },
    {
      field: 'description',
      headerName: 'Description',
      width: 240,
      minWidth: 180,
    },
    {
      field: 'material',
      headerName: 'Material',
      width: 110,
    },
    {
      field: 'finish1',
      headerName: 'Finish 1',
      width: 110,
    },
    {
      field: 'finish2',
      headerName: 'Finish 2',
      width: 110,
    },
    {
      field: 'qty',
      headerName: 'QTY',
      width: 70,
      type: 'number',
    },
    {
      field: 'vendor',
      headerName: 'Vendor',
      width: 110,
      editable: isFieldEditable('vendor'),
      cellClassName: canEdit ? 'editable-cell' : '',
    },
    {
      field: 'manufacturer',
      headerName: 'Manufacturer',
      width: 110,
      editable: isFieldEditable('manufacturer'),
      cellClassName: canEdit ? 'editable-cell' : '',
    },
    {
      field: 'manufacturer_pn',
      headerName: 'Mfr PN',
      width: 120,
      editable: isFieldEditable('manufacturer_pn'),
      cellClassName: canEdit ? 'editable-cell' : '',
    },
    {
      field: 'order_qty',
      headerName: 'Order Qty',
      width: 80,
      editable: isFieldEditable('order_qty'),
      type: 'number',
      cellClassName: canEdit ? 'editable-cell' : '',
    },
    {
      field: 'unit_cost',
      headerName: 'Unit Cost',
      width: 100,
      editable: isFieldEditable('unit_cost'),
      type: 'number',
      cellClassName: canEdit ? 'editable-cell' : '',
      renderCell: (params) => {
        const value = params.value
        if (value === null || value === undefined || value === '') {
          return <Typography variant="body2">-</Typography>
        }
        const numValue = typeof value === 'string' ? parseFloat(value) : value
        if (isNaN(numValue)) {
          return <Typography variant="body2">-</Typography>
        }
        
        // Check if this cost was converted from another currency
        const sourceCurrency = params.row.source_currency
        const sourceUnitCost = params.row.source_unit_cost
        const isConverted = sourceCurrency && sourceCurrency !== 'USD' && sourceUnitCost
        
        if (isConverted) {
          const currencySymbol = sourceCurrency === 'EUR' ? '€' : sourceCurrency === 'ILS' ? '₪' : '$'
          return (
            <Tooltip 
              title={`Original: ${currencySymbol}${formatPrice(sourceUnitCost)} (${sourceCurrency})`}
              arrow
            >
              <Typography 
                variant="body2" 
                sx={{
                  color: 'primary.main',
                  fontWeight: 500,
                  cursor: 'help'
                }}
              >
                ${formatPrice(numValue)}
              </Typography>
            </Tooltip>
          )
        }
        
        return <Typography variant="body2">${numValue.toFixed(2)}</Typography>
      },
    },
    {
      field: 'price_per_bom',
      headerName: 'Price/BOM',
      width: 100,
      editable: isFieldEditable('price_per_bom'),
      type: 'number',
      cellClassName: canEdit ? 'editable-cell' : '',
      renderCell: (params) => {
        const value = params.value
        if (value === null || value === undefined || value === '') {
          return <Typography variant="body2">-</Typography>
        }
        const numValue = typeof value === 'string' ? parseFloat(value) : value
        if (isNaN(numValue)) {
          return <Typography variant="body2">-</Typography>
        }
        
        // Check if this cost was converted from another currency
        const sourceCurrency = params.row.source_currency
        const sourceUnitCost = params.row.source_unit_cost
        const quantity = params.row.quantity || 1
        const isConverted = sourceCurrency && sourceCurrency !== 'USD' && sourceUnitCost
        
        if (isConverted) {
          const currencySymbol = sourceCurrency === 'EUR' ? '€' : sourceCurrency === 'ILS' ? '₪' : '$'
          const originalTotal = sourceUnitCost * quantity
          return (
            <Tooltip 
              title={`Original: ${currencySymbol}${formatPrice(originalTotal)} (${sourceCurrency})`}
              arrow
            >
              <Typography 
                variant="body2" 
                sx={{
                  color: 'primary.main',
                  fontWeight: 500,
                  cursor: 'help'
                }}
              >
                ${formatPrice(numValue)}
              </Typography>
            </Tooltip>
          )
        }
        
        return <Typography variant="body2">${numValue.toFixed(2)}</Typography>
      },
    },
    {
      field: 'po_orders',
      headerName: 'PO Orders',
      width: 110,
      editable: isFieldEditable('po_orders'),
      cellClassName: canEdit ? 'editable-cell' : '',
      renderCell: (params) => {
        const poOrdersValue = params.value || ''
        let tooltipText = ''
        
        // Parse PO orders JSON to extract revision information
        if (poOrdersValue) {
          try {
            const poData = typeof poOrdersValue === 'string' ? JSON.parse(poOrdersValue) : poOrdersValue
            if (Array.isArray(poData) && poData.length > 0) {
              // Extract revisions from PO data
              const revisions = poData
                .filter(po => po.revision)
                .map(po => po.revision)
                .filter((rev, index, self) => self.indexOf(rev) === index) // Unique revisions
              
              if (revisions.length > 0) {
                tooltipText = `PO was for revision${revisions.length > 1 ? 's' : ''}: ${revisions.join(', ')}`
              }
            }
          } catch (e) {
            // If parsing fails, just show the value
          }
        }
        
        // Display PO numbers (comma-separated if multiple)
        let displayValue = ''
        if (poOrdersValue) {
          try {
            const poData = typeof poOrdersValue === 'string' ? JSON.parse(poOrdersValue) : poOrdersValue
            if (Array.isArray(poData) && poData.length > 0) {
              displayValue = poData.map(po => po.po_number || po).join(', ')
            } else {
              displayValue = poOrdersValue
            }
          } catch (e) {
            displayValue = poOrdersValue
          }
        }
        
        if (tooltipText) {
          return (
            <Tooltip title={tooltipText} arrow>
              <Typography variant="body2" sx={{ cursor: 'help' }}>
                {displayValue || 'N/A'}
              </Typography>
            </Tooltip>
          )
        }
        
        return <Typography variant="body2">{displayValue || 'N/A'}</Typography>
      },
    },
    {
      field: 'inventory',
      headerName: 'Inventory',
      width: 80,
      editable: isFieldEditable('inventory'),
      type: 'number',
      cellClassName: (canEdit || canEditInventory) ? 'editable-cell' : '',
    },
    {
      field: 'warehouse_box',
      headerName: 'Box',
      width: 80,
      editable: isFieldEditable('warehouse_box'),
      cellClassName: canEdit ? 'editable-cell' : '',
    },
    {
      field: 'state',
      headerName: 'State',
      width: 90,
      renderCell: (params) => {
        return (
          <Chip
            label={params.value || 'Active'}
            size="small"
            color={params.value === 'Active' ? 'success' : 'default'}
          />
        )
      },
    },
  ], [editMode, canEdit, canEditInventory, selectedPartsSet, filteredRows, partTypeColors, isDark, theme])

  // Calculate cumulative left positions for sticky columns based on actual column widths
  const stickyLeftPositions = useMemo(() => {
    const getColumnWidth = (field) => {
      // First check if we have a stored width from user resizing
      if (columnWidths[field]) {
        return columnWidths[field]
      }
      // Otherwise use the default width from column definition
      const column = columns.find(col => col.field === field)
      return column?.width || 0
    }

    const selectWidth = getColumnWidth('select')
    const partTypeWidth = getColumnWidth('part_type')
    const partNumberWidth = getColumnWidth('part_number')
    const revisionWidth = getColumnWidth('revision')
    const ecoWidth = getColumnWidth('eco_number')
    const descriptionWidth = getColumnWidth('description')

    return {
      select: 0,
      part_type: selectWidth,
      part_number: selectWidth + partTypeWidth,
      revision: selectWidth + partTypeWidth + partNumberWidth,
      eco_number: selectWidth + partTypeWidth + partNumberWidth + revisionWidth,
      description: selectWidth + partTypeWidth + partNumberWidth + revisionWidth + ecoWidth,
    }
  }, [columns, columnWidths])

  // Handle column width changes
  const handleColumnWidthChange = (params) => {
    setColumnWidths((prev) => ({
      ...prev,
      [params.field]: params.width,
    }))
  }

  // Map field names to API field names
  const getApiFieldName = (field) => {
    const fieldMap = {
      vendor: 'vendor',
      manufacturer: 'manufacturer',
      manufacturer_pn: 'manufacturer_pn',
      order_qty: 'order_qty',
      unit_cost: 'unit_cost',
      price_per_bom: 'price_per_bom',
      po_orders: 'po_orders',
      inventory: 'inventory',
      warehouse_box: 'warehouse_box_number',
      qty: 'quantity', // This is a BOMPart field
    }
    return fieldMap[field] || field
  }

  // Determine if field is Part-level or BOMPart-level
  const isPartLevelField = (field) => {
    const partLevelFields = ['vendor', 'manufacturer', 'manufacturer_pn', 'order_qty', 'unit_cost', 'po_orders', 'inventory', 'warehouse_box']
    return partLevelFields.includes(field)
  }

  const processRowUpdate = async (newRow, oldRow) => {
    if (!editMode) return oldRow

    // Don't allow editing parent assembly row
    if (newRow.isParent) return oldRow

    const changedFields = {}
    Object.keys(newRow).forEach((key) => {
      if (newRow[key] !== oldRow[key] && key !== 'id') {
        const apiField = getApiFieldName(key)
        changedFields[apiField] = newRow[key]
      }
    })

    if (Object.keys(changedFields).length === 0) {
      return oldRow
    }

    // Store pending edit
    setPendingEdits((prev) => ({
      ...prev,
      [newRow.id]: { ...prev[newRow.id], ...changedFields },
    }))

    return newRow
  }

  const handleSaveAllEdits = async () => {
    if (Object.keys(pendingEdits).length === 0) {
      showNotification('No changes to save', 'info')
      return
    }

    setSaving(true)
    try {
      const promises = Object.entries(pendingEdits).map(async ([rowId, changes]) => {
        const row = rows.find((r) => r.id.toString() === rowId.toString())
        if (!row) return

        // Separate Part-level and BOMPart-level fields
        const partFields = {}
        const bomPartFields = {}

        Object.entries(changes).forEach(([field, value]) => {
          if (field === 'quantity' || field === 'price_per_bom') {
            bomPartFields[field] = value
          } else {
            partFields[field] = value
          }
        })

        // Update Part-level fields
        if (Object.keys(partFields).length > 0 && row.part_id) {
          await bomService.updatePart(row.part_id, partFields)
        }

        // Update BOMPart-level fields
        if (Object.keys(bomPartFields).length > 0 && row.bom_part_id) {
          await bomService.updateBOMItem(row.bom_part_id, bomPartFields)
        }
      })

      await Promise.all(promises)
      showNotification('All changes saved successfully', 'success')
      setPendingEdits({})
      setEditMode(false)
      // Reload data by calling parent's refresh function if available
      if (onRefresh) {
        onRefresh()
      } else {
        window.location.reload() // Fallback to full page reload
      }
    } catch (error) {
      console.error('Error saving edits:', error)
      showNotification('Error saving changes: ' + (error.response?.data?.error || error.message), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelEdits = () => {
    setPendingEdits({})
    setEditMode(false)
    // Reload to reset changes
    if (onRefresh) {
      onRefresh()
    } else {
      window.location.reload()
    }
  }

  const handlePartTypeDoubleClick = async (row) => {
    try {
      setLoadingPartTypes(true)
      const response = await bomCostService.getPartTypes()
      if (response.data.success) {
        setAvailablePartTypes(response.data.types || [])
        // Store types with colors for styling
        const typesWithColors = response.data.types_with_colors || []
        const colorMap = {}
        typesWithColors.forEach(t => {
          colorMap[t.name] = t.color
        })
        setPartTypeDialog({
          bomPartId: row.bom_part_id || row.id,
          partNumber: row.part_number,
          currentType: row.part_type || 'Unknown',
          colorMap: colorMap
        })
      } else {
        showNotification('Error loading part types', 'error')
      }
    } catch (error) {
      console.error('Error loading part types:', error)
      showNotification('Error loading part types', 'error')
    } finally {
      setLoadingPartTypes(false)
    }
  }

  const handlePartTypeUpdate = async (newType) => {
    if (!partTypeDialog) return
    
    try {
      setUpdatingPartType(true)
      const itemId = partTypeDialog.bomPartId
      
      const response = await bomService.updateBOMItem(itemId, {
        part_type: newType === 'Unknown' ? null : newType
      })
      
      if (response.data.success) {
        showNotification(`Part type updated to "${newType}" for all locations`, 'success')
        setPartTypeDialog(null)
        // Reload data
        if (onRefresh) {
          onRefresh()
        } else {
          window.location.reload()
        }
      } else {
        showNotification(response.data.error || 'Error updating part type', 'error')
      }
    } catch (error) {
      console.error('Error updating part type:', error)
      showNotification('Error updating part type: ' + (error.response?.data?.error || error.message), 'error')
    } finally {
      setUpdatingPartType(false)
    }
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      {/* Search, Filter & Actions — single compact row */}
      <Box sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'center', flexShrink: 0, width: '100%', maxWidth: '100%', overflow: 'hidden', pt: 0.5 }}>
        <TextField
          size="small"
          placeholder="Search parts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: '1rem' }} />,
          }}
          sx={{ width: 180, minWidth: 140, '& .MuiInputBase-root': { height: 28, fontSize: '0.75rem' } }}
        />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25, alignItems: 'center', flex: 1, overflow: 'hidden' }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 0.25, fontSize: '0.65rem' }}>Type:</Typography>
          {availableFilterTypes.map((type) => (
            <Chip
              key={type}
              label={type}
              size="small"
              clickable
              color={typeFilter.includes(type) ? 'primary' : 'default'}
              variant={typeFilter.includes(type) ? 'filled' : 'outlined'}
              onClick={() => setTypeFilter(prev =>
                prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
              )}
              sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
            />
          ))}
          {typeFilter.length > 0 && (
            <Chip label="Clear" size="small" variant="outlined" color="error" onClick={() => setTypeFilter([])}
              sx={{ height: 18, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
            />
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto', alignItems: 'center', flexShrink: 0 }}>
          <Tooltip title="Fullscreen View">
            <IconButton
              size="small"
              onClick={() => setFullscreenOpen(true)}
              sx={{ color: 'text.secondary', p: 0.25 }}
            >
              <FullscreenIcon sx={{ fontSize: '1.1rem' }} />
            </IconButton>
          </Tooltip>
          {showEditButton && (
            <>
              {!editMode ? (
                <Button
                  variant="outlined"
                  startIcon={<EditIcon sx={{ fontSize: '0.85rem' }} />}
                  onClick={() => setEditMode(true)}
                  size="small"
                  sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0.25, px: 1, minHeight: 0 }}
                >
                  {canEditInventory && !canEdit ? 'Edit Inventory' : 'Edit'}
                </Button>
              ) : (
                <>
                  <Button
                    variant="contained"
                    color="success"
                    startIcon={<SaveIcon sx={{ fontSize: '0.85rem' }} />}
                    onClick={handleSaveAllEdits}
                    disabled={saving || Object.keys(pendingEdits).length === 0}
                    size="small"
                    sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0.25, px: 1, minHeight: 0 }}
                  >
                    Save
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<CancelIcon sx={{ fontSize: '0.85rem' }} />}
                    onClick={handleCancelEdits}
                    disabled={saving}
                    size="small"
                    sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0.25, px: 1, minHeight: 0 }}
                  >
                    Cancel
                  </Button>
                  {Object.keys(pendingEdits).length > 0 && (
                    <Chip
                      label={`${Object.keys(pendingEdits).length} pending`}
                      color="warning"
                      size="small"
                      sx={{ height: 18, fontSize: '0.6rem' }}
                    />
                  )}
                </>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* DataGrid */}
      <Paper sx={{
        flex: 1,
        minHeight: 0,
        width: '100%',
        maxWidth: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <Box
          sx={{
            height: '100%',
            width: '100%',
            maxWidth: '100%',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            '& .MuiDataGrid-root': {
              border: 'none',
              width: '100%',
              maxWidth: '100%',
            },
            '& .MuiDataGrid-main': {
              overflowX: 'auto',
              width: '100%',
              maxWidth: '100%',
            },
            '& .MuiDataGrid-virtualScroller': {
              overflowX: 'auto !important',
              width: '100%',
              maxWidth: '100%',
            },
            '& .MuiDataGrid-columnHeaders': {
              backgroundColor: tc.tableHeaderBg,
              position: 'sticky',
              top: 0,
              zIndex: 20,
            },
            // Ensure all cells have proper stacking context and text wrapping
            '& .MuiDataGrid-cell': {
              position: 'relative',
              whiteSpace: 'normal !important',
              wordWrap: 'break-word !important',
              overflowWrap: 'break-word !important',
              alignItems: 'flex-start !important',
              paddingTop: '8px !important',
              paddingBottom: '8px !important',
              lineHeight: '1.4 !important',
            },
            '& .MuiDataGrid-cell > *': {
              whiteSpace: 'normal !important',
              wordWrap: 'break-word !important',
              overflowWrap: 'break-word !important',
            },
            // Ensure non-sticky cells don't overlap sticky ones - lower z-index
            '& .MuiDataGrid-cell:not([data-field="part_type"]):not([data-field="part_number"]):not([data-field="revision"]):not([data-field="eco_number"]):not([data-field="description"])': {
              zIndex: '1 !important',
            },
            '& .MuiDataGrid-columnHeader:not([data-field="select"]):not([data-field="part_type"]):not([data-field="part_number"]):not([data-field="revision"]):not([data-field="eco_number"]):not([data-field="description"])': {
              zIndex: '1 !important',
            },
            // Sticky columns - Select (checkbox column) - left: 0
            '& .MuiDataGrid-columnHeader[data-field="select"]': {
              position: 'sticky !important',
              left: '0 !important',
              zIndex: '101 !important',
              backgroundColor: `${tc.tableHeaderBg} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            '& .MuiDataGrid-cell[data-field="select"]': {
              position: 'sticky !important',
              left: '0 !important',
              zIndex: '91 !important',
              backgroundColor: `${theme.palette.background.paper} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            // Sticky columns - Type (column 2) - dynamic left position
            '& .MuiDataGrid-columnHeader[data-field="part_type"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.part_type}px !important`,
              zIndex: '100 !important',
              backgroundColor: `${tc.tableHeaderBg} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            '& .MuiDataGrid-cell[data-field="part_type"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.part_type}px !important`,
              zIndex: '90 !important',
              backgroundColor: `${theme.palette.background.paper} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            // Sticky columns - Part Number (column 3) - dynamic left position
            '& .MuiDataGrid-columnHeader[data-field="part_number"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.part_number}px !important`,
              zIndex: '99 !important',
              backgroundColor: `${tc.tableHeaderBg} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            '& .MuiDataGrid-cell[data-field="part_number"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.part_number}px !important`,
              zIndex: '89 !important',
              backgroundColor: `${theme.palette.background.paper} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            // Sticky columns - Revision (column 4) - dynamic left position
            '& .MuiDataGrid-columnHeader[data-field="revision"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.revision}px !important`,
              zIndex: '98 !important',
              backgroundColor: `${tc.tableHeaderBg} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            '& .MuiDataGrid-cell[data-field="revision"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.revision}px !important`,
              zIndex: '88 !important',
              backgroundColor: `${theme.palette.background.paper} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            // Sticky columns - ECO (column 5) - dynamic left position
            '& .MuiDataGrid-columnHeader[data-field="eco_number"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.eco_number}px !important`,
              zIndex: '97 !important',
              backgroundColor: `${tc.tableHeaderBg} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            '& .MuiDataGrid-cell[data-field="eco_number"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.eco_number}px !important`,
              zIndex: '87 !important',
              backgroundColor: `${theme.palette.background.paper} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            // Sticky columns - Description (column 6) - dynamic left position
            '& .MuiDataGrid-columnHeader[data-field="description"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.description}px !important`,
              zIndex: '96 !important',
              backgroundColor: `${tc.tableHeaderBg} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            '& .MuiDataGrid-cell[data-field="description"]': {
              position: 'sticky !important',
              left: `${stickyLeftPositions.description}px !important`,
              zIndex: '86 !important',
              backgroundColor: `${theme.palette.background.paper} !important`,
              borderRight: `2px solid ${theme.palette.divider} !important`,
              boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
            },
            '& .MuiDataGrid-cell:focus': {
              outline: 'none',
            },
            '& .MuiDataGrid-cell:focus-within': {
              outline: 'none',
            },
            '& .editable-cell': {
              backgroundColor: editMode ? (isDark ? theme.palette.action.hover : '#f8f9fc') : 'transparent',
              cursor: editMode ? 'text' : 'default',
            },
            '& .MuiDataGrid-cell--editable': {
              backgroundColor: editMode ? (isDark ? theme.palette.warning.dark : '#fff9c4') : 'transparent',
            },
            '& .MuiDataGrid-cell[data-field="inventory"]': {
              backgroundColor: editMode && (canEdit || canEditInventory) ? (isDark ? theme.palette.warning.dark : '#fff9c4') : 'transparent',
            },
            // Parent Assembly Row Styling
            '& .parent-assembly-row': {
              backgroundColor: isDark ? theme.palette.primary.dark : '#e3f2fd !important',
              fontWeight: 'bold !important',
              borderBottom: `3px solid ${theme.palette.primary.main} !important`,
              '&:hover': {
                backgroundColor: isDark ? theme.palette.primary.main : '#bbdefb !important',
              },
            },
            '& .parent-assembly-row .MuiDataGrid-cell': {
              fontWeight: 'bold !important',
              fontSize: '0.8em !important',
            },
            // Child Parts - Indented
            '& .child-part-row .MuiDataGrid-cell[data-field="part_number"]': {
              paddingLeft: '32px !important', // Indent child parts
            },
            '& .child-part-row .MuiDataGrid-cell[data-field="select"]': {
              paddingLeft: '24px !important', // Indent checkbox for children
            },
            // Allow rows to expand vertically for wrapped text
            '& .MuiDataGrid-row': {
              maxHeight: 'none !important',
            },
            '& .MuiDataGrid-row .MuiDataGrid-cell': {
              maxHeight: 'none !important',
            },
            // Ensure column headers can also wrap if needed
            '& .MuiDataGrid-columnHeader': {
              whiteSpace: 'normal !important',
              wordWrap: 'break-word !important',
              overflowWrap: 'break-word !important',
              paddingTop: '8px !important',
              paddingBottom: '8px !important',
              lineHeight: '1.4 !important',
            },
          }}
        >
          <DataGrid
            rows={filteredRows}
            columns={columns}
            density="compact"
            pageSize={25}
            rowsPerPageOptions={[25, 50, 100]}
            disableSelectionOnClick
            checkboxSelection={false}
            disableColumnReorder
            disableColumnResize={false}
            disableVirtualization={true}
            onColumnWidthChange={handleColumnWidthChange}
            getRowClassName={(params) => params.row.isParent ? 'parent-assembly-row' : 'child-part-row'}
            sortingOrder={['asc', 'desc']}
            sortComparator={(v1, v2, cellParams1, cellParams2) => {
              // Always keep parent row at the top
              if (cellParams1.row.isParent) return -1
              if (cellParams2.row.isParent) return 1
              // Normal comparison for child rows
              if (v1 === v2) return 0
              return v1 < v2 ? -1 : 1
            }}
            processRowUpdate={editMode && (canEdit || canEditInventory) ? processRowUpdate : undefined}
            onProcessRowUpdateError={(error) => {
              console.error('Error processing row update:', error)
              showNotification('Error updating row: ' + error.message, 'error')
            }}
            initialState={{
              columns: {
                columnVisibilityModel: {
                  part_type: true,
                },
              },
            }}
            sx={{
              height: '100%',
              fontSize: '0.75rem',
              '& .MuiDataGrid-cell:focus': {
                outline: 'none',
              },
              '& .MuiDataGrid-cell:focus-within': {
                outline: 'none',
              },
            }}
          />
        </Box>
      </Paper>

      {filteredRows.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 3 }}>
          <p>No items match your search criteria</p>
        </Box>
      )}

      {/* Thumbnail Dialog */}
      <ResizableDialog
        open={!!thumbnailDialog}
        onClose={() => {
          setThumbnailDialog(null)
          setSelectedFile(null)
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
        }}
        maxWidth="md"
        fullWidth
      >
        {thumbnailDialog && (
          <>
            <DialogTitle>{thumbnailDialog.partNumber} - Thumbnail</DialogTitle>
            <DialogContent>
              <Box sx={{ textAlign: 'center' }}>
                {hasThumbnail(thumbnailDialog.thumbnail) ? (
                  <img
                    src={getThumbnailSrc(thumbnailDialog.thumbnail)}
                    alt={thumbnailDialog.partNumber}
                    style={{ maxWidth: '100%', height: 'auto', marginBottom: 2 }}
                  />
                ) : (
                  <Box sx={{ py: 4, color: 'text.secondary' }}>
                    <Typography variant="body1">No thumbnail available</Typography>
                  </Box>
                )}
                
                {/* Upload Section - Only show if user can edit */}
                {canEdit && (
                  <Box sx={{ mt: 3, borderTop: 1, borderColor: 'divider', pt: 3 }}>
                    <Typography variant="h6" gutterBottom>
                      Upload Thumbnail
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                      <Button
                        variant="outlined"
                        component="label"
                        startIcon={<UploadIcon />}
                        disabled={uploadingThumbnail}
                      >
                        Select Image
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                          onChange={handleFileSelect}
                          style={{ display: 'none' }}
                        />
                      </Button>
                      {selectedFile && (
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="body2" color="text.secondary">
                            Selected: {selectedFile.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Size: {(selectedFile.size / 1024).toFixed(2)} KB
                          </Typography>
                        </Box>
                      )}
                      {selectedFile && (
                        <Button
                          variant="contained"
                          onClick={handleUploadThumbnail}
                          disabled={uploadingThumbnail}
                          startIcon={uploadingThumbnail ? <CircularProgress size={16} /> : <UploadIcon />}
                        >
                          {uploadingThumbnail ? 'Uploading...' : 'Upload Thumbnail'}
                        </Button>
                      )}
                    </Box>
                  </Box>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => {
                setThumbnailDialog(null)
                setSelectedFile(null)
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
              }}>Close</Button>
            </DialogActions>
          </>
        )}
      </ResizableDialog>

      {/* Thumbnail Hover Popover */}
      <Popover
        open={!!hoveredPart && !!thumbnailAnchor}
        anchorEl={thumbnailAnchor}
        onClose={() => {
          setHoveredPart(null)
          setThumbnailAnchor(null)
        }}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        disableRestoreFocus
        sx={{
          pointerEvents: ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 'auto' : 'none',
        }}
        PaperProps={{
          onMouseEnter: () => {
            // Keep popover open when hovering over it (desktop only)
            if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
              // Desktop behavior
            }
          },
          onMouseLeave: () => {
            // Only close on mouse leave for desktop
            if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
              setHoveredPart(null)
              setThumbnailAnchor(null)
            }
          },
          onClick: () => {
            // Close on click outside for touch devices
            if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
              setHoveredPart(null)
              setThumbnailAnchor(null)
            }
          },
          sx: {
            pointerEvents: 'auto',
            p: 1,
            maxWidth: 300,
            maxHeight: 300,
          }
        }}
      >
        {hoveredPart && hasThumbnail(hoveredPart.thumbnail) ? (
          <Box sx={{ textAlign: 'center' }}>
            <img
              src={getThumbnailSrc(hoveredPart.thumbnail)}
              alt={hoveredPart.partNumber}
              style={{ 
                maxWidth: '250px', 
                maxHeight: '250px', 
                width: 'auto', 
                height: 'auto',
                display: 'block',
                margin: '0 auto'
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {hoveredPart.partNumber}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ p: 2, textAlign: 'center', minWidth: 150 }}>
            <Typography variant="body2" color="text.secondary">
              No thumbnail available
            </Typography>
          </Box>
        )}
      </Popover>

      {/* ECO Information Dialog */}
      <ResizableDialog
        open={!!ecoDialog}
        onClose={() => setEcoDialog(null)}
        maxWidth="sm"
        fullWidth
      >
        {ecoDialog && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{ecoDialog.editMode ? 'Edit ECO' : 'ECO Information'} - {ecoDialog.partNumber}</span>
              {!ecoDialog.editMode && isAdmin && (
                <Tooltip title="Edit ECO">
                  <IconButton size="small" onClick={() => {
                    setEcoEditData({
                      description: ecoDialog.ecoDescription || '',
                      backwardCompatible: ecoDialog.backwardCompatible ? 'true' : 'false',
                    })
                    setEcoDialog({ ...ecoDialog, editMode: true })
                  }}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </DialogTitle>
            <DialogContent>
              <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                {hasThumbnail(ecoDialog.thumbnail) ? (
                  <Box
                    sx={{
                      width: 160,
                      height: 160,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: 'background.default',
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={getThumbnailSrc(ecoDialog.thumbnail)}
                      alt={ecoDialog.partNumber}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  </Box>
                ) : (
                  <Box
                    sx={{
                      width: 160, height: 160,
                      border: '1px dashed', borderColor: 'divider', borderRadius: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: 'background.default', flexShrink: 0,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">No thumbnail</Typography>
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">Part Number:</Typography>
                  <Typography variant="body1">{ecoDialog.partNumber || 'Unknown'}</Typography>
                </Box>
                <Box sx={{ mb: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {ecoDialog.partNumber && ecoDialog.revision && ecoDialog.hasPdf && (
                    <Tooltip title={`Open drawing PDF for REV${(ecoDialog.revision || '').replace(/^REV/i, '')}`}>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        startIcon={<PdfIcon />}
                        onClick={() => window.open(`/api/part-pdf/${encodeURIComponent(ecoDialog.partNumber)}/${encodeURIComponent(ecoDialog.revision)}?t=${Date.now()}`, '_blank', 'noopener,noreferrer')}
                      >
                        Drawing PDF
                      </Button>
                    </Tooltip>
                  )}
                  {ecoDialog.partNumber && ecoDialog.hasAiPdf && (
                    <Tooltip title="Open Assembly Instruction PDF">
                      <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        startIcon={<BuildIcon />}
                        onClick={() => window.open(`/api/part-ai/${encodeURIComponent(ecoDialog.partNumber)}`, '_blank', 'noopener,noreferrer')}
                      >
                        AI Drawing
                      </Button>
                    </Tooltip>
                  )}
                  {!ecoDialog.hasPdf && !ecoDialog.hasAiPdf && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      No drawing file available for this revision.
                    </Typography>
                  )}
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">Revision:</Typography>
                  <Typography variant="body1">{ecoDialog.revision || 'N/A'}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">Part Description:</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    {ecoDialog.partDescription || 'No description available'}
                  </Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">ECO Number:</Typography>
                  <Typography variant="body1">{ecoDialog.ecoNumber || 'N/A'}</Typography>
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">ECO Description:</Typography>
                  {ecoDialog.editMode ? (
                    <TextField
                      fullWidth
                      multiline
                      rows={3}
                      value={ecoEditData.description}
                      onChange={(e) => setEcoEditData({ ...ecoEditData, description: e.target.value })}
                      disabled={savingEco}
                      variant="outlined"
                      size="small"
                      sx={{ mt: 0.5 }}
                    />
                  ) : (
                    <Typography variant="body1">{ecoDialog.ecoDescription || 'No description available'}</Typography>
                  )}
                </Box>
                <Box sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" color="text.secondary">Backward Compatible:</Typography>
                  {ecoDialog.editMode ? (
                    <ToggleButtonGroup
                      value={ecoEditData.backwardCompatible}
                      exclusive
                      onChange={(e, newValue) => {
                        if (newValue !== null) {
                          setEcoEditData({ ...ecoEditData, backwardCompatible: newValue })
                        }
                      }}
                      disabled={savingEco}
                      size="small"
                      sx={{ mt: 0.5 }}
                    >
                      <ToggleButton value="true" sx={{ '&.Mui-selected': { bgcolor: 'success.main', color: 'white', '&:hover': { bgcolor: 'success.dark' } } }}>
                        Yes
                      </ToggleButton>
                      <ToggleButton value="false" sx={{ '&.Mui-selected': { bgcolor: 'warning.main', color: 'white', '&:hover': { bgcolor: 'warning.dark' } } }}>
                        No
                      </ToggleButton>
                    </ToggleButtonGroup>
                  ) : (
                    <Chip
                      label={ecoDialog.backwardCompatible ? 'Yes' : 'No'}
                      color={ecoDialog.backwardCompatible ? 'success' : 'warning'}
                      size="small"
                      sx={{ mt: 0.5 }}
                    />
                  )}
                </Box>
                </Box>
              </Box>
            </DialogContent>
            <DialogActions>
              {ecoDialog.editMode ? (
                <>
                  <Button onClick={() => setEcoDialog({ ...ecoDialog, editMode: false })} disabled={savingEco}>Cancel</Button>
                  <Button
                    onClick={handleSaveEco}
                    variant="contained"
                    disabled={savingEco}
                    startIcon={savingEco ? <CircularProgress size={16} /> : <SaveIcon />}
                  >
                    {savingEco ? 'Saving...' : 'Save'}
                  </Button>
                </>
              ) : (
                <Button onClick={() => setEcoDialog(null)}>Close</Button>
              )}
            </DialogActions>
          </>
        )}
      </ResizableDialog>

      {/* Part Type Selection Dialog */}
      <ResizableDialog
        open={partTypeDialog !== null}
        onClose={() => setPartTypeDialog(null)}
        title={`Override Part Type: ${partTypeDialog?.partNumber || ''}`}
        maxWidth="sm"
        fullWidth
      >
        {partTypeDialog && (
          <>
            <DialogContent>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Current type: <strong>{partTypeDialog.currentType}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: '0.75rem', fontStyle: 'italic' }}>
                This will override the auto-classified type for this part in all locations.
              </Typography>
              {loadingPartTypes ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: '55vh', overflow: 'auto' }}>
                  {availablePartTypes.map((type) => {
                    // Use color from API if available, otherwise use default
                    const typeColor = partTypeDialog?.colorMap?.[type] || '#6c757d'
                    // Convert hex to RGB for background with opacity
                    const hexToRgb = (hex) => {
                      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
                      return result ? {
                        r: parseInt(result[1], 16),
                        g: parseInt(result[2], 16),
                        b: parseInt(result[3], 16)
                      } : null
                    }
                    const rgb = hexToRgb(typeColor)
                    let style
                    if (!rgb) {
                      style = { bg: tc.chipFallbackBg, color: tc.chipFallbackColor, border: tc.chipFallbackBorder }
                    } else {
                      // Generate colors matching original hardcoded style with transparency
                      const blendWithWhite = (colorValue, factor) => Math.round(colorValue + (255 - colorValue) * factor)
                      const bgR = blendWithWhite(rgb.r, 0.88)
                      const bgG = blendWithWhite(rgb.g, 0.88)
                      const bgB = blendWithWhite(rgb.b, 0.88)
                      const borderR = blendWithWhite(rgb.r, 0.73)
                      const borderG = blendWithWhite(rgb.g, 0.73)
                      const borderB = blendWithWhite(rgb.b, 0.73)
                      style = {
                        bg: `rgba(${bgR}, ${bgG}, ${bgB}, 0.15)`, // More transparent background
                        color: typeColor, // Original darker color for contrast
                        border: `rgba(${borderR}, ${borderG}, ${borderB}, 0.4)` // Slightly transparent border
                      }
                    }
                    const isSelected = type === partTypeDialog.currentType
                    
                    return (
                      <Button
                        key={type}
                        variant={isSelected ? 'contained' : 'outlined'}
                        onClick={() => handlePartTypeUpdate(type)}
                        disabled={updatingPartType || isSelected}
                        sx={{
                          justifyContent: 'flex-start',
                          textTransform: 'none',
                          py: 1.5,
                          px: 2,
                          backgroundColor: isSelected ? style.bg : 'transparent',
                          color: isSelected ? style.color : 'text.primary',
                          borderColor: style.border,
                          '&:hover': {
                            backgroundColor: isSelected ? style.bg : style.bg,
                            opacity: 0.8,
                          },
                        }}
                      >
                        <Chip
                          label={type}
                          size="small"
                          sx={{
                            bgcolor: style.bg,
                            color: style.color,
                            border: `1px solid ${style.border}`,
                            mr: 1,
                            height: 24,
                            fontSize: '0.7rem',
                          }}
                        />
                        {type}
                        {isSelected && (
                          <Typography variant="caption" sx={{ ml: 'auto', fontStyle: 'italic' }}>
                            (Current)
                          </Typography>
                        )}
                      </Button>
                    )
                  })}
                </Box>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPartTypeDialog(null)} disabled={updatingPartType}>
                Cancel
              </Button>
            </DialogActions>
          </>
        )}
      </ResizableDialog>

      {/* Fullscreen Dialog */}
      <Dialog
        open={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
        fullScreen
        maxWidth={false}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">BOM Table - Fullscreen</Typography>
          <IconButton
            onClick={() => setFullscreenOpen(false)}
            sx={{ color: 'text.primary' }}
          >
            <FullscreenExitIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, m: 0, height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Search and Filter Controls */}
            <Box sx={{ display: 'flex', gap: 2, p: 2, flexWrap: 'wrap', alignItems: 'flex-start', flexShrink: 0 }}>
              <TextField
                size="small"
                placeholder="Search parts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
                sx={{ width: 250 }}
              />
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Type:</Typography>
                {availableFilterTypes.map((type) => (
                  <Chip
                    key={type}
                    label={type}
                    size="small"
                    clickable
                    color={typeFilter.includes(type) ? 'primary' : 'default'}
                    variant={typeFilter.includes(type) ? 'filled' : 'outlined'}
                    onClick={() => setTypeFilter(prev =>
                      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                    )}
                  />
                ))}
                {typeFilter.length > 0 && (
                  <Chip label="Clear" size="small" variant="outlined" color="error" onClick={() => setTypeFilter([])} />
                )}
              </Box>
              {showEditButton && (
                <Box sx={{ display: 'flex', gap: 1, ml: 'auto', alignItems: 'center' }}>
                  {!editMode ? (
                    <Button
                      variant="outlined"
                      startIcon={<EditIcon />}
                      onClick={() => setEditMode(true)}
                      size="small"
                    >
                      {canEditInventory && !canEdit ? 'Edit Inventory' : 'Edit Mode'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="contained"
                        color="success"
                        startIcon={<SaveIcon />}
                        onClick={handleSaveAllEdits}
                        disabled={saving || Object.keys(pendingEdits).length === 0}
                        size="small"
                      >
                        Save
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        startIcon={<CancelIcon />}
                        onClick={handleCancelEdits}
                        disabled={saving}
                        size="small"
                      >
                        Cancel
                      </Button>
                      {Object.keys(pendingEdits).length > 0 && (
                        <Chip
                          label={`${Object.keys(pendingEdits).length} pending change(s)`}
                          color="warning"
                          size="small"
                        />
                      )}
                    </>
                  )}
                </Box>
              )}
            </Box>
            
            {/* DataGrid in Fullscreen */}
            <Paper sx={{ 
              flex: 1,
              minHeight: 0,
              width: '100%', 
              maxWidth: '100%',
              position: 'relative', 
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              mx: 2,
              mb: 2
            }}>
              <Box
                sx={{
                  height: '100%',
                  width: '100%',
                  maxWidth: '100%',
                  flex: 1,
                  minHeight: 0,
                  overflow: 'hidden',
                  '& .MuiDataGrid-root': {
                    border: 'none',
                    width: '100%',
                    maxWidth: '100%',
                  },
                  '& .MuiDataGrid-main': {
                    overflowX: 'auto',
                    width: '100%',
                    maxWidth: '100%',
                  },
                  '& .MuiDataGrid-virtualScroller': {
                    overflowX: 'auto !important',
                    width: '100%',
                    maxWidth: '100%',
                  },
                  '& .MuiDataGrid-columnHeaders': {
                    backgroundColor: tc.tableHeaderBg,
                    position: 'sticky',
                    top: 0,
                    zIndex: 20,
                  },
                  '& .MuiDataGrid-cell': {
                    position: 'relative',
                    whiteSpace: 'normal !important',
                    wordWrap: 'break-word !important',
                    overflowWrap: 'break-word !important',
                    alignItems: 'flex-start !important',
                    paddingTop: '8px !important',
                    paddingBottom: '8px !important',
                    lineHeight: '1.4 !important',
                  },
                  '& .MuiDataGrid-cell > *': {
                    whiteSpace: 'normal !important',
                    wordWrap: 'break-word !important',
                    overflowWrap: 'break-word !important',
                  },
                  '& .MuiDataGrid-cell:not([data-field="part_type"]):not([data-field="part_number"]):not([data-field="revision"]):not([data-field="eco_number"]):not([data-field="description"])': {
                    zIndex: '1 !important',
                  },
                  '& .MuiDataGrid-columnHeader:not([data-field="select"]):not([data-field="part_type"]):not([data-field="part_number"]):not([data-field="revision"]):not([data-field="eco_number"]):not([data-field="description"])': {
                    zIndex: '1 !important',
                  },
                  '& .MuiDataGrid-columnHeader[data-field="select"]': {
                    position: 'sticky !important',
                    left: '0 !important',
                    zIndex: '101 !important',
                    backgroundColor: `${tc.tableHeaderBg} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-cell[data-field="select"]': {
                    position: 'sticky !important',
                    left: '0 !important',
                    zIndex: '91 !important',
                    backgroundColor: `${theme.palette.background.paper} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-columnHeader[data-field="part_type"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.part_type}px !important`,
                    zIndex: '100 !important',
                    backgroundColor: `${tc.tableHeaderBg} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-cell[data-field="part_type"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.part_type}px !important`,
                    zIndex: '90 !important',
                    backgroundColor: `${theme.palette.background.paper} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-columnHeader[data-field="part_number"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.part_number}px !important`,
                    zIndex: '99 !important',
                    backgroundColor: `${tc.tableHeaderBg} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-cell[data-field="part_number"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.part_number}px !important`,
                    zIndex: '89 !important',
                    backgroundColor: `${theme.palette.background.paper} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-columnHeader[data-field="revision"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.revision}px !important`,
                    zIndex: '98 !important',
                    backgroundColor: `${tc.tableHeaderBg} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-cell[data-field="revision"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.revision}px !important`,
                    zIndex: '88 !important',
                    backgroundColor: `${theme.palette.background.paper} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-columnHeader[data-field="eco_number"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.eco_number}px !important`,
                    zIndex: '97 !important',
                    backgroundColor: `${tc.tableHeaderBg} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-cell[data-field="eco_number"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.eco_number}px !important`,
                    zIndex: '87 !important',
                    backgroundColor: `${theme.palette.background.paper} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-columnHeader[data-field="description"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.description}px !important`,
                    zIndex: '96 !important',
                    backgroundColor: `${tc.tableHeaderBg} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-cell[data-field="description"]': {
                    position: 'sticky !important',
                    left: `${stickyLeftPositions.description}px !important`,
                    zIndex: '86 !important',
                    backgroundColor: `${theme.palette.background.paper} !important`,
                    borderRight: `2px solid ${theme.palette.divider} !important`,
                    boxShadow: isDark ? '2px 0 4px rgba(0,0,0,0.3) !important' : '2px 0 4px rgba(0,0,0,0.1) !important',
                  },
                  '& .MuiDataGrid-cell:focus': {
                    outline: 'none',
                  },
                  '& .MuiDataGrid-cell:focus-within': {
                    outline: 'none',
                  },
                  '& .editable-cell': {
                    backgroundColor: editMode ? (isDark ? theme.palette.action.hover : '#f8f9fc') : 'transparent',
                    cursor: editMode ? 'text' : 'default',
                  },
                  '& .MuiDataGrid-cell--editable': {
                    backgroundColor: editMode ? (isDark ? theme.palette.warning.dark : '#fff9c4') : 'transparent',
                  },
                  '& .MuiDataGrid-cell[data-field="inventory"]': {
                    backgroundColor: editMode && (canEdit || canEditInventory) ? (isDark ? theme.palette.warning.dark : '#fff9c4') : 'transparent',
                  },
                  '& .parent-assembly-row': {
                    backgroundColor: isDark ? theme.palette.primary.dark : '#e3f2fd !important',
                    fontWeight: 'bold !important',
                    borderBottom: `3px solid ${theme.palette.primary.main} !important`,
                    '&:hover': {
                      backgroundColor: isDark ? theme.palette.primary.main : '#bbdefb !important',
                    },
                  },
                  '& .parent-assembly-row .MuiDataGrid-cell': {
                    fontWeight: 'bold !important',
                    fontSize: '0.8em !important',
                  },
                  '& .child-part-row .MuiDataGrid-cell[data-field="part_number"]': {
                    paddingLeft: '32px !important',
                  },
                  '& .child-part-row .MuiDataGrid-cell[data-field="select"]': {
                    paddingLeft: '24px !important',
                  },
                  '& .MuiDataGrid-row': {
                    maxHeight: 'none !important',
                  },
                  '& .MuiDataGrid-row .MuiDataGrid-cell': {
                    maxHeight: 'none !important',
                  },
                  '& .MuiDataGrid-columnHeader': {
                    whiteSpace: 'normal !important',
                    wordWrap: 'break-word !important',
                    overflowWrap: 'break-word !important',
                    paddingTop: '8px !important',
                    paddingBottom: '8px !important',
                    lineHeight: '1.4 !important',
                  },
                }}
              >
                <DataGrid
                  rows={filteredRows}
                  columns={columns}
                  density="compact"
                  getRowId={(row) => row.id}
                  disableSelectionOnClick
                  checkboxSelection={false}
                  disableColumnReorder
                  disableColumnResize={false}
                  disableVirtualization={true}
                  onColumnWidthChange={handleColumnWidthChange}
                  getRowClassName={(params) => params.row.isParent ? 'parent-assembly-row' : 'child-part-row'}
                  sortingOrder={['asc', 'desc']}
                  sortComparator={(v1, v2, cellParams1, cellParams2) => {
                    if (cellParams1.row.isParent) return -1
                    if (cellParams2.row.isParent) return 1
                    if (v1 === v2) return 0
                    return v1 < v2 ? -1 : 1
                  }}
                  processRowUpdate={editMode && (canEdit || canEditInventory) ? processRowUpdate : undefined}
                  onProcessRowUpdateError={(error) => {
                    console.error('Error processing row update:', error)
                    showNotification('Error updating row: ' + error.message, 'error')
                  }}
                  initialState={{
                    columns: {
                      columnVisibilityModel: {
                        part_type: true,
                      },
                    },
                  }}
                  sx={{
                    height: '100%',
                    width: '100%',
                    fontSize: '0.75rem',
                  }}
                />
              </Box>
            </Paper>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Replace Part Dialog */}
      <ResizableDialog
        open={!!replacePartDialog}
        onClose={() => {
          setReplacePartDialog(null)
          setSelectedReplacementPart(null)
          setSearchResults([])
          setPartSearchQuery('')
        }}
        maxWidth="md"
        fullWidth
      >
        {replacePartDialog && (
          <>
            <DialogTitle>
              Replace Part: {replacePartDialog.currentPart.part_number} REV{replacePartDialog.currentPart.revision}
            </DialogTitle>
            <DialogContent>
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Search for a replacement part from the part list. The old part will be removed from this BOM and will appear in unused parts if it's not used elsewhere.
                </Typography>
                
                <TextField
                  fullWidth
                  label="Search Parts"
                  placeholder="Enter part number, name, or description..."
                  variant="outlined"
                  value={partSearchQuery}
                  onChange={(e) => setPartSearchQuery(e.target.value)}
                  sx={{ mb: 2 }}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                  }}
                />

                {searchingParts && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                    <CircularProgress size={24} />
                  </Box>
                )}

                {!searchingParts && searchResults.length > 0 && (
                  <Box sx={{ maxHeight: '55vh', overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    {searchResults.map((part) => (
                      <Box
                        key={part.id}
                        onClick={() => setSelectedReplacementPart(part)}
                        sx={{
                          p: 2,
                          cursor: 'pointer',
                          borderBottom: 1,
                          borderColor: 'divider',
                          backgroundColor: selectedReplacementPart?.id === part.id ? 'action.selected' : 'transparent',
                          '&:hover': {
                            backgroundColor: 'action.hover',
                          },
                        }}
                      >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Box>
                            <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                              {part.part_number} REV{part.revision}
                            </Typography>
                            {part.part_name && (
                              <Typography variant="body2" color="text.secondary">
                                {part.part_name}
                              </Typography>
                            )}
                            {part.description && (
                              <Typography variant="caption" color="text.secondary">
                                {part.description}
                              </Typography>
                            )}
                          </Box>
                          <Box sx={{ textAlign: 'right' }}>
                            {part.part_type && (
                              <Chip label={part.part_type} size="small" sx={{ mb: 0.5 }} />
                            )}
                            {part.unit_cost && (
                              <Typography variant="body2" color="text.secondary">
                                ${formatPrice(part.unit_cost)}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}

                {!searchingParts && searchResults.length === 0 && (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      Enter at least 2 characters to search for parts
                    </Typography>
                  </Box>
                )}

                {selectedReplacementPart && (
                  <Box sx={{ mt: 2, p: 2, bgcolor: 'action.selected', borderRadius: 1 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Selected Replacement:</Typography>
                    <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                      {selectedReplacementPart.part_number} REV{selectedReplacementPart.revision}
                    </Typography>
                    {selectedReplacementPart.part_name && (
                      <Typography variant="body2" color="text.secondary">
                        {selectedReplacementPart.part_name}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button
              onClick={() => {
                setReplacePartDialog(null)
                setSelectedReplacementPart(null)
                setSearchResults([])
                setPartSearchQuery('')
              }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleReplacePart}
                variant="contained"
                color="warning"
                disabled={!selectedReplacementPart || saving}
              >
                {saving ? 'Replacing...' : 'Replace Part'}
              </Button>
            </DialogActions>
          </>
        )}
      </ResizableDialog>

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

export default BOMTable
