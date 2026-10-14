import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import BOMsAndPartsTabBar from '../components/BOMsAndPartsTabBar'
import {
  Container,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Box,
  CircularProgress,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Chip,
  DialogTitle,
  DialogContent,
  DialogActions,
  Paper,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Divider,
  Avatar,
  useTheme,
  Menu,
} from '@mui/material'
import {
  ExpandMore as ExpandIcon,
  ChevronRight as ChevronRightIcon,
  Image as ImageIcon,
  PictureAsPdf as PdfIcon,
  Info as InfoIcon,
  Close as CloseIcon,
  Search as SearchIcon,
  Build as BuildIcon,
  Description as DescriptionIcon,
  Receipt as InvoiceIcon,
  Article as ArticleIcon,
  Inventory2 as ArrangementIcon,
  ViewInAr as ViewInArIcon,
  ThreeDRotation as ThreeDIcon,
} from '@mui/icons-material'
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView'
import { TreeItem } from '@mui/x-tree-view/TreeItem'
import { useNotification } from '../context/NotificationContext'
import { useAuth } from '../context/AuthContext'
import { bomService } from '../services/bomService'
import { adminService } from '../services/adminService'
import { rfqService } from '../services/rfqService'
import { bomCostService } from '../services/bomCostService'
import ResizableDialog from '../components/ResizableDialog'
import ResizableSidebar from '../components/ResizableSidebar'
import { getSemanticColors } from '../utils/themeColors'
import { hasThumbnail, getThumbnailSrc } from '../utils/thumbnail'

const AssemblyTree = () => {
  const { showNotification, liveVersions } = useNotification()
  const { user } = useAuth()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const tc = getSemanticColors(theme)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [boms, setBOMs] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedBOMId, setSelectedBOMId] = useState(null)
  const [selectedVersionId, setSelectedVersionId] = useState(null)
  const [currentBOMName, setCurrentBOMName] = useState('Assembly Tree')
  const [treeData, setTreeData] = useState(null)
  const [revisions, setRevisions] = useState({})
  const [currentPresentedVersion, setCurrentPresentedVersion] = useState(null)
  const [partDetailDialog, setPartDetailDialog] = useState(null)
  const [selectedBadgeId, setSelectedBadgeId] = useState(null)
  const [projectBadges, setProjectBadges] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedNodes, setExpandedNodes] = useState([])

  const [showDocumentChoiceModal, setShowDocumentChoiceModal] = useState(false)
  const [pendingAssemblyInfo, setPendingAssemblyInfo] = useState(null)
  const [partTypeColors, setPartTypeColors] = useState({}) // Map of part type name to color
  const [arrangementExportNode, setArrangementExportNode] = useState(null)
  const [arrangementExporting, setArrangementExporting] = useState(false)

  useEffect(() => {
    loadProjectBadges()
    loadBOMs()
    loadPartTypeColors()
    const bomId = searchParams.get('bom_id')
    if (bomId) {
      setSelectedBOMId(parseInt(bomId))
      loadBOMTree(parseInt(bomId))
    }
  }, [searchParams])

  const loadPartTypeColors = async () => {
    try {
      const response = await bomCostService.getPartTypes()
      if (response.data.success && response.data.types_with_colors) {
        const colorMap = {}
        response.data.types_with_colors.forEach(t => {
          colorMap[t.name] = t.color || '#6c757d'
        })
        setPartTypeColors(colorMap)
      }
    } catch (error) {
      console.error('Error loading part type colors:', error)
    }
  }

  useEffect(() => {
    loadBOMs()
  }, [selectedBadgeId])

  // Live update: re-fetch BOM list when another user changes BOMs
  const liveInitRef = useRef(true)
  useEffect(() => {
    if (liveInitRef.current) {
      liveInitRef.current = false
      return
    }
    loadBOMs()
  }, [liveVersions.boms])

  useEffect(() => {
    boms.forEach(bom => {
      loadBOMVersions(bom.id)
    })
  }, [boms])

  // Helper functions - defined before useMemo to avoid initialization errors
  const getPartType = (data) => {
    if (data.part_type && data.part_type !== 'Unknown') return data.part_type
    if (data.bom_columns?.Type) return data.bom_columns.Type

    const partNumber = data.name || ''
    const description = (data.description || data.bom_columns?.DESCRIPTION || '').toLowerCase()
    const state = (data.state || data.bom_columns?.State || '').toLowerCase()

    if (partNumber.includes('-MP-') && (state.includes('3d') || description.includes('3d') || description.includes('print'))) {
      return '3D Printing part'
    }

    if (partNumber.includes('-AS-')) return 'Assembly'
    if (partNumber.includes('-MP-')) return 'Mechanical part'
    if (partNumber.includes('EL-')) return 'Inhouse electrical part'
    if (partNumber.includes('ES-')) return 'External electrical part'
    if (partNumber.includes('CB-')) return 'Cables'

    const fastenerKeywords = ["DIN", "Screw", "Nut", "Washer", "PEM", "ISO", "PIN", "PT-WN", "Pin", "Magnet", "IUTB", "CLS", "BN", "Stand-off"]
    if (fastenerKeywords.some(k => partNumber.includes(k))) return 'Fasteners'

    const bearingKeywords = ["SKF", "Bearing", "NSK", "PCM", "PCMF", "bearing", "skf", "PG", "pcmf"]
    if (bearingKeywords.some(k => partNumber.includes(k))) return 'Bearings'

    return 'Unknown'
  }

  const isPdmPart = (partType) => {
    if (!partType) return false
    const t = partType.toLowerCase()
    return t === 'mp' || t.includes('mechanic') || t === 'as' || t.includes('assembly')
  }

  const getPartTypeColor = (partType) => {
    // Get color from managed part types, fallback to default
    const hexColor = partTypeColors[partType] || '#6c757d'
    
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
    
    if (!rgb) {
      return isDark
        ? { bg: theme.palette.background.paper, color: theme.palette.text.secondary }
        : { bg: tc.chipFallbackBg, color: tc.chipFallbackColor }
    }
    
    if (isDark) {
      // Dark mode: transparent colored background with white text
      return {
        bg: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.25)`, // 25% opacity for dark mode
        color: '#ffffff' // White text for contrast
      }
    } else {
      // Light mode: lighter background with black text and lower transparency (more opaque)
      const blendWithWhite = (colorValue, factor) => Math.round(colorValue + (255 - colorValue) * factor)
      const bgR = blendWithWhite(rgb.r, 0.88)
      const bgG = blendWithWhite(rgb.g, 0.88)
      const bgB = blendWithWhite(rgb.b, 0.88)
      
      return {
        bg: `rgba(${bgR}, ${bgG}, ${bgB}, 0.8)`, // 70% opacity for light mode - more opaque
        color: '#000000' // Black text for light mode
      }
    }
  }

  const getPartTypePriority = (partType) => {
    const priorityOrder = [
      "Assembly",
      "Mechanical part",
      "3D Printing part",
      "OTS",
      "Motors",
      "Gears",
      "Cross Roller Bearings",
      "Bearings",
      "Fasteners",
      "Inhouse electrical part",
      "External electrical part",
      "Cables",
      "Unknown"
    ]

    const index = priorityOrder.indexOf(partType)
    return index === -1 ? priorityOrder.length : index
  }

  // Filter tree data based on search term (assemblies and parts)
  const filteredTreeData = useMemo(() => {
    if (!treeData || !searchTerm) return treeData

    const filterTree = (node) => {
      const partNumber = node.name || node.bom_columns?.['PART NUMBER'] || ''
      const description = node.description || node.bom_columns?.DESCRIPTION || ''
      const searchLower = searchTerm.toLowerCase()
      
      // Check if this node matches (assembly or part)
      const nodeMatches = 
        partNumber.toLowerCase().includes(searchLower) ||
        description.toLowerCase().includes(searchLower)
      
      // Check children recursively
      const matchingChildren = node.children ? node.children.map(filterTree).filter(Boolean) : []
      
      // Include node if it matches OR has matching children (to maintain parent hierarchy)
      if (nodeMatches || matchingChildren.length > 0) {
        return { ...node, children: matchingChildren }
      }
      
      return null
    }

    return filterTree(treeData)
  }, [treeData, searchTerm])

  // Auto-expand nodes when search is active
  useEffect(() => {
    if (searchTerm && filteredTreeData) {
      const expandMatchingNodes = (node, nodeId = 'root', path = []) => {
        const newPath = [...path, nodeId]
        const expanded = []

        if (node.children && node.children.length > 0) {
          node.children.forEach((child, idx) => {
            const childId = `${nodeId}-${idx}`
            const childExpanded = expandMatchingNodes(child, childId, newPath)
            expanded.push(...childExpanded)
            if (!expanded.includes(childId)) {
              expanded.push(childId)
            }
          })
        }

        // Expand all parent nodes
        newPath.forEach(id => {
          if (!expanded.includes(id)) {
            expanded.push(id)
          }
        })

        return expanded
      }

      const newExpanded = expandMatchingNodes(filteredTreeData)
      setExpandedNodes(newExpanded)
    }
  }, [searchTerm, filteredTreeData])

  const loadProjectBadges = async () => {
    try {
      const response = await adminService.getBadges()
      if (Array.isArray(response.data)) {
        setProjectBadges(response.data)
      }
    } catch (error) {
      console.error('Error loading project badges:', error)
    }
  }

  const loadBOMs = async () => {
    try {
      const response = await bomService.getBOMs(selectedBadgeId)
      if (Array.isArray(response.data)) {
        setBOMs(response.data)
      } else if (response.data.success) {
        setBOMs(response.data.boms || [])
      }
    } catch (error) {
      console.error('Error loading BOMs:', error)
      showNotification('Error loading BOMs', 'error')
    }
  }

  const loadBOMVersions = async (bomId) => {
    try {
      const response = await bomService.getBOMRevisions(bomId)
      if (response.data.success && response.data.revisions) {
        setRevisions(prev => ({
          ...prev,
          [bomId]: response.data.revisions
        }))
      }
    } catch (error) {
      console.error('Error loading BOM versions:', error)
    }
  }

  const loadBOMTree = async (bomId, versionId = null) => {
    setLoading(true)
    try {
      const bom = boms.find(b => b.id === bomId)
      if (!bom) {
        const response = await bomService.getBOMs()
        const bomList = Array.isArray(response.data) ? response.data : (response.data.boms || [])
        const foundBom = bomList.find(b => b.id === bomId)
        if (foundBom) {
          setCurrentBOMName(foundBom.name)
        }
      } else {
        setCurrentBOMName(bom.name)
      }

      const idToUse = versionId || bomId
      const response = await bomService.getBOMDataNew(idToUse, 'tree')

      if (response.data.success) {
        const data = response.data.tree_data || response.data
        
        // Sort tree data recursively by type
        const sortTreeByType = (node) => {
          if (node.children && node.children.length > 0) {
            // Sort children by type priority, then by name
            node.children.sort((a, b) => {
              const typeA = getPartType(a)
              const typeB = getPartType(b)
              const priorityA = getPartTypePriority(typeA)
              const priorityB = getPartTypePriority(typeB)

              // First sort by type priority
              if (priorityA !== priorityB) {
                return priorityA - priorityB
              }

              // If same type, sort by name
              const nameA = a.name || a.bom_columns?.['PART NUMBER'] || ''
              const nameB = b.name || b.bom_columns?.['PART NUMBER'] || ''
              return nameA.localeCompare(nameB)
            })

            // Recursively sort children
            node.children.forEach(child => sortTreeByType(child))
          }
          return node
        }

        const sortedData = sortTreeByType(data)
        setTreeData(sortedData)
        setSelectedBOMId(bomId)
        setSelectedVersionId(versionId)
        // Expand root by default
        setExpandedNodes(['root'])
      } else {
        showNotification('Error loading tree data', 'error')
      }
    } catch (error) {
      console.error('Error loading tree data:', error)
      showNotification('Error loading tree data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const switchToVersion = (versionId, versionNumber, bomId) => {
    setCurrentPresentedVersion({ bomId, version: versionNumber })
    loadBOMTree(bomId, versionId)
  }

  const handleNodeClick = (event, nodeData) => {
    event.stopPropagation()
    // Only open part detail dialog for non-assemblies
    const partType = getPartType(nodeData)
    const isAssembly = partType === 'Assembly' || nodeData.bom_columns?.Type === 'Assembly' || nodeData.state === 'Assembly'
    
    if (!isAssembly) {
      // Open part detail modal
      openPartDetailDialog(nodeData)
    }
  }

  const openPartDetailDialog = (nodeData) => {
    setPartDetailDialog(nodeData)
  }

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

  const handleCreateSubAssemblyRFQ = async (event, node) => {
    event.stopPropagation()
    
    if (!node || !node.bom_columns) {
      showNotification('Invalid assembly data', 'error')
      return
    }

    const partNumber = node.bom_columns['PART NUMBER'] || node.name
    const assemblyName = partNumber || 'Sub-Assembly'

    try {
      // Build BOM data structure from sub-assembly tree
      const buildBOMData = (node) => {
        const children = []
        if (node.children && Array.isArray(node.children)) {
          node.children.forEach(child => {
            const childData = buildBOMData(child)
            if (childData) {
              children.push(childData)
            }
          })
        }

        // Only include parts (not assemblies) in the RFQ
        const partType = node.part_type || node.bom_columns?.['Type'] || 'Unknown'
        if (partType === 'Assembly' && children.length === 0) {
          return null // Skip empty assemblies
        }

        return {
          name: node.bom_columns?.['PART NUMBER'] || node.name || 'N/A',
          bom_columns: node.bom_columns || {},
          part_type: partType,
          revision: node.revision || node.bom_columns?.['Revision'] || '01',
          qty: parseFloat(node.qty || node.bom_columns?.['QTY.'] || 1),
          children: children
        }
      }

      const bomData = buildBOMData(node)
      if (!bomData || (!bomData.children || bomData.children.length === 0)) {
        showNotification('No parts found in this sub-assembly', 'warning')
        return
      }

      // Wrap in a root structure for Mechanical RFQ
      const rfqBOMData = {
        name: assemblyName,
        children: bomData.children || [bomData]
      }

      // Navigate to AssemblyBOM page and trigger mechanical RFQ flow
      // Store the BOM data in sessionStorage to be picked up by AssemblyBOM
      sessionStorage.setItem('subAssemblyRFQData', JSON.stringify({
        bom_data: rfqBOMData,
        bom_name: assemblyName,
        assembly_name: assemblyName
      }))
      
      // Navigate to AssemblyBOM page
      navigate('/assembly-bom?sub_assembly_rfq=true')
    } catch (error) {
      console.error('Error creating sub-assembly RFQ:', error)
      showNotification(error.response?.data?.error || 'Error creating RFQ', 'error')
    }
  }

  const handleChooseDocument = (type) => {
    if (pendingAssemblyInfo && pendingAssemblyInfo.partNumber) {
      if (type === 'pdf') {
        handleViewPDF(pendingAssemblyInfo.partNumber, pendingAssemblyInfo.revision)
      } else if (type === 'instruction') {
        handleViewAI(pendingAssemblyInfo.partNumber)
      }
    }
    
    setShowDocumentChoiceModal(false)
    setPendingAssemblyInfo(null)
  }

  const handleArrangementExport = async (exportType) => {
    if (!arrangementExportNode || !selectedBOMId) return
    const bomIdToUse = selectedVersionId || selectedBOMId
    const partNumber = arrangementExportNode.name || arrangementExportNode.bom_columns?.['PART NUMBER']
    if (!partNumber) {
      showNotification('Could not determine part number', 'error')
      return
    }

    setArrangementExporting(true)
    try {
      if (exportType === 'excel') {
        const response = await bomService.exportArrangement(bomIdToUse, partNumber, 'excel')
        // Trigger file download from blob
        const url = window.URL.createObjectURL(new Blob([response.data]))
        const link = document.createElement('a')
        link.href = url
        const filename = `${partNumber.replace(/[^A-Za-z0-9._-]/g, '_')}_arrangement.xlsx`
        link.setAttribute('download', filename)
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.URL.revokeObjectURL(url)
        showNotification('Part arrangement exported to Excel', 'success')
      } else {
        const response = await bomService.exportArrangement(bomIdToUse, partNumber, 'sheets')
        if (response.data.success && response.data.spreadsheet_url) {
          window.open(response.data.spreadsheet_url, '_blank')
          showNotification('Part arrangement exported to Google Sheets', 'success')
        } else {
          showNotification(response.data.error || 'Failed to create Google Sheets', 'error')
        }
      }
    } catch (error) {
      const errMsg = error.response?.data?.error || 'Error exporting part arrangement'
      showNotification(errMsg, 'error')
    } finally {
      setArrangementExporting(false)
      setArrangementExportNode(null)
    }
  }

  const renderTreeItem = (node, nodeId = 'root', level = 0) => {
    const partType = getPartType(node)
    const partNumber = node.name || node.bom_columns?.['PART NUMBER'] || 'N/A'
    const revision = node.bom_columns?.Revision || node.revision || 'N/A'
    const description = node.description || node.bom_columns?.DESCRIPTION || 'No description'
    const qty = parseFloat(node.qty || node.bom_columns?.['QTY.'] || node.bom_columns?.Quantity || '1')
    const ecoNumber = node.bom_columns?.['ECO Number'] || node.eco_number
    const warehouseBox = node.bom_columns?.['Warehouse Box'] || node.warehouse_box_number
    const thumbnail = node.thumbnail
    const hasThumb = hasThumbnail(thumbnail)
    const isAssembly = partType === 'Assembly' || node.bom_columns?.Type === 'Assembly' || node.state === 'Assembly'
    const typeColor = getPartTypeColor(partType)
    const hasChildren = node.children && node.children.length > 0
    
    const label = (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          p: 1,
          borderRadius: 1,
          bgcolor: isAssembly ? typeColor.bg : 'transparent',
          border: `1px solid ${isAssembly ? typeColor.color : theme.palette.divider}`,
          cursor: isAssembly ? 'default' : 'pointer',
          '&:hover': {
            bgcolor: isAssembly 
              ? (isDark ? theme.palette.primary.main : `${typeColor.bg}dd`)
              : theme.palette.action.hover,
          },
          minWidth: 300,
        }}
        onClick={(e) => handleNodeClick(e, node)}
      >
        {/* Thumbnail */}
        {hasThumb ? (
          <Avatar
            src={getThumbnailSrc(thumbnail)}
            variant="rounded"
            sx={{ width: 50, height: 50 }}
            onClick={(e) => {
              e.stopPropagation()
              openPartDetailDialog(node)
            }}
          />
        ) : (
          <Avatar variant="rounded" sx={{ width: 50, height: 50, bgcolor: theme.palette.action.hover }}>
            <ImageIcon />
          </Avatar>
        )}

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography 
              variant="body2" 
              sx={{ 
                fontWeight: 600, 
                color: isAssembly 
                  ? (isDark ? theme.palette.primary.light : '#1565c0')
                  : typeColor.color 
              }}
            >
              {partNumber}
            </Typography>
            <Chip label={partType} size="small" sx={{ bgcolor: typeColor.bg, color: typeColor.color, fontSize: '0.65rem', height: 20 }} />
            {ecoNumber && (
              <Chip
                label={`ECO: ${ecoNumber}`}
                size="small"
                sx={{ bgcolor: tc.purpleChip, color: 'white', fontSize: '0.65rem', height: 20 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setPartDetailDialog(node)
                }}
              />
            )}
            <Chip label={`Qty: ${qty}`} size="small" sx={{ fontSize: '0.65rem', height: 20 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {description}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">Rev: {revision}</Typography>
            {warehouseBox && (
              <Typography variant="caption" color="text.secondary">• Box: {warehouseBox}</Typography>
            )}
            {isAssembly && hasChildren && (
              <Box sx={{ display: 'flex', gap: 0.5, ml: 'auto', alignItems: 'center' }}>
                {partNumber !== 'N/A' && revision && (
                  <>
                    {node.has_pdf && (
                      <IconButton
                        size="small"
                        sx={{ p: 0.25 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleViewPDF(partNumber, revision)
                        }}
                      >
                        <PdfIcon fontSize="small" />
                      </IconButton>
                    )}
                    {(user?.role === 'engineer' || user?.role === 'admin') && (
                      <IconButton
                        size="small"
                        sx={{ p: 0.25 }}
                        onClick={(e) => handleCreateSubAssemblyRFQ(e, node)}
                        title="Create Mechanical RFQ for this sub-assembly"
                      >
                        <DescriptionIcon fontSize="small" />
                      </IconButton>
                    )}
                    {(user?.role === 'floor_manager' || user?.role === 'admin' || user?.role === 'engineer') && (
                      <IconButton
                        size="small"
                        sx={{ p: 0.25 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setArrangementExportNode(node)
                        }}
                        title="Export part arrangement (MP parts only)"
                      >
                        <ArrangementIcon fontSize="small" />
                      </IconButton>
                    )}
                    {node.has_ai_pdf && (
                      <IconButton
                        size="small"
                        sx={{ p: 0.25 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleViewAI(partNumber)
                        }}
                      >
                        <BuildIcon fontSize="small" />
                      </IconButton>
                    )}
                    {node.datasheet_drive_url && (
                      <IconButton
                        size="small"
                        sx={{ p: 0.25, color: 'info.main' }}
                        component="a"
                        href={node.datasheet_drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        title="View datasheet"
                      >
                        <ArticleIcon fontSize="small" />
                      </IconButton>
                    )}
                  </>
                )}
              </Box>
            )}
            {!isAssembly && partNumber !== 'N/A' && revision && (
              <>
                {node.has_pdf && (
                  <IconButton
                    size="small"
                    sx={{ p: 0.25, ml: 'auto' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleViewPDF(partNumber, revision)
                    }}
                  >
                    <PdfIcon fontSize="small" />
                  </IconButton>
                )}
                {node.has_step && (
                  <IconButton
                    size="small"
                    sx={{ p: 0.25, color: 'success.main' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDownloadSTEP(e, partNumber, revision, node.step_files)
                    }}
                    title="Download STEP file"
                  >
                    <ViewInArIcon fontSize="small" />
                  </IconButton>
                )}
                {partNumber && partNumber.includes('-AS-') && (
                  <IconButton
                    size="small"
                    sx={{ p: 0.25, color: tc.highlightIcon }}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(`/api/open-3d-viewer/${partNumber}/${revision}`, '_blank')
                    }}
                    title="Open 3D viewer (eDrawings)"
                  >
                    <ThreeDIcon fontSize="small" />
                  </IconButton>
                )}
                {node.datasheet_drive_url && (
                  <IconButton
                    size="small"
                    sx={{ p: 0.25, color: 'info.main', ml: isPdmPart(partType) ? 0 : 'auto' }}
                    component="a"
                    href={node.datasheet_drive_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title="View datasheet"
                  >
                    <ArticleIcon fontSize="small" />
                  </IconButton>
                )}
              </>
            )}
          </Box>
        </Box>
      </Box>
    )

    return (
      <TreeItem
        key={nodeId}
        itemId={nodeId}
        label={label}
        sx={{
          '& .MuiTreeItem-content': {
            py: 0.5,
          },
          '& .MuiTreeItem-group': {
            marginLeft: 2,
          },
        }}
      >
        {hasChildren && (() => {
          // Sort children by type priority, then by name
          const sortedChildren = [...node.children].sort((a, b) => {
            const typeA = getPartType(a)
            const typeB = getPartType(b)
            const priorityA = getPartTypePriority(typeA)
            const priorityB = getPartTypePriority(typeB)

            // First sort by type priority
            if (priorityA !== priorityB) {
              return priorityA - priorityB
            }

            // If same type, sort by name
            const nameA = a.name || a.bom_columns?.['PART NUMBER'] || ''
            const nameB = b.name || b.bom_columns?.['PART NUMBER'] || ''
            return nameA.localeCompare(nameB)
          })

          return sortedChildren.map((child, idx) => renderTreeItem(child, `${nodeId}-${idx}`, level + 1))
        })()}
      </TreeItem>
    )
  }

  const handleExpandAll = () => {
    const expandNode = (node, nodeId = 'root', path = []) => {
      const newPath = [...path, nodeId]
      const expanded = [nodeId]

      if (node.children && node.children.length > 0) {
        node.children.forEach((child, idx) => {
          const childId = `${nodeId}-${idx}`
          expanded.push(...expandNode(child, childId, newPath))
        })
      }

      return expanded
    }

    if (filteredTreeData) {
      const allExpanded = expandNode(filteredTreeData)
      setExpandedNodes(allExpanded)
    }
  }

  const handleCollapseAll = () => {
    setExpandedNodes(['root'])
  }


  return (
    <Box sx={{ width: '100%', height: 'calc(100vh - 44px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, pt: 0.75, pb: 0.25, flexShrink: 0 }}>
        <BOMsAndPartsTabBar />
        <Typography variant="h5" sx={{ fontSize: '0.95rem', fontWeight: 600, mb: 0.25 }}>
          Assembly Tree Visualization
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Interactive hierarchical view of your assembly structure
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, px: 1.5, pb: 0.75, display: 'flex', gap: 1 }}>
        {/* Left Panel: BOM Selection */}
        <ResizableSidebar
          defaultWidth={500}
          minWidth={300}
          maxWidth={800}
          side="left"
        >
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6">Select BOM</Typography>
                </Box>
              }
              sx={{ pb: 1 }}
            />
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 0 }, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
                <Chip
                  label="All"
                  size="small"
                  onClick={() => setSelectedBadgeId(null)}
                  sx={{
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    height: 24,
                    bgcolor: !selectedBadgeId ? 'primary.main' : 'action.selected',
                    color: !selectedBadgeId ? 'white' : 'text.primary',
                    '&:hover': { bgcolor: !selectedBadgeId ? 'primary.dark' : 'action.hover' },
                  }}
                />
                {projectBadges.map((badge) => (
                  <Chip
                    key={badge.id}
                    label={badge.name}
                    size="small"
                    onClick={() => setSelectedBadgeId(badge.id)}
                    sx={{
                      fontWeight: 500,
                      fontSize: '0.7rem',
                      height: 24,
                      bgcolor: selectedBadgeId === badge.id ? (badge.color || '#6c757d') : 'action.selected',
                      color: selectedBadgeId === badge.id ? 'white' : 'text.primary',
                      '&:hover': {
                        bgcolor: selectedBadgeId === badge.id
                          ? (badge.color || '#6c757d')
                          : 'action.hover',
                        opacity: selectedBadgeId === badge.id ? 0.85 : 1,
                      },
                    }}
                  />
                ))}
              </Box>
              <Paper
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  overflowX: 'hidden'
                }}
              >
                {boms.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <CircularProgress size={24} />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      Loading BOMs...
                    </Typography>
                  </Box>
                ) : (
                  <List sx={{ p: 0 }}>
                    {boms.map(bom => {
                      const bomRevisions = revisions[bom.id] || []
                      const isActive = selectedBOMId === bom.id
                      const presented = currentPresentedVersion?.bomId === bom.id

                      const uniqueRevisions = bomRevisions.filter((v, idx, self) =>
                        idx === self.findIndex(rev => rev.version === v.version)
                      )
                      const latestVersion = uniqueRevisions.find(v => v.is_latest) || uniqueRevisions[0]
                      const activeVersion = presented
                        ? uniqueRevisions.find(v => v.version === currentPresentedVersion?.version)
                        : null
                      const selectedVersion = activeVersion || latestVersion

                      return (
                        <ListItem
                          key={bom.id}
                          disablePadding
                          sx={{
                            borderBottom: `1px solid ${theme.palette.divider}`,
                            bgcolor: isActive
                              ? (isDark ? theme.palette.primary.dark : '#e7f1ff')
                              : 'transparent',
                            borderLeft: isActive
                              ? `3px solid ${theme.palette.primary.main}`
                              : '3px solid transparent',
                            '&:hover': {
                              bgcolor: theme.palette.action.hover,
                              borderLeft: `3px solid ${theme.palette.primary.main}`,
                            },
                          }}
                        >
                          <Box
                            sx={{ width: '100%', p: 1.5, cursor: 'pointer' }}
                            onClick={() => loadBOMTree(bom.id)}
                          >
                            {/* Row 1: Name + Badge */}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 600,
                                  flex: 1,
                                  color: isActive && isDark
                                    ? theme.palette.primary.light
                                    : 'text.primary',
                                }}
                              >
                                {bom.name}
                              </Typography>
                              {bom.badge && (
                                <Chip
                                  label={bom.badge.name}
                                  size="small"
                                  sx={{
                                    height: 18,
                                    fontSize: '0.62rem',
                                    bgcolor: bom.badge.color || '#6c757d',
                                    color: 'white',
                                    flexShrink: 0,
                                    '& .MuiChip-label': { px: 0.75 },
                                  }}
                                />
                              )}
                            </Box>

                            {/* Row 2: Part number + Version dropdown */}
                            <Box
                              sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                              onClick={e => e.stopPropagation()}
                            >
                              <Typography
                                variant="caption"
                                sx={{ color: 'text.secondary', fontFamily: 'monospace', flex: 1 }}
                              >
                                {bom.assembly_part_number || '—'}
                              </Typography>
                              {uniqueRevisions.length > 0 && (
                                <Select
                                  size="small"
                                  value={selectedVersion?.id || ''}
                                  onChange={(e) => {
                                    const chosen = uniqueRevisions.find(v => v.id === e.target.value)
                                    if (chosen) switchToVersion(chosen.id, chosen.version, bom.id)
                                  }}
                                  sx={{
                                    fontSize: '0.72rem',
                                    height: 26,
                                    minWidth: 120,
                                    flexShrink: 0,
                                    '& .MuiSelect-select': { py: 0.25, px: 1 },
                                  }}
                                >
                                  {uniqueRevisions.map(v => (
                                    <MenuItem key={v.id} value={v.id} sx={{ fontSize: '0.75rem' }}>
                                      {v.version}{v.is_latest ? ' (LATEST)' : ''}
                                    </MenuItem>
                                  ))}
                                </Select>
                              )}
                            </Box>
                          </Box>
                        </ListItem>
                      )
                    })}
                  </List>
                )}
              </Paper>
            </CardContent>
          </Card>
        </ResizableSidebar>

        {/* Middle Panel: Tree Visualization */}
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <CardHeader
              title={
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <Typography variant="h6">{currentBOMName}</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button size="small" onClick={handleExpandAll} startIcon={<ExpandIcon />}>
                      Expand All
                    </Button>
                    <Button size="small" onClick={handleCollapseAll} startIcon={<ChevronRightIcon />}>
                      Collapse All
                    </Button>
                  </Box>
                </Box>
              }
              sx={{ pb: 1 }}
            />
            <CardContent sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {/* Search */}
              <TextField
                fullWidth
                size="small"
                placeholder="Search assemblies and parts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
                sx={{ mb: 2 }}
              />

              {/* Tree View */}
              <Paper sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                {loading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                    <Typography sx={{ ml: 2 }}>Loading tree structure...</Typography>
                  </Box>
                ) : filteredTreeData ? (
                  <SimpleTreeView
                    slots={{
                      collapseIcon: ExpandIcon,
                      expandIcon: ChevronRightIcon,
                    }}
                    expandedItems={expandedNodes}
                    onExpandedItemsChange={(event, nodeIds) => {
                      setExpandedNodes(nodeIds)
                    }}
                  >
                    {renderTreeItem(filteredTreeData, 'root')}
                  </SimpleTreeView>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 5 }}>
                    <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
                      Select a BOM to view its assembly tree
                    </Typography>
                  </Box>
                )}
              </Paper>
            </CardContent>
          </Card>
        </Box>

      </Box>

      {/* Document Choice Modal */}
      <ResizableDialog
        open={showDocumentChoiceModal}
        onClose={() => {
          setShowDocumentChoiceModal(false)
          setPendingAssemblyInfo(null)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">Choose Document</Typography>
            <IconButton 
              onClick={() => {
                setShowDocumentChoiceModal(false)
                setPendingAssemblyInfo(null)
              }} 
              size="small"
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 3 }}>
            Select which document you would like to view:
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Button
              variant="outlined"
              fullWidth
              size="medium"
              startIcon={<BuildIcon />}
              onClick={() => handleChooseDocument('instruction')}
              sx={{
                py: 1.25,
                fontSize: '0.85rem',
                justifyContent: 'flex-start'
              }}
            >
              Assembly Instruction
            </Button>
            <Button
              variant="outlined"
              fullWidth
              size="medium"
              startIcon={<PdfIcon />}
              onClick={() => handleChooseDocument('pdf')}
              sx={{
                py: 1.25,
                fontSize: '0.85rem',
                justifyContent: 'flex-start'
              }}
            >
              Assembly PDF
            </Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button 
            onClick={() => {
              setShowDocumentChoiceModal(false)
              setPendingAssemblyInfo(null)
            }}
          >
            Cancel
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Part Arrangement Export Modal */}
      <ResizableDialog
        open={!!arrangementExportNode}
        onClose={() => !arrangementExporting && setArrangementExportNode(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Export Part Arrangement</Typography>
            <IconButton
              onClick={() => !arrangementExporting && setArrangementExportNode(null)}
              size="small"
              disabled={arrangementExporting}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {arrangementExportNode?.name || arrangementExportNode?.bom_columns?.['PART NUMBER'] || ''}
          </Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>
            Export dissolved mechanical parts (-MP-) for part arrangement:
          </Typography>
          {arrangementExporting ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Button
                variant="outlined"
                fullWidth
                size="medium"
                onClick={() => handleArrangementExport('excel')}
                sx={{ py: 1.25, fontSize: '0.85rem', justifyContent: 'flex-start' }}
              >
                Excel (with thumbnails)
              </Button>
              <Button
                variant="outlined"
                fullWidth
                size="medium"
                onClick={() => handleArrangementExport('sheets')}
                sx={{ py: 1.25, fontSize: '0.85rem', justifyContent: 'flex-start' }}
              >
                Google Sheets
              </Button>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            onClick={() => setArrangementExportNode(null)}
            disabled={arrangementExporting}
          >
            Cancel
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Part Detail Dialog */}
      <ResizableDialog
        open={!!partDetailDialog}
        onClose={() => setPartDetailDialog(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="h6">
              {partDetailDialog?.name || partDetailDialog?.bom_columns?.['PART NUMBER'] || 'Part Details'}
            </Typography>
            <IconButton onClick={() => setPartDetailDialog(null)} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          {partDetailDialog && (
            <Grid container spacing={3} sx={{ mt: 1 }}>
              {/* Large Thumbnail */}
              <Grid item xs={12} md={6}>
                {hasThumbnail(partDetailDialog.thumbnail) ? (
                  <Box sx={{ textAlign: 'center' }}>
                    <img
                      src={getThumbnailSrc(partDetailDialog.thumbnail)}
              alt="Part thumbnail"
                      style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: 4 }}
            />
            </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 8, bgcolor: tc.emptyStateBg, borderRadius: 2 }}>
                    <ImageIcon sx={{ fontSize: 64, color: 'text.secondary' }} />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                      No thumbnail available
                    </Typography>
          </Box>
                )}
              </Grid>

              {/* Part Information */}
              <Grid item xs={12} md={6}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Part Number</Typography>
                    <Typography variant="body1">{partDetailDialog.name || partDetailDialog.bom_columns?.['PART NUMBER'] || 'N/A'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Revision</Typography>
                    <Typography variant="body1">{partDetailDialog.bom_columns?.Revision || partDetailDialog.revision || 'N/A'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Description</Typography>
                    <Typography variant="body1">{partDetailDialog.description || partDetailDialog.bom_columns?.DESCRIPTION || 'No description'}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Part Type</Typography>
                    <Chip label={getPartType(partDetailDialog)} size="small" sx={{ mt: 0.5 }} />
                  </Box>
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Quantity</Typography>
                    <Typography variant="body1">{partDetailDialog.qty || partDetailDialog.bom_columns?.['QTY.'] || partDetailDialog.bom_columns?.Quantity || '1'}</Typography>
                  </Box>
                  {partDetailDialog.bom_columns?.['ECO Number'] || partDetailDialog.eco_number ? (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">ECO Number</Typography>
                      <Typography variant="body1">{partDetailDialog.bom_columns?.['ECO Number'] || partDetailDialog.eco_number}</Typography>
                      {partDetailDialog.bom_columns?.['ECO Description'] && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          {partDetailDialog.bom_columns['ECO Description']}
                        </Typography>
                      )}
                    </Box>
                  ) : null}
                  {partDetailDialog.bom_columns?.['Warehouse Box'] || partDetailDialog.warehouse_box_number ? (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Warehouse Box</Typography>
                      <Typography variant="body1">{partDetailDialog.bom_columns?.['Warehouse Box'] || partDetailDialog.warehouse_box_number}</Typography>
                    </Box>
                  ) : null}
                  <Box>
                    <Typography variant="subtitle2" color="text.secondary">Inventory</Typography>
                    <Typography variant="body1">{partDetailDialog.inventory !== undefined ? partDetailDialog.inventory : (partDetailDialog.bom_columns?.Inventory || 0)}</Typography>
                  </Box>
                  {partDetailDialog.bom_columns?.['Material'] ? (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Material</Typography>
                      <Typography variant="body1">{partDetailDialog.bom_columns.Material}</Typography>
                    </Box>
                  ) : null}
                  {partDetailDialog.bom_columns?.['Vendor'] ? (
                    <Box>
                      <Typography variant="subtitle2" color="text.secondary">Vendor</Typography>
                      <Typography variant="body1">{partDetailDialog.bom_columns.Vendor}</Typography>
                    </Box>
                  ) : null}
                  {partDetailDialog.name && partDetailDialog.bom_columns?.Revision && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {partDetailDialog.has_pdf && (
                        <Button
                          variant="outlined"
                          startIcon={<PdfIcon />}
                          onClick={() => handleViewPDF(partDetailDialog.name, partDetailDialog.bom_columns.Revision)}
                          fullWidth
                        >
                          View PDF
                        </Button>
                      )}
                      {partDetailDialog.has_ai_pdf && (
                        <Button
                          variant="outlined"
                          startIcon={<BuildIcon />}
                          onClick={() => handleViewAI(partDetailDialog.name)}
                          fullWidth
                        >
                          View AI
                        </Button>
                      )}
                      {partDetailDialog.has_step && (
                        <Button
                          variant="outlined"
                          startIcon={<ViewInArIcon />}
                          onClick={(e) => handleDownloadSTEP(e, partDetailDialog.name, partDetailDialog.bom_columns.Revision, partDetailDialog.step_files)}
                          fullWidth
                          color="success"
                        >
                          Download STEP
                        </Button>
                      )}
                    </Box>
                  )}
                </Box>
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPartDetailDialog(null)}>Close</Button>
        </DialogActions>
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

export default AssemblyTree
