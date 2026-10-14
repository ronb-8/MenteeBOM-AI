import { useState, useEffect, useMemo, useRef } from 'react'
import { useTheme } from '@mui/material/styles'
import { getSemanticColors } from '../utils/themeColors'
import BOMsAndPartsTabBar from '../components/BOMsAndPartsTabBar'
import {
  Container, Box, Typography, Button, Paper, Chip, TextField, Grid,
  Checkbox, CircularProgress, IconButton, Tooltip, Alert,
  FormControl, InputLabel, Select, MenuItem, Radio, RadioGroup,
  FormControlLabel, FormLabel, Card, CardContent, CardHeader,
  List, ListItem, ListItemButton, ListItemText,
  DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Receipt as InvoiceIcon,
  Description as DescriptionIcon,
  Download as DownloadIcon,
  TableChart as TableIcon,
  Upload as UploadIcon,
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  FolderOpen as FolderOpenIcon,
} from '@mui/icons-material'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import { bomService } from '../services/bomService'
import { hasThumbnail, getThumbnailSrc } from '../utils/thumbnail'
import { rfqService } from '../services/rfqService'
import { adminService } from '../services/adminService'
import BOMTable from '../components/BOMTable'
import ResizableSidebar from '../components/ResizableSidebar'
import ResizableDialog from '../components/ResizableDialog'

const LimbsBOM = () => {
  const { user } = useAuth()
  const { showNotification, liveVersions } = useNotification()
  const theme = useTheme()
  const tc = getSemanticColors(theme)

  // Dissolved BOMs state
  const [dissolvedBOMs, setDissolvedBOMs] = useState([])
  const [selectedDissolvedId, setSelectedDissolvedId] = useState(null)
  const [dissolvedData, setDissolvedData] = useState(null)
  const [loading, setLoading] = useState(false)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createMode, setCreateMode] = useState('full')
  const [availableBOMs, setAvailableBOMs] = useState([])
  const [selectedBOMIds, setSelectedBOMIds] = useState(new Set())
  const [creating, setCreating] = useState(false)
  const [bomSearchTerm, setBomSearchTerm] = useState('')
  const [projectBadges, setProjectBadges] = useState([])
  const [createBadgeFilter, setCreateBadgeFilter] = useState(null)

  // Parts table state — BOMTable uses `${partNumber}_${revision}` keys for selection
  const [selectedPartKeys, setSelectedPartKeys] = useState(new Set())

  // Export state
  const [exporting, setExporting] = useState(false)

  // Multi-BOM selection (when no dissolved BOM loaded)
  const [showMultiBOMModal, setShowMultiBOMModal] = useState(false)
  const [multiBOMList, setMultiBOMList] = useState([])
  const [multiBOMSelectedIds, setMultiBOMSelectedIds] = useState(new Set())
  const [multiBOMSearch, setMultiBOMSearch] = useState('')
  const [multiBOMBadges, setMultiBOMBadges] = useState([])
  const [multiBOMBadgeFilter, setMultiBOMBadgeFilter] = useState(null)
  const [isStandardRFQMultiBOM, setIsStandardRFQMultiBOM] = useState(false)
  const [pendingBOMData, setPendingBOMData] = useState(null)

  // Vendor filter modal (shown before mechanical RFQ file status)
  const [showVendorFilterModal, setShowVendorFilterModal] = useState(false)
  const [availableVendorsForRFQ, setAvailableVendorsForRFQ] = useState([])
  const [selectedVendorsForRFQ, setSelectedVendorsForRFQ] = useState(new Set())
  const [pendingRFQParts, setPendingRFQParts] = useState(null) // parts waiting for vendor filter

  // Mechanical RFQ File Status
  const [rfqFileStatus, setRfqFileStatus] = useState(null)
  const [showRFQFileStatusModal, setShowRFQFileStatusModal] = useState(false)
  const [removedRFQParts, setRemovedRFQParts] = useState(new Set())
  const [selectedRFQParts, setSelectedRFQParts] = useState(new Set())
  const [creatingRFQ, setCreatingRFQ] = useState(false)
  const [refreshingRFQStatus, setRefreshingRFQStatus] = useState(false)

  // Quantity/Multiplier modal
  const [showQuantityModal, setShowQuantityModal] = useState(false)
  const [globalMultiplier, setGlobalMultiplier] = useState(1)
  const [customQuantities, setCustomQuantities] = useState({})
  const [multiplierMode, setMultiplierMode] = useState('general')
  const [bomMultipliers, setBomMultipliers] = useState({})

  // RFQ Name
  const [showRFQNameModal, setShowRFQNameModal] = useState(false)
  const [customRFQName, setCustomRFQName] = useState('')

  // Standard Parts RFQ
  const [showStandardPartsTypeModal, setShowStandardPartsTypeModal] = useState(false)
  const [availablePartTypes, setAvailablePartTypes] = useState([])
  const [selectedPartTypes, setSelectedPartTypes] = useState([])
  const [showStandardPartsQtyModal, setShowStandardPartsQtyModal] = useState(false)
  const [standardPartsQuantityList, setStandardPartsQuantityList] = useState([])
  const [standardPartsRFQName, setStandardPartsRFQName] = useState('')

  // Export success modal
  const [showExportSuccessModal, setShowExportSuccessModal] = useState(false)
  const [exportResult, setExportResult] = useState(null)

  useEffect(() => {
    loadDissolvedBOMs()
  }, [])

  // Live update: re-fetch when another user changes BOMs / dissolved BOMs
  const liveInitRef = useRef(true)
  useEffect(() => {
    if (liveInitRef.current) {
      liveInitRef.current = false
      return
    }
    loadDissolvedBOMs()
  }, [liveVersions.boms])

  const loadDissolvedBOMs = async () => {
    try {
      const response = await bomService.getDissolvedBOMs()
      if (response.data.success) {
        setDissolvedBOMs(response.data.dissolved_boms || [])
      }
    } catch (error) {
      showNotification('Error loading dissolved BOMs', 'error')
    }
  }

  const loadDissolvedBOM = async (id) => {
    setLoading(true)
    try {
      const response = await bomService.getDissolvedBOM(id)
      if (response.data.success) {
        setDissolvedData(response.data.dissolved_bom)
        setSelectedDissolvedId(id)
        setSelectedPartKeys(new Set())
      }
    } catch (error) {
      showNotification('Error loading dissolved BOM', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleUnloadDissolvedBOM = () => {
    setDissolvedData(null)
    setSelectedDissolvedId(null)
    setSelectedPartKeys(new Set())
  }

  const handleOpenCreateModal = async () => {
    try {
      const [bomsRes, badgesRes] = await Promise.all([
        bomService.getBOMs(),
        adminService.getBadges()
      ])
      setAvailableBOMs(bomsRes.data.boms || bomsRes.data || [])
      if (Array.isArray(badgesRes.data)) {
        setProjectBadges(badgesRes.data)
      }
      setCreateName('')
      setCreateMode('full')
      setSelectedBOMIds(new Set())
      setBomSearchTerm('')
      setCreateBadgeFilter(null)
      setShowCreateModal(true)
    } catch (error) {
      showNotification('Error loading BOMs', 'error')
    }
  }

  const handleCreate = async () => {
    if (!createName.trim() || selectedBOMIds.size === 0) {
      showNotification('Please provide a name and select at least one BOM', 'warning')
      return
    }
    setCreating(true)
    try {
      const response = await bomService.createDissolvedBOM({
        name: createName,
        bom_ids: Array.from(selectedBOMIds),
        dissolve_mode: createMode
      })
      if (response.data.success) {
        showNotification('Dissolved BOM created successfully', 'success')
        setShowCreateModal(false)
        await loadDissolvedBOMs()
        if (response.data.dissolved_bom?.id) {
          loadDissolvedBOM(response.data.dissolved_bom.id)
        }
      }
    } catch (error) {
      showNotification('Error creating dissolved BOM', 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id, e) => {
    e.stopPropagation()
    if (!window.confirm('Delete this dissolved BOM?')) return
    try {
      await bomService.deleteDissolvedBOM(id)
      showNotification('Deleted', 'success')
      if (selectedDissolvedId === id) {
        setSelectedDissolvedId(null)
        setDissolvedData(null)
      }
      loadDissolvedBOMs()
    } catch (error) {
      showNotification('Error deleting', 'error')
    }
  }

  const handleRefresh = async () => {
    if (!selectedDissolvedId) return
    setLoading(true)
    try {
      const response = await bomService.refreshDissolvedBOM(selectedDissolvedId)
      if (response.data.success) {
        showNotification('Refreshed successfully', 'success')
        loadDissolvedBOM(selectedDissolvedId)
      }
    } catch (error) {
      showNotification('Error refreshing', 'error')
    } finally {
      setLoading(false)
    }
  }

  // Transform dissolved BOM data for BOMTable compatibility
  const parts = dissolvedData?.parts || []

  const bomTableData = useMemo(() => {
    if (!dissolvedData || parts.length === 0) return null
    return {
      name: dissolvedData.name,
      items: parts.map((p, idx) => ({
        id: p.part_id || idx,
        part_id: p.part_id,
        bom_part_id: p.bom_part_id,
        part_number: p.part_number || '',
        part_name: p.part_name || '',
        description: p.description || '',
        revision: p.revision || '',
        material: p.material || '',
        finish1: p.finish1 || '',
        finish2: p.finish2 || '',
        qty: p.quantity || 0,
        vendor: p.vendor || '',
        manufacturer: p.manufacturer || '',
        manufacturer_pn: p.manufacturer_pn || '',
        unit_cost: p.unit_cost || 0,
        price_per_bom: p.price_per_bom || 0,
        order_qty: p.order_qty || '',
        po_orders: p.po_orders || '',
        part_type: p.part_type || '',
        state: p.state || '',
        inventory: p.inventory || 0,
        warehouse_box_number: p.warehouse_box_number || '',
        eco_number: p.eco_number || '',
        eco_description: p.eco_description || '',
        thumbnail: p.thumbnail || {},
        source_currency: p.source_currency || '',
        source_unit_cost: p.source_unit_cost || '',
        has_pdf: p.has_pdf || false,
        has_ai_pdf: p.has_ai_pdf || false,
        has_step: p.has_step || false,
        datasheet_drive_url: p.datasheet_drive_url || null,
      }))
    }
  }, [dissolvedData, parts])

  // Helper to get partKey matching BOMTable's selection format
  const getPartKey = (p) => `${p.part_number}_${p.revision || ''}`

  // Get the parts that are currently selected (matched by partNumber_revision key)
  const getSelectedParts = () => parts.filter(p => selectedPartKeys.has(getPartKey(p)))

  // Check if a part is mechanical (MP)
  const isMechanicalPart = (p) => {
    const ptype = (p.part_type || '').toLowerCase()
    return ptype === 'mechanical part' || ptype === 'mp' || ptype.includes('mechanic')
  }

  // ====== HELPER: Build tree structure from dissolved BOM flat parts ======
  const buildTreeFromDissolvedParts = (partsArr, bomName) => {
    const children = partsArr.map(p => ({
      name: p.part_number || '',
      file: p.part_name || p.description || '',
      description: p.description || '',
      qty: p.quantity || p.qty || 1,
      bom_columns: {
        'PART NUMBER': p.part_number || '',
        'Revision': p.revision || '01',
        'DESCRIPTION': p.description || '',
        'QTY.': p.quantity || p.qty || 1,
        'Type': p.part_type || '',
        'State': p.state || '',
        'Material': p.material || '',
        'FINISH1': p.finish1 || '',
        'FINISH2': p.finish2 || '',
        'PART NAME': p.part_name || p.description || p.part_number || '',
        'Vendor': p.vendor || '',
      },
      part_type: p.part_type || '',
      revision: p.revision || '01',
      state: p.state || '',
      children: []
    }))

    return {
      name: bomName,
      children
    }
  }

  // ====== MECHANICAL RFQ FLOW ======

  const handleMechanicalRFQ = async () => {
    if (!dissolvedData) {
      // No dissolved BOM loaded — show dissolved BOMs picker (we're in Limbs tab)
      setIsStandardRFQMultiBOM(false)
      setMultiBOMList(dissolvedBOMs)
      setMultiBOMSelectedIds(new Set())
      setMultiBOMSearch('')
      setMultiBOMBadgeFilter(null)
      setMultiBOMBadges([])
      setShowMultiBOMModal(true)
      return
    }

    // Dissolved BOM loaded — use the dissolved parts directly, filtered to mechanical parts only
    const baseParts = selectedPartKeys.size > 0 ? getSelectedParts() : parts
    const mechParts = baseParts.filter(isMechanicalPart)

    if (mechParts.length === 0) {
      showNotification('No mechanical parts found in ' + (selectedPartKeys.size > 0 ? 'selection' : 'dissolved BOM'), 'warning')
      return
    }

    // Collect unique vendors from the mechanical parts
    const vendors = new Set()
    mechParts.forEach(p => {
      if (p.vendor) vendors.add(p.vendor)
    })

    // Show vendor filter modal so user can choose which vendors to include
    setAvailableVendorsForRFQ(Array.from(vendors).sort())
    setSelectedVendorsForRFQ(new Set()) // empty = all vendors (no filter)
    setPendingRFQParts(mechParts)
    setShowVendorFilterModal(true)
  }

  // Called after vendor filter selection (or skip)
  const handleProceedAfterVendorFilter = async () => {
    setShowVendorFilterModal(false)

    let partsToProcess = pendingRFQParts || []

    // Apply vendor filter if any vendors were selected
    if (selectedVendorsForRFQ.size > 0) {
      partsToProcess = partsToProcess.filter(p => selectedVendorsForRFQ.has(p.vendor || ''))
    }

    if (partsToProcess.length === 0) {
      showNotification('No parts match the selected vendor filter', 'warning')
      setPendingRFQParts(null)
      return
    }

    const bomName = dissolvedData?.name || 'Limbs BOM RFQ'
    const treeData = buildTreeFromDissolvedParts(partsToProcess, bomName)
    await processMechanicalRFQ(treeData, bomName)
    setPendingRFQParts(null)
  }

  const processMechanicalRFQ = async (treeData, bomName, metadata = {}) => {
    setCreatingRFQ(true)
    try {
      const response = await rfqService.analyzeRFQFiles({
        bom_data: treeData,
        bom_name: bomName
      })

      if (response.data.success) {
        const rfqStatusWithMetadata = {
          ...response.data,
          metadata: {
            ...response.data.metadata,
            ...metadata,
          }
        }
        setRfqFileStatus(rfqStatusWithMetadata)
        setRemovedRFQParts(new Set())
        setSelectedRFQParts(new Set())
        setShowRFQFileStatusModal(true)
      } else {
        showNotification(response.data.error || 'Error analyzing RFQ files', 'error')
      }
    } catch (error) {
      console.error('Error analyzing RFQ:', error)
      showNotification(error.response?.data?.error || 'Error analyzing RFQ files', 'error')
    } finally {
      setCreatingRFQ(false)
    }
  }

  // ====== STANDARD PARTS RFQ FLOW ======

  const handleStandardPartsRFQ = () => {
    if (!dissolvedData) {
      // No dissolved BOM loaded — show dissolved BOMs picker with standard flag
      setIsStandardRFQMultiBOM(true)
      setMultiBOMList(dissolvedBOMs)
      setMultiBOMSelectedIds(new Set())
      setMultiBOMSearch('')
      setMultiBOMBadgeFilter(null)
      setMultiBOMBadges([])
      setShowMultiBOMModal(true)
      return
    }

    // Dissolved BOM loaded — extract types from parts
    const partsToUse = selectedPartKeys.size > 0 ? getSelectedParts() : parts
    const types = new Set()
    partsToUse.forEach(p => {
      const ptype = p.part_type || 'Unknown'
      if (ptype && ptype !== 'Assembly') {
        types.add(ptype)
      }
    })

    if (types.size === 0) {
      showNotification('No standard parts found', 'warning')
      return
    }

    setAvailablePartTypes(Array.from(types).sort())
    setSelectedPartTypes([])
    setShowStandardPartsTypeModal(true)
  }

  // ====== MULTI-BOM FLOW ======

  const handleProcessMultiBOMRFQ = async () => {
    if (multiBOMSelectedIds.size === 0) {
      showNotification('Please select at least one BOM', 'warning')
      return
    }

    const isStandardRFQ = isStandardRFQMultiBOM
    setIsStandardRFQMultiBOM(false)

    setShowMultiBOMModal(false)
    setCreatingRFQ(true)

    try {
      const bomDataList = []
      const bomNames = []
      const bomIds = Array.from(multiBOMSelectedIds)

      for (const bomId of bomIds) {
        const bom = multiBOMList.find(b => b.id === bomId)
        if (!bom) continue

        // Load dissolved BOM to get its parts
        const dissolvedRes = await bomService.getDissolvedBOM(bomId)
        if (dissolvedRes.data.success && dissolvedRes.data.dissolved_bom) {
          const dissolvedParts = dissolvedRes.data.dissolved_bom.parts || []
          const treeName = dissolvedRes.data.dissolved_bom.name || bom.name
          const treeData = buildTreeFromDissolvedParts(dissolvedParts, treeName)
          bomDataList.push(treeData)
          bomNames.push(treeName)
        }
      }

      if (bomDataList.length === 0) {
        throw new Error('No valid BOM data found')
      }

      const pendingData = {
        bomIds,
        bomDataList,
        bomNames,
        isStandardRFQ
      }
      setPendingBOMData(pendingData)

      // Reset multiplier state
      setMultiplierMode('general')
      setBomMultipliers({})
      setGlobalMultiplier(1)
      setCustomQuantities({})

      setCreatingRFQ(false)
      setShowQuantityModal(true)
    } catch (error) {
      console.error('Error creating multi-BOM RFQ:', error)
      showNotification(error.response?.data?.error || 'Error creating multi-BOM RFQ', 'error')
      setCreatingRFQ(false)
    }
  }

  // ====== CONSOLIDATE BOMs WITH MULTIPLIERS ======

  const consolidateBOMsWithMultipliers = (bomDataList, bomIds, bomMultipliersMap, mode, globalMult, customQuantitiesMap) => {
    const consolidatedParts = {}

    const getCustomQuantity = (partNumber, revision) => {
      const partKey = `${partNumber}_REV${revision}`
      return customQuantitiesMap[partKey] || 0
    }

    const processBOMTree = (node, bomId, parentQty = 1) => {
      const nodeQty = parseFloat(node.bom_columns?.['QTY.'] || node.qty || 1) || 1
      const effectiveQty = parentQty * nodeQty

      let multipliedQty = effectiveQty
      if (mode === 'per_bom' && bomMultipliersMap[bomId]) {
        multipliedQty = effectiveQty * bomMultipliersMap[bomId]
      }

      if (node.bom_columns && node.bom_columns['PART NUMBER']) {
        const partNumber = node.bom_columns['PART NUMBER']
        const revision = node.bom_columns['Revision'] || '01'
        const key = `${partNumber}_${revision}`

        const customQty = mode === 'per_bom' ? getCustomQuantity(partNumber, revision) : 0
        const finalQty = multipliedQty + customQty

        const fileName = node.file || node.bom_columns?.['PART NAME'] || ''
        const fileExt = fileName && fileName.includes('.') ? fileName.toLowerCase().split('.').pop() : ''

        if (!consolidatedParts[key]) {
          consolidatedParts[key] = {
            ...node.bom_columns,
            'QTY.': 0,
            _fileExt: fileExt
          }
          if (!consolidatedParts[key]['Type'] && node.part_type) {
            consolidatedParts[key]['Type'] = node.part_type
          }
        } else {
          const existingExt = consolidatedParts[key]._fileExt || ''
          const shouldPrefer = fileExt === 'sldprt' && existingExt === 'sldasm'

          if (shouldPrefer) {
            const existingQty = parseFloat(consolidatedParts[key]['QTY.']) || 0
            consolidatedParts[key] = {
              ...node.bom_columns,
              'QTY.': existingQty,
              _fileExt: fileExt
            }
            if (node.part_type) {
              consolidatedParts[key]['Type'] = node.part_type
            }
          } else {
            if (!consolidatedParts[key]['Type']) {
              const typeFromBomColumns = node.bom_columns['Type']
              const typeFromNode = node.part_type
              if (typeFromBomColumns) {
                consolidatedParts[key]['Type'] = typeFromBomColumns
              } else if (typeFromNode) {
                consolidatedParts[key]['Type'] = typeFromNode
              }
            }
          }
        }

        consolidatedParts[key]['QTY.'] = (parseFloat(consolidatedParts[key]['QTY.']) || 0) + finalQty

        if (consolidatedParts[key]['Unit Cost']) {
          const unitCost = parseFloat(consolidatedParts[key]['Unit Cost']) || 0
          consolidatedParts[key]['Price/BOM'] = unitCost * consolidatedParts[key]['QTY.']
        }
      }

      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(child => processBOMTree(child, bomId, effectiveQty))
      }
    }

    bomDataList.forEach((bom, index) => {
      const bomId = bomIds[index]
      processBOMTree(bom, bomId)
    })

    if (mode === 'general') {
      Object.keys(consolidatedParts).forEach(key => {
        const part = consolidatedParts[key]
        const originalQty = part['QTY.']
        const customQty = getCustomQuantity(part['PART NUMBER'], part['Revision'] || '01')
        part['QTY.'] = (originalQty * globalMult) + customQty

        if (part['Unit Cost']) {
          const unitCost = parseFloat(part['Unit Cost']) || 0
          part['Price/BOM'] = unitCost * part['QTY.']
        }
      })
    }

    const consolidatedChildren = Object.values(consolidatedParts).map(part => ({
      name: part['PART NUMBER'],
      file: part['PART NAME'] || '',
      description: part['DESCRIPTION'] || '',
      qty: part['QTY.'],
      bom_columns: part,
      children: [],
      part_type: part['Type'] || '',
      state: part['State'] || '',
      revision: part['Revision'] || '01'
    }))

    return {
      name: `Multi-BOM RFQ`,
      children: consolidatedChildren,
      metadata: {
        view_type: 'tree',
        total_items: consolidatedChildren.length,
        is_multi_bom: true
      }
    }
  }

  const processMultiBOMAfterMultiplier = async (pendingData, mode, bomMultipliersMap, globalMult, customQtyMap) => {
    if (!pendingData) return

    setCreatingRFQ(true)
    try {
      const { bomIds, bomDataList, bomNames, isStandardRFQ } = pendingData

      const consolidatedData = consolidateBOMsWithMultipliers(
        bomDataList,
        bomIds,
        bomMultipliersMap,
        mode,
        globalMult,
        customQtyMap
      )

      const response = await rfqService.analyzeRFQFiles({
        bom_data: consolidatedData,
        bom_name: `Multi-BOM RFQ`
      })

      if (response.data.success) {
        if (isStandardRFQ) {
          // Standard RFQ: extract types from consolidated data
          window.standardRFQConsolidatedData = consolidatedData
          window.standardRFQSelectedBOMIds = bomIds

          const partTypes = new Set()
          consolidatedData.children.forEach(part => {
            const partType = part.part_type || part.bom_columns?.['Type'] || 'Unknown'
            if (partType && partType !== 'Assembly') {
              partTypes.add(partType)
            }
          })
          setAvailablePartTypes(Array.from(partTypes).sort())
          setSelectedPartTypes([])
          setShowStandardPartsTypeModal(true)
          setMultiBOMSelectedIds(new Set())
        } else {
          // Mechanical RFQ: show file status modal
          const rfqStatusWithMetadata = {
            ...response.data,
            metadata: {
              ...response.data.metadata,
              is_multi_bom: true,
              selected_bom_ids: bomIds,
              multiplier_mode: mode,
              bom_multipliers: bomMultipliersMap,
              global_multiplier: globalMult,
              custom_quantities: customQtyMap,
              consolidated_data: consolidatedData
            }
          }
          setRfqFileStatus(rfqStatusWithMetadata)
          setRemovedRFQParts(new Set())
          setSelectedRFQParts(new Set())
          setShowRFQFileStatusModal(true)
          setMultiBOMSelectedIds(new Set())
          setPendingBOMData(null)
        }
      } else {
        showNotification(response.data.error || 'Error analyzing RFQ files', 'error')
      }
    } catch (error) {
      console.error('Error processing multi-BOM RFQ:', error)
      showNotification(error.response?.data?.error || 'Error processing multi-BOM RFQ', 'error')
    } finally {
      setCreatingRFQ(false)
    }
  }

  // ====== RFQ FILE STATUS HANDLERS ======

  const handleRemovePartFromRFQ = (partKey, partNumber, revision) => {
    const newRemoved = new Set(removedRFQParts)
    newRemoved.add(partKey)
    setRemovedRFQParts(newRemoved)

    // Also remove from selected if present
    const newSelected = new Set(selectedRFQParts)
    newSelected.delete(partKey)
    setSelectedRFQParts(newSelected)

    // Recalculate counts
    if (rfqFileStatus) {
      const remainingParts = rfqFileStatus.file_status.filter(p => {
        const pk = `${p.part_number}_REV${p.revision}`
        return !newRemoved.has(pk)
      })
      const completeCount = remainingParts.filter(p => p.overall_status === 'Complete').length
      const totalCount = remainingParts.length
      setRfqFileStatus(prev => ({
        ...prev,
        complete_count: completeCount,
        all_complete: completeCount === totalCount,
        analysis: {
          ...prev.analysis,
          manufacturing_parts_count: totalCount
        }
      }))
    }

    showNotification(`Removed ${partNumber} REV${revision} from RFQ`, 'info')
  }

  const handleToggleRFQPart = (partKey) => {
    const newSelected = new Set(selectedRFQParts)
    if (newSelected.has(partKey)) {
      newSelected.delete(partKey)
    } else {
      newSelected.add(partKey)
    }
    setSelectedRFQParts(newSelected)
  }

  const handleSelectAllRFQParts = () => {
    if (!rfqFileStatus?.file_status) return
    const allParts = new Set()
    rfqFileStatus.file_status.forEach(part => {
      const partKey = `${part.part_number}_REV${part.revision}`
      if (!removedRFQParts.has(partKey)) {
        allParts.add(partKey)
      }
    })
    setSelectedRFQParts(allParts)
  }

  const handleSelectCompletePartsOnly = () => {
    if (!rfqFileStatus?.file_status) return
    const completeParts = new Set()
    rfqFileStatus.file_status.forEach(part => {
      const partKey = `${part.part_number}_REV${part.revision}`
      if (!removedRFQParts.has(partKey) && part.overall_status === 'Complete') {
        completeParts.add(partKey)
      }
    })
    setSelectedRFQParts(completeParts)
  }

  const handleDeselectAllRFQParts = () => {
    setSelectedRFQParts(new Set())
  }

  const hasSelectedCompleteParts = () => {
    if (!rfqFileStatus?.file_status || selectedRFQParts.size === 0) return false
    return Array.from(selectedRFQParts).some(partKey => {
      const part = rfqFileStatus.file_status.find(p => {
        const key = `${p.part_number}_REV${p.revision}`
        return key === partKey
      })
      return part && part.overall_status === 'Complete'
    })
  }

  const handleGetLatestFiles = async () => {
    if (!rfqFileStatus) return

    setCreatingRFQ(true)
    try {
      const missingFiles = []

      if (rfqFileStatus.file_status) {
        rfqFileStatus.file_status.forEach(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          if (removedRFQParts.has(partKey)) return

          if (part.x_t_status === 'Missing' || part.pdf_status === 'Missing' || part.overall_status !== 'Complete') {
            missingFiles.push({
              part: `${part.part_number} REV${part.revision}`,
              part_number: part.part_number,
              revision: part.revision
            })
          }
        })
      }

      if (missingFiles.length === 0) {
        showNotification('No missing files found', 'info')
        setCreatingRFQ(false)
        return
      }

      const response = await rfqService.getLatestRFQFiles({
        missing_files: missingFiles
      })

      if (response.data.success) {
        const retrievedCount = response.data.retrieved?.length || 0
        const failedCount = response.data.failed?.length || 0

        if (retrievedCount === 0 && failedCount === 0) {
          showNotification('No files were retrieved from PDM', 'warning')
        } else {
          let message = `Retrieved ${retrievedCount} file(s) from PDM`
          if (failedCount > 0) {
            message += `, ${failedCount} failed`
          }
          showNotification(message, retrievedCount > 0 ? 'success' : 'warning')
        }

        // Auto refresh status after getting latest files
        setTimeout(() => {
          handleRefreshRFQStatus()
        }, 1000)
      } else {
        showNotification(response.data.error || 'Error getting latest files', 'error')
      }
    } catch (error) {
      console.error('Error getting latest files:', error)
      showNotification(error.response?.data?.error || 'Error getting latest files', 'error')
    } finally {
      setCreatingRFQ(false)
    }
  }

  const handleRefreshRFQStatus = async () => {
    if (!rfqFileStatus) return

    setRefreshingRFQStatus(true)
    try {
      const isMultiBOM = rfqFileStatus.metadata?.is_multi_bom
      const bomIdsToUse = rfqFileStatus.metadata?.selected_bom_ids
        ? new Set(rfqFileStatus.metadata.selected_bom_ids)
        : new Set()

      let response

      if (isMultiBOM && bomIdsToUse.size > 0) {
        // Multi-BOM refresh: re-consolidate and analyze.
        // These ids are DISSOLVED BOM ids (see handleProcessMultiBOMRFQ) — they
        // must be fetched via getDissolvedBOM, not the regular BOM endpoint.
        const bomDataList = []
        for (const bomId of bomIdsToUse) {
          const dissolvedRes = await bomService.getDissolvedBOM(bomId)
          if (dissolvedRes.data.success && dissolvedRes.data.dissolved_bom) {
            const dissolvedParts = dissolvedRes.data.dissolved_bom.parts || []
            const treeName = dissolvedRes.data.dissolved_bom.name || `BOM_${bomId}`
            bomDataList.push(buildTreeFromDissolvedParts(dissolvedParts, treeName))
          }
        }

        if (bomDataList.length > 0) {
          const consolidatedData = consolidateBOMsWithMultipliers(
            bomDataList,
            Array.from(bomIdsToUse),
            rfqFileStatus.metadata?.bom_multipliers || {},
            rfqFileStatus.metadata?.multiplier_mode || 'general',
            rfqFileStatus.metadata?.global_multiplier || 1,
            rfqFileStatus.metadata?.custom_quantities || {}
          )
          response = await rfqService.analyzeRFQFiles({
            bom_data: consolidatedData,
            bom_name: 'Multi-BOM RFQ'
          })
        }
      } else if (dissolvedData && parts.length > 0) {
        // Single dissolved BOM: rebuild tree from dissolved parts and re-analyze
        const treeData = buildTreeFromDissolvedParts(parts, dissolvedData.name)
        response = await rfqService.analyzeRFQFiles({
          bom_data: treeData,
          bom_name: dissolvedData.name
        })
      }

      if (response?.data?.success) {
        const updatedStatus = {
          ...response.data,
          metadata: rfqFileStatus.metadata
        }
        setRfqFileStatus(updatedStatus)
        showNotification('RFQ status refreshed', 'success')
      }
    } catch (error) {
      console.error('Error refreshing RFQ status:', error)
      showNotification('Error refreshing status', 'error')
    } finally {
      setRefreshingRFQStatus(false)
    }
  }

  // ====== QUANTITY / EXPORT FLOW ======

  const handleShowQuantityModal = () => {
    if (!rfqFileStatus && !pendingBOMData) {
      showNotification('No RFQ data available', 'error')
      return
    }

    // Always let the user choose the RFQ name before proceeding
    if (!customRFQName.trim()) {
      setShowRFQNameModal(true)
      return
    }

    setShowQuantityModal(true)
  }

  const handleExportRFQ = async () => {
    if (!rfqFileStatus) return

    const isMultiBOM = rfqFileStatus.metadata?.is_multi_bom || multiBOMSelectedIds.size > 0
    const bomIdsToUse = rfqFileStatus.metadata?.selected_bom_ids
      ? new Set(rfqFileStatus.metadata.selected_bom_ids)
      : multiBOMSelectedIds

    // Determine export name — user is always prompted, but fallback just in case
    let exportName = customRFQName.trim()

    if (!exportName) {
      setShowRFQNameModal(true)
      return
    }

    setCreatingRFQ(true)
    try {
      let bomDataToExport = null

      // If multi-BOM with consolidated data in metadata
      if (isMultiBOM && rfqFileStatus?.metadata?.consolidated_data) {
        bomDataToExport = {
          data: rfqFileStatus.metadata.consolidated_data
        }
      } else if (bomIdsToUse.size > 0) {
        // Multi-BOM: fetch trees — these are DISSOLVED BOM ids, so use the
        // dissolved endpoint (the regular BOM endpoint is a different id space)
        const bomDataList = []
        for (const bomId of bomIdsToUse) {
          const dissolvedRes = await bomService.getDissolvedBOM(bomId)
          if (dissolvedRes.data.success && dissolvedRes.data.dissolved_bom) {
            const dissolvedParts = dissolvedRes.data.dissolved_bom.parts || []
            const treeName = dissolvedRes.data.dissolved_bom.name || `BOM_${bomId}`
            bomDataList.push(buildTreeFromDissolvedParts(dissolvedParts, treeName))
          }
        }
        if (bomDataList.length > 0) {
          bomDataToExport = {
            data: {
              name: exportName,
              children: bomDataList,
              metadata: { is_multi_bom: true }
            }
          }
        }
      } else if (dissolvedData && parts.length > 0) {
        // Single dissolved BOM: will be rebuilt below after filtering
        bomDataToExport = null // placeholder — rebuilt after file status filtering
      } else {
        throw new Error('No BOM data available for export')
      }

      // Filter file_status
      let filteredFileStatus = rfqFileStatus.file_status || []

      filteredFileStatus = filteredFileStatus.filter(part => {
        const partKey = `${part.part_number}_REV${part.revision}`
        return !removedRFQParts.has(partKey)
      })

      if (selectedRFQParts.size > 0) {
        filteredFileStatus = filteredFileStatus.filter(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          return selectedRFQParts.has(partKey)
        })
      }

      // Validate completeness
      const incompleteParts = []
      filteredFileStatus.forEach(part => {
        if (part.overall_status !== 'Complete') {
          incompleteParts.push(part.part_number)
        }
      })

      if (incompleteParts.length > 0) {
        showNotification(`Cannot export: Parts ${incompleteParts.join(', ')} are not complete. Please remove them first.`, 'error')
        setCreatingRFQ(false)
        return
      }

      // For single dissolved BOM: rebuild tree from only the complete parts in filteredFileStatus
      // This ensures the backend only sees parts that passed the file status check
      if (!bomDataToExport && dissolvedData) {
        // Normalize both sides to `revision || '01'` — file_status revisions were
        // defaulted to '01' by buildTreeFromDissolvedParts, while getPartKey
        // defaults to '' (a mismatch silently dropped empty-revision parts)
        const completePartKeys = new Set(
          filteredFileStatus.map(p => `${p.part_number}_${p.revision || '01'}`)
        )
        const completeParts = parts.filter(p => completePartKeys.has(`${p.part_number}_${p.revision || '01'}`))
        bomDataToExport = buildTreeFromDissolvedParts(completeParts, exportName)
      }

      if (filteredFileStatus.length === 0) {
        showNotification('No parts available for export', 'warning')
        setCreatingRFQ(false)
        return
      }

      // Handle multi-BOM quantity updates
      const isMultiBOMWithMultipliers = isMultiBOM && rfqFileStatus.metadata?.multiplier_mode

      if (isMultiBOMWithMultipliers && bomDataToExport?.data) {
        const originalCustomQuantities = rfqFileStatus.metadata?.custom_quantities || {}
        const originalGlobalMultiplier = rfqFileStatus.metadata?.global_multiplier || 1
        const exportMultiplierMode = rfqFileStatus.metadata?.multiplier_mode || multiplierMode
        const consolidatedData = bomDataToExport.data

        const targetQuantitiesByPartKey = {}
        filteredFileStatus.forEach(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          const qtyFromSecondModal = parseFloat(part.qty) || 0
          const originalCustomQty = originalCustomQuantities[partKey] || 0
          let baseQty
          if (exportMultiplierMode === 'general' && originalGlobalMultiplier > 0) {
            baseQty = (qtyFromSecondModal - originalCustomQty) / originalGlobalMultiplier
          } else {
            baseQty = qtyFromSecondModal - originalCustomQty
          }
          const currentCustomQty = customQuantities[partKey] || 0
          const targetQty = Math.max(0, (baseQty * globalMultiplier) + currentCustomQty)
          targetQuantitiesByPartKey[partKey] = targetQty
        })

        if (Object.keys(targetQuantitiesByPartKey).length > 0) {
          const updateConsolidatedQuantities = (node) => {
            if (!node || typeof node !== 'object') return
            const partNumber = node.bom_columns?.['PART NUMBER'] || node['PART NUMBER'] || node.name
            const revision = node.bom_columns?.['Revision'] || node.revision || '01'
            const partKey = `${partNumber}_REV${revision}`

            if (partNumber && targetQuantitiesByPartKey[partKey] !== undefined) {
              const targetQty = targetQuantitiesByPartKey[partKey]
              if (node.bom_columns) {
                node.bom_columns['QTY.'] = targetQty
              }
              node.qty = targetQty
              node['QTY.'] = targetQty
              if (node.bom_columns?.['Unit Cost']) {
                const unitCost = parseFloat(node.bom_columns['Unit Cost']) || 0
                node.bom_columns['Price/BOM'] = unitCost * targetQty
              }
            }

            if (node.children && Array.isArray(node.children)) {
              node.children.forEach(child => updateConsolidatedQuantities(child))
            }
            if (node.items && Array.isArray(node.items)) {
              node.items.forEach(item => updateConsolidatedQuantities(item))
            }
          }

          if (consolidatedData.children && Array.isArray(consolidatedData.children)) {
            consolidatedData.children.forEach(child => updateConsolidatedQuantities(child))
          } else {
            updateConsolidatedQuantities(consolidatedData)
          }
        }
      }

      // Custom quantities for single BOM
      const customQuantitiesToSend = {}
      if (!isMultiBOMWithMultipliers) {
        filteredFileStatus.forEach(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          if (customQuantities[partKey] !== undefined && customQuantities[partKey] !== 0) {
            customQuantitiesToSend[part.part_number] = customQuantities[partKey]
          }
        })
      }

      let exportQuantityMultiplier = 1
      if (!isMultiBOMWithMultipliers) {
        exportQuantityMultiplier = globalMultiplier
      }

      const exportData = {
        bom_data: bomDataToExport,
        bom_name: exportName,
        bom_id: null,
        bom_revision: null,
        quantity_multiplier: exportQuantityMultiplier,
        custom_quantities: customQuantitiesToSend,
        removed_parts: Array.from(removedRFQParts),
        selected_parts: selectedRFQParts.size > 0 ? Array.from(selectedRFQParts) : null
      }

      const response = await rfqService.exportRFQFiles(exportData)

      if (response.data.success) {
        showNotification('RFQ files exported successfully', 'success')
        setExportResult(response.data)
        setShowQuantityModal(false)
        setShowRFQFileStatusModal(false)
        setShowRFQNameModal(false)
        setShowExportSuccessModal(true)
        setCustomQuantities({})
        setCustomRFQName('')
        setGlobalMultiplier(1)
        setSelectedRFQParts(new Set())
        setMultiplierMode('general')
        setBomMultipliers({})
        setPendingBOMData(null)
      } else {
        showNotification(response.data.error || 'Error exporting RFQ files', 'error')
      }
    } catch (error) {
      console.error('Error exporting RFQ:', error)
      showNotification(error.response?.data?.error || 'Error exporting RFQ files', 'error')
    } finally {
      setCreatingRFQ(false)
    }
  }

  // ====== STANDARD PARTS HANDLERS ======

  const handleCreateStandardPartsRFQ = async () => {
    if (selectedPartTypes.length === 0) {
      showNotification('Please select at least one part type', 'warning')
      return
    }

    if (selectedPartTypes.length > 0 && !standardPartsRFQName) {
      setStandardPartsRFQName(selectedPartTypes[0])
    }

    const isMultiBOM = window.standardRFQConsolidatedData !== undefined
    const consolidatedData = window.standardRFQConsolidatedData

    let filteredParts = []

    try {
      if (isMultiBOM && consolidatedData) {
        const consolidatedPartsByType = {}

        const consolidateAndFilter = (node) => {
          const partType = node.part_type || node.bom_columns?.['Type'] || 'Unknown'
          if (selectedPartTypes.includes(partType) && partType !== 'Assembly') {
            const partNumber = node.name || node.bom_columns?.['PART NUMBER'] || ''
            const revision = node.revision || node.bom_columns?.['Revision'] || '01'
            const key = `${partNumber}_${revision}`

            if (!consolidatedPartsByType[key]) {
              consolidatedPartsByType[key] = {
                part_number: partNumber,
                revision: revision,
                qty: 0,
                description: node.description || node.bom_columns?.['DESCRIPTION'] || '',
                part_type: partType,
                thumbnail: node.thumbnail || null
              }
            }
            const qty = parseInt(node.qty || node.bom_columns?.['QTY.'] || 0) || 0
            consolidatedPartsByType[key].qty += qty
          }

          if (node.children && Array.isArray(node.children)) {
            node.children.forEach(child => consolidateAndFilter(child))
          }
        }

        consolidateAndFilter(consolidatedData)
        filteredParts = Object.values(consolidatedPartsByType)
      } else if (dissolvedData && parts.length > 0) {
        // Single dissolved BOM: filter parts by selected types
        const partsToUse = selectedPartKeys.size > 0 ? getSelectedParts() : parts
        partsToUse.forEach(item => {
          const partType = item.part_type || 'Unknown'
          if (selectedPartTypes.includes(partType)) {
            filteredParts.push({
              part_number: item.part_number || '',
              revision: item.revision || '',
              qty: parseInt(item.quantity || item.qty || 0),
              description: item.description || '',
              part_type: partType,
              thumbnail: item.thumbnail || null
            })
          }
        })
      } else {
        throw new Error('No BOM data available')
      }

      setStandardPartsQuantityList(filteredParts)
      setShowStandardPartsTypeModal(false)
      setShowStandardPartsQtyModal(true)
    } catch (error) {
      console.error('Error preparing Standard Parts RFQ:', error)
      showNotification(error.response?.data?.error || 'Error preparing RFQ', 'error')
      setCreatingRFQ(false)
    }
  }

  const handleConfirmStandardPartsQuantity = async () => {
    if (standardPartsQuantityList.length === 0) {
      showNotification('No parts selected for RFQ', 'warning')
      return
    }

    if (!standardPartsRFQName.trim()) {
      showNotification('Please enter an RFQ name', 'warning')
      return
    }

    const isMultiBOM = window.standardRFQConsolidatedData !== undefined
    const selectedBOMIdsForRFQ = window.standardRFQSelectedBOMIds || []

    setCreatingRFQ(true)
    try {
      let bomName = 'Standard Parts RFQ'
      if (isMultiBOM) {
        bomName = `Multi-BOM Standard Parts RFQ`
      } else if (dissolvedData) {
        bomName = dissolvedData.name || 'Limbs BOM Standard Parts RFQ'
      }

      // Group parts by type
      const partsByType = {}
      standardPartsQuantityList.forEach(part => {
        const partType = part.part_type || 'Unknown'
        if (!partsByType[partType]) {
          partsByType[partType] = []
        }
        partsByType[partType].push({
          ...part,
          qty: parseInt(part.qty) || 1
        })
      })

      const allResponses = []
      let hasDriveLink = false
      let driveFolderUrl = null

      for (const partType of selectedPartTypes) {
        const typeFilteredParts = partsByType[partType] || []
        if (typeFilteredParts.length === 0) continue

        let bomIdForRFQ = null
        let bomRevisionForRFQ = null

        if (isMultiBOM && selectedBOMIdsForRFQ.length > 0) {
          bomIdForRFQ = selectedBOMIdsForRFQ[0]
        }

        const rfqName = standardPartsRFQName || partType

        const response = await rfqService.exportStandardPartsRFQ({
          bom_name: bomName,
          bom_id: bomIdForRFQ,
          bom_revision: bomRevisionForRFQ,
          part_type: partType,
          filtered_parts: typeFilteredParts,
          is_multi_bom: isMultiBOM,
          selected_bom_ids: isMultiBOM ? selectedBOMIdsForRFQ : undefined,
          rfq_name: rfqName
        })

        if (!response.data.success) {
          throw new Error(response.data.error || `Error creating RFQ for ${partType}`)
        }

        allResponses.push(response.data)

        if (!hasDriveLink && response.data.google_drive?.folder_url) {
          hasDriveLink = true
          driveFolderUrl = response.data.google_drive.folder_url
        }
      }

      // Clear multi-BOM data
      window.standardRFQConsolidatedData = undefined
      window.standardRFQSelectedBOMIds = undefined

      showNotification(`Standard Parts RFQ created successfully for ${selectedPartTypes.length} part type(s)`, 'success')
      setShowStandardPartsQtyModal(false)
      setStandardPartsQuantityList([])
      setStandardPartsRFQName('')
      setSelectedPartTypes([])

      if (hasDriveLink && driveFolderUrl) {
        setExportResult({
          success: true,
          google_drive: {
            folder_url: driveFolderUrl
          },
          parts_count: standardPartsQuantityList.length,
          part_types: selectedPartTypes
        })
        setShowExportSuccessModal(true)
      }
    } catch (error) {
      console.error('Error creating Standard Parts RFQ:', error)
      showNotification(error.response?.data?.error || 'Error creating RFQ', 'error')
    } finally {
      setCreatingRFQ(false)
    }
  }

  const handleRemovePartFromStandardRFQ = (partIndex) => {
    const updatedList = standardPartsQuantityList.filter((_, index) => index !== partIndex)
    setStandardPartsQuantityList(updatedList)
  }

  // ====== EXPORT HANDLERS ======

  const handleExportToExcel = async () => {
    if (!dissolvedData) return
    const sourceIds = dissolvedData.source_bom_ids || []
    if (sourceIds.length === 0) {
      showNotification('No source BOMs to export', 'warning')
      return
    }
    setExporting(true)
    try {
      const dissolveFlag = dissolvedData.dissolve_mode === 'full'
      const response = await bomService.exportMultipleBOMsToExcel(sourceIds, dissolvedData.name, dissolveFlag)
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const safeName = (dissolvedData.name || 'dissolved_bom').replace(/[^A-Za-z0-9._-]+/g, '_')
      link.download = safeName.toLowerCase().endsWith('.xlsx') ? safeName : `${safeName}.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showNotification('Exported to Excel', 'success')
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error exporting to Excel', 'error')
    } finally {
      setExporting(false)
    }
  }

  const handleExportToSheets = async () => {
    if (!dissolvedData) return
    const sourceIds = dissolvedData.source_bom_ids || []
    if (sourceIds.length === 0) {
      showNotification('No source BOMs to export', 'warning')
      return
    }
    setExporting(true)
    try {
      const dissolveFlag = dissolvedData.dissolve_mode === 'full'
      const response = await bomService.exportMultipleBOMsToSheets(sourceIds, dissolvedData.name, dissolveFlag)
      if (response.data.success) {
        showNotification('Exported to Google Sheets', 'success')
        if (response.data.spreadsheet_url) {
          window.open(response.data.spreadsheet_url, '_blank', 'noopener,noreferrer')
        }
      } else {
        throw new Error(response.data.error || 'Export failed')
      }
    } catch (error) {
      showNotification(error.response?.data?.error || error.message || 'Error exporting to Sheets', 'error')
    } finally {
      setExporting(false)
    }
  }

  const canEdit = user?.role === 'admin' || user?.role === 'engineer'

  return (
    <Container maxWidth={false} sx={{ px: { xs: 1, sm: 1.5 }, py: 0.75 }}>
      <BOMsAndPartsTabBar />

      <Box sx={{ display: 'flex', gap: 1, height: 'calc(100vh - 129px)' }}>
        {/* Sidebar */}
        <ResizableSidebar defaultWidth={300} minWidth={220} maxWidth={500} storageKey="limbsBomSidebar">
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 1 }}>
            {/* Action Buttons */}
            {canEdit && (
              <Card sx={{ mb: 1 }}>
                <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                  {/* Export buttons */}
                  <Box sx={{ mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block', fontSize: '0.7rem' }}>
                      Export
                    </Typography>
                    <Grid container spacing={0.5}>
                      <Grid item xs={6}>
                        <Button
                          variant="contained"
                          color="success"
                          fullWidth
                          size="small"
                          startIcon={<TableIcon sx={{ fontSize: '0.875rem' }} />}
                          onClick={handleExportToSheets}
                          disabled={!dissolvedData || exporting}
                          sx={{ fontSize: '0.65rem', py: 0.75 }}
                        >
                          {exporting ? '...' : 'Export Sheets'}
                        </Button>
                      </Grid>
                      <Grid item xs={6}>
                        <Button
                          variant="contained"
                          color="info"
                          fullWidth
                          size="small"
                          startIcon={<DownloadIcon sx={{ fontSize: '0.875rem' }} />}
                          onClick={handleExportToExcel}
                          disabled={!dissolvedData || exporting}
                          sx={{ fontSize: '0.65rem', py: 0.75 }}
                        >
                          {exporting ? '...' : 'Export Excel'}
                        </Button>
                      </Grid>
                    </Grid>
                  </Box>

                  {/* RFQ buttons — always enabled */}
                  <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block', fontSize: '0.7rem' }}>
                    RFQ Actions
                  </Typography>
                  <Grid container spacing={0.5}>
                    <Grid item xs={6}>
                      <Button
                        variant="contained"
                        color="warning"
                        fullWidth
                        size="small"
                        startIcon={<InvoiceIcon sx={{ fontSize: '0.875rem' }} />}
                        onClick={handleMechanicalRFQ}
                        sx={{ fontSize: '0.65rem', py: 0.75 }}
                      >
                        Mechanical RFQ
                      </Button>
                    </Grid>
                    <Grid item xs={6}>
                      <Button
                        variant="contained"
                        color="secondary"
                        fullWidth
                        size="small"
                        startIcon={<DescriptionIcon sx={{ fontSize: '0.875rem' }} />}
                        onClick={handleStandardPartsRFQ}
                        sx={{ fontSize: '0.65rem', py: 0.75 }}
                      >
                        Standard RFQ
                      </Button>
                    </Grid>
                  </Grid>
                  {selectedPartKeys.size > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'center' }}>
                      {selectedPartKeys.size} part(s) selected
                    </Typography>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Dissolved BOMs List */}
            <Card sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <CardHeader
                title={<Typography variant="subtitle2">Dissolved BOMs</Typography>}
                action={
                  canEdit && (
                    <Tooltip title="New Dissolved BOM">
                      <IconButton size="small" onClick={handleOpenCreateModal}>
                        <AddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )
                }
                sx={{ py: 0.5, px: 1 }}
              />
              <CardContent sx={{ p: 0, flex: 1, minHeight: 0, overflow: 'auto', '&:last-child': { pb: 0 } }}>
                <List dense disablePadding>
                  {dissolvedBOMs.map(d => (
                    <ListItem
                      key={d.id}
                      disablePadding
                      secondaryAction={
                        canEdit && (
                          <IconButton edge="end" size="small" onClick={(e) => handleDelete(d.id, e)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )
                      }
                    >
                      <ListItemButton
                        selected={selectedDissolvedId === d.id}
                        onClick={() => loadDissolvedBOM(d.id)}
                        sx={{ py: 0.5 }}
                      >
                        <ListItemText
                          primary={d.name}
                          secondary={`${d.source_bom_count} BOM(s) · ${d.dissolve_mode}`}
                          primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                  {dissolvedBOMs.length === 0 && (
                    <Box sx={{ textAlign: 'center', py: 3 }}>
                      <Typography variant="body2" color="text.secondary">
                        No dissolved BOMs yet
                      </Typography>
                    </Box>
                  )}
                </List>
              </CardContent>
            </Card>
          </Box>
        </ResizableSidebar>

        {/* Main Content */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <CircularProgress />
            </Box>
          ) : dissolvedData ? (
            <>
              {/* Header with Unload (X) button */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="h6">{dissolvedData.name}</Typography>
                <Chip label={dissolvedData.dissolve_mode} size="small" variant="outlined" />
                <Chip label={`${dissolvedData.parts_count} parts`} size="small" />
                <Tooltip title="Refresh from source BOMs">
                  <IconButton size="small" onClick={handleRefresh}>
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Unload dissolved BOM">
                  <IconButton size="small" onClick={handleUnloadDissolvedBOM} sx={{ color: 'error.main' }}>
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {dissolvedData.source_boms?.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    Source: {dissolvedData.source_boms.map(b => b.name).join(', ')}
                  </Typography>
                )}
              </Box>

              {/* BOMTable */}
              <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                {bomTableData ? (
                  <BOMTable
                    data={bomTableData}
                    canEdit={false}
                    canEditInventory={false}
                    onRefresh={handleRefresh}
                    selectedParts={selectedPartKeys}
                    onSelectionChange={setSelectedPartKeys}
                  />
                ) : (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">No parts found</Typography>
                  </Box>
                )}
              </Box>
            </>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
              <Typography variant="body1" color="text.secondary">
                Select a dissolved BOM from the sidebar, or create a new one
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* ==================== MODALS ==================== */}

      {/* Create Dissolved BOM Modal */}
      <ResizableDialog
        id="createDissolvedBOM"
        open={showCreateModal}
        onClose={() => !creating && setShowCreateModal(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Create Dissolved BOM</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="e.g. Left Arm Full BOM"
            sx={{ mb: 2, mt: 1 }}
          />

          <FormControl sx={{ mb: 2 }}>
            <FormLabel>Dissolve Mode</FormLabel>
            <RadioGroup row value={createMode} onChange={(e) => setCreateMode(e.target.value)}>
              <FormControlLabel value="full" control={<Radio />} label="Full recursive (to leaf parts)" />
              <FormControlLabel value="one_level" control={<Radio />} label="One level (keep sub-assemblies)" />
            </RadioGroup>
          </FormControl>

          <Typography variant="subtitle2" gutterBottom>Select BOMs to dissolve:</Typography>

          {/* Badge filter chips */}
          {projectBadges.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              <Chip
                label="All"
                size="small"
                onClick={() => setCreateBadgeFilter(null)}
                sx={{
                  fontWeight: 600, fontSize: '0.7rem', height: 24,
                  bgcolor: !createBadgeFilter ? 'primary.main' : 'action.selected',
                  color: !createBadgeFilter ? 'white' : 'text.primary',
                  '&:hover': { bgcolor: !createBadgeFilter ? 'primary.dark' : 'action.hover' },
                }}
              />
              {projectBadges.map(badge => (
                <Chip
                  key={badge.id}
                  label={badge.name}
                  size="small"
                  onClick={() => setCreateBadgeFilter(badge.id)}
                  sx={{
                    fontWeight: 500, fontSize: '0.7rem', height: 24,
                    bgcolor: createBadgeFilter === badge.id ? (badge.color || '#6c757d') : 'action.selected',
                    color: createBadgeFilter === badge.id ? 'white' : 'text.primary',
                    '&:hover': {
                      bgcolor: createBadgeFilter === badge.id ? (badge.color || '#6c757d') : 'action.hover',
                      opacity: createBadgeFilter === badge.id ? 0.85 : 1,
                    },
                  }}
                />
              ))}
            </Box>
          )}

          <TextField
            fullWidth
            size="small"
            label="Search BOMs"
            value={bomSearchTerm}
            onChange={(e) => setBomSearchTerm(e.target.value)}
            sx={{ mb: 1 }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
            }}
          />
          <Paper sx={{ maxHeight: 300, overflow: 'auto' }}>
            {availableBOMs
              .filter(bom => {
                if (createBadgeFilter && bom.badge_id !== createBadgeFilter) return false
                if (!bomSearchTerm.trim()) return true
                const name = (bom.assembly_part_number || bom.name || '').toLowerCase()
                const desc = (bom.name || '').toLowerCase()
                return name.includes(bomSearchTerm.toLowerCase()) || desc.includes(bomSearchTerm.toLowerCase())
              })
              .map(bom => (
                <Box key={bom.id} sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
                  <Checkbox
                    size="small"
                    checked={selectedBOMIds.has(bom.id)}
                    onChange={() => {
                      const newSet = new Set(selectedBOMIds)
                      if (newSet.has(bom.id)) newSet.delete(bom.id)
                      else newSet.add(bom.id)
                      setSelectedBOMIds(newSet)
                    }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {bom.assembly_part_number || bom.name} {bom.assembly_revision ? `(${bom.assembly_revision})` : ''}
                    </Typography>
                    {bom.version && (
                      <Chip
                        label={bom.version}
                        size="small"
                        variant="outlined"
                        color="success"
                        sx={{
                          height: 18, fontSize: '0.65rem',
                          fontWeight: 500,
                        }}
                      />
                    )}
                    {bom.badge && (
                      <Chip
                        label={bom.badge.name}
                        size="small"
                        sx={{
                          height: 18, fontSize: '0.65rem',
                          bgcolor: bom.badge.color || '#6c757d',
                          color: 'white', fontWeight: 500,
                        }}
                      />
                    )}
                    {bom.name && bom.assembly_part_number && bom.name !== bom.assembly_part_number && (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {bom.name}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))
            }
          </Paper>
          {selectedBOMIds.size > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {selectedBOMIds.size} BOM(s) selected
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowCreateModal(false)} disabled={creating}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreate}
            disabled={creating || !createName.trim() || selectedBOMIds.size === 0}
            startIcon={creating ? <CircularProgress size={16} /> : <AddIcon />}
          >
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Multi-BOM Selection Modal */}
      <ResizableDialog
        id="limbsMultiBOMModal"
        open={showMultiBOMModal}
        onClose={() => setShowMultiBOMModal(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InvoiceIcon />
            Select Dissolved BOMs for {isStandardRFQMultiBOM ? 'Standard Parts' : 'Mechanical'} RFQ
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Select one or more dissolved BOMs to create a combined RFQ.
          </Alert>

          <TextField
            fullWidth
            size="small"
            label="Search Dissolved BOMs"
            value={multiBOMSearch}
            onChange={(e) => setMultiBOMSearch(e.target.value)}
            sx={{ mb: 1 }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
            }}
          />
          <Paper sx={{ maxHeight: '55vh', overflow: 'auto' }}>
            <List>
              {multiBOMList
                .filter(d => {
                  if (!multiBOMSearch.trim()) return true
                  return (d.name || '').toLowerCase().includes(multiBOMSearch.toLowerCase())
                })
                .map(d => {
                  const isSelected = multiBOMSelectedIds.has(d.id)
                  return (
                    <ListItem key={d.id} disablePadding>
                      <ListItemButton
                        onClick={() => {
                          const newSelected = new Set(multiBOMSelectedIds)
                          if (isSelected) {
                            newSelected.delete(d.id)
                          } else {
                            newSelected.add(d.id)
                          }
                          setMultiBOMSelectedIds(newSelected)
                        }}
                      >
                        <Checkbox checked={isSelected} />
                        <ListItemText
                          primary={d.name}
                          secondary={`${d.source_bom_count || '?'} BOM(s) · ${d.dissolve_mode || 'full'}`}
                        />
                      </ListItemButton>
                    </ListItem>
                  )
                })}
            </List>
          </Paper>
          {multiBOMList.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
              No dissolved BOMs available. Create one first.
            </Typography>
          )}
          {multiBOMSelectedIds.size > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              {multiBOMSelectedIds.size} dissolved BOM(s) selected
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowMultiBOMModal(false)
            setMultiBOMSelectedIds(new Set())
          }}>
            Cancel
          </Button>
          <Button
            onClick={handleProcessMultiBOMRFQ}
            variant="contained"
            disabled={multiBOMSelectedIds.size === 0 || creatingRFQ}
            startIcon={creatingRFQ ? <CircularProgress size={16} /> : null}
          >
            {creatingRFQ ? 'Processing...' : 'Continue'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Vendor Filter Modal — shown before mechanical RFQ when dissolved BOM is loaded */}
      <ResizableDialog
        id="limbsVendorFilter"
        open={showVendorFilterModal}
        onClose={() => {
          setShowVendorFilterModal(false)
          setPendingRFQParts(null)
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InvoiceIcon />
            Filter by Vendor (Optional)
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Optionally select vendors to filter the parts. Leave all unchecked to include all parts ({pendingRFQParts?.length || 0} total).
          </Alert>
          {availableVendorsForRFQ.length > 0 ? (
            <Box>
              <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSelectedVendorsForRFQ(new Set(availableVendorsForRFQ))}
                >
                  Select All
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSelectedVendorsForRFQ(new Set())}
                >
                  Clear All
                </Button>
              </Box>
              <Paper sx={{ p: 2, maxHeight: '40vh', overflow: 'auto' }}>
                {availableVendorsForRFQ.map(vendor => (
                  <FormControlLabel
                    key={vendor}
                    control={
                      <Checkbox
                        checked={selectedVendorsForRFQ.has(vendor)}
                        onChange={(e) => {
                          const newSet = new Set(selectedVendorsForRFQ)
                          if (e.target.checked) {
                            newSet.add(vendor)
                          } else {
                            newSet.delete(vendor)
                          }
                          setSelectedVendorsForRFQ(newSet)
                        }}
                      />
                    }
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <span>{vendor}</span>
                        <Chip
                          label={pendingRFQParts?.filter(p => (p.vendor || '') === vendor).length || 0}
                          size="small"
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      </Box>
                    }
                    sx={{ display: 'block', mb: 0.5 }}
                  />
                ))}
                {/* Show parts without vendor */}
                {pendingRFQParts?.some(p => !p.vendor) && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={selectedVendorsForRFQ.has('')}
                        onChange={(e) => {
                          const newSet = new Set(selectedVendorsForRFQ)
                          if (e.target.checked) {
                            newSet.add('')
                          } else {
                            newSet.delete('')
                          }
                          setSelectedVendorsForRFQ(newSet)
                        }}
                      />
                    }
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <span style={{ fontStyle: 'italic', color: '#999' }}>(No Vendor)</span>
                        <Chip
                          label={pendingRFQParts?.filter(p => !p.vendor).length || 0}
                          size="small"
                          variant="outlined"
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      </Box>
                    }
                    sx={{ display: 'block', mb: 0.5 }}
                  />
                )}
              </Paper>
              {selectedVendorsForRFQ.size > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {selectedVendorsForRFQ.size} vendor(s) selected — {pendingRFQParts?.filter(p => selectedVendorsForRFQ.has(p.vendor || '')).length || 0} parts
                </Typography>
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No vendor information available. All parts will be included.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowVendorFilterModal(false)
            setPendingRFQParts(null)
          }}>
            Cancel
          </Button>
          <Button
            onClick={handleProceedAfterVendorFilter}
            variant="contained"
            color="warning"
            startIcon={<InvoiceIcon />}
          >
            {selectedVendorsForRFQ.size > 0
              ? `Continue with ${pendingRFQParts?.filter(p => selectedVendorsForRFQ.has(p.vendor || '')).length || 0} parts`
              : `Continue with All ${pendingRFQParts?.length || 0} parts`
            }
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* RFQ File Status Modal */}
      <ResizableDialog
        id="limbsRfqFileStatus"
        open={showRFQFileStatusModal}
        onClose={() => {
          if (!creatingRFQ && !refreshingRFQStatus) {
            setShowRFQFileStatusModal(false)
          }
        }}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: rfqFileStatus?.all_files_complete ? 'success.main' : 'warning.main', color: 'white' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InvoiceIcon />
            Mechanical RFQ/PO - File Status
          </Box>
        </DialogTitle>
        <DialogContent sx={{ mt: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {rfqFileStatus && (
            <>
              <Grid container spacing={2} sx={{ mb: 3, flexShrink: 0 }}>
                <Grid item xs={12} sm={3}>
                  <Typography variant="body2"><strong>Total Parts:</strong> {rfqFileStatus.analysis?.manufacturing_parts_count || 0}</Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="body2"><strong>Files Complete:</strong> {rfqFileStatus.complete_count || 0} / {rfqFileStatus.analysis?.manufacturing_parts_count || 0}</Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="body2">
                    <strong>Released:</strong>{' '}
                    <Chip
                      label={`${(rfqFileStatus.analysis?.manufacturing_parts_count || 0) - (rfqFileStatus.not_released_count || 0)} / ${rfqFileStatus.analysis?.manufacturing_parts_count || 0}`}
                      color={rfqFileStatus.all_parts_released ? 'success' : 'warning'}
                      size="small"
                    />
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="body2">
                    <strong>Status:</strong>{' '}
                    <Chip
                      label={rfqFileStatus.all_complete ? 'Ready to Export' : rfqFileStatus.not_released_count > 0 ? 'Not Released' : 'Files Missing'}
                      color={rfqFileStatus.all_complete ? 'success' : rfqFileStatus.not_released_count > 0 ? 'warning' : 'error'}
                      size="small"
                    />
                  </Typography>
                </Grid>
              </Grid>

              {rfqFileStatus.not_released_count > 0 && (
                <Alert severity="warning" sx={{ mb: 2, flexShrink: 0 }}>
                  <strong>Warning:</strong> {rfqFileStatus.not_released_count} part(s) are not in "Released" state.
                  Please verify these parts are ready for manufacturing before proceeding.
                </Alert>
              )}

              {rfqFileStatus.files_missing_count > 0 && (
                <Alert severity="error" sx={{ mb: 2, flexShrink: 0 }}>
                  <strong>Files Missing:</strong> {rfqFileStatus.files_missing_count} part(s) are missing required files (.x_t and/or .pdf).
                </Alert>
              )}

              {removedRFQParts.size > 0 && (
                <Alert severity="info" sx={{ mb: 2, flexShrink: 0 }}>
                  <strong>Removed Parts:</strong> {removedRFQParts.size} part(s) have been removed from the RFQ. They will not be included in the export.
                </Alert>
              )}

              <Paper sx={{ flex: 1, minHeight: 200, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: tc.tableHeaderBg, zIndex: 10 }}>
                    <tr>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Part Number</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Revision</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>State</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Qty</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>.x_t Status</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>.pdf Status</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Overall Status</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfqFileStatus.file_status?.map((part) => {
                      const partKey = `${part.part_number}_REV${part.revision}`
                      const isRemoved = removedRFQParts.has(partKey)
                      if (isRemoved) return null

                      const statusColor = part.overall_status === 'Complete' ? 'success' :
                        part.overall_status === 'Incomplete - Not Released' ? 'warning' : 'error'
                      const stateColor = part.state === 'Released' ? 'success' :
                        part.state === 'Editing' ? 'warning' : 'default'
                      const hasThumbnailImg = hasThumbnail(part.thumbnail)

                      const originalQty = parseFloat(part.qty) || 0
                      const exportGlobalMultiplier = rfqFileStatus?.metadata?.global_multiplier || globalMultiplier
                      const metadataCustomQtys = rfqFileStatus?.metadata?.custom_quantities
                      const exportCustomQuantities = (metadataCustomQtys && Object.keys(metadataCustomQtys).length > 0)
                        ? metadataCustomQtys
                        : customQuantities
                      const customQty = exportCustomQuantities[partKey] || 0

                      const mMode = rfqFileStatus?.metadata?.multiplier_mode
                      const isMultiBOM = rfqFileStatus?.metadata?.is_multi_bom
                      const multiplierAlreadyApplied = isMultiBOM && mMode === 'general' && rfqFileStatus?.metadata?.global_multiplier

                      const totalQty = multiplierAlreadyApplied
                        ? originalQty + customQty
                        : (originalQty * exportGlobalMultiplier) + customQty

                      return (
                        <tr key={partKey} style={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
                          <td style={{ padding: '8px' }}>
                            <Tooltip
                              title={
                                hasThumbnailImg ? (
                                  <img
                                    src={getThumbnailSrc(part.thumbnail)}
                                    alt={`${part.part_number} thumbnail`}
                                    style={{ maxWidth: '200px', maxHeight: '200px', display: 'block' }}
                                  />
                                ) : (
                                  part.part_number
                                )
                              }
                              arrow
                              placement="right"
                            >
                              <span style={{ cursor: hasThumbnailImg ? 'pointer' : 'default' }}>
                                {part.part_number}
                              </span>
                            </Tooltip>
                          </td>
                          <td style={{ padding: '8px' }}>REV{part.revision}</td>
                          <td style={{ padding: '8px' }}>
                            <Chip label={part.state} color={stateColor} size="small" />
                          </td>
                          <td style={{ padding: '8px' }}>{totalQty}</td>
                          <td style={{ padding: '8px' }}>
                            <Chip
                              label={part.x_t_status}
                              color={part.x_t_status === 'Complete' ? 'success' : 'error'}
                              size="small"
                            />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <Chip
                              label={part.pdf_status}
                              color={part.pdf_status === 'Complete' ? 'success' : 'error'}
                              size="small"
                            />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <Chip
                              label={part.overall_status}
                              color={statusColor}
                              size="small"
                            />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => handleRemovePartFromRFQ(partKey, part.part_number, part.revision)}
                            >
                              <DeleteIcon fontSize="small" sx={{ mr: 0.5 }} />
                              Remove
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Paper>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          {!rfqFileStatus?.all_complete && (
            <Button
              onClick={handleGetLatestFiles}
              variant="contained"
              color="primary"
              disabled={creatingRFQ || refreshingRFQStatus}
              startIcon={creatingRFQ ? <CircularProgress size={16} /> : <DownloadIcon />}
            >
              Get Latest Version
            </Button>
          )}
          <Button
            onClick={handleShowQuantityModal}
            variant="contained"
            color="success"
            disabled={(!rfqFileStatus?.all_complete && !hasSelectedCompleteParts()) || creatingRFQ || refreshingRFQStatus}
            startIcon={<UploadIcon />}
          >
            Export RFQ Files
            {selectedRFQParts.size > 0 && ` (${selectedRFQParts.size} selected)`}
          </Button>
          <Button
            onClick={() => {
              setShowRFQFileStatusModal(false)
            }}
            disabled={creatingRFQ || refreshingRFQStatus}
          >
            Close
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Quantity Multiplication Modal */}
      <ResizableDialog
        id="limbsQuantityModal"
        open={showQuantityModal}
        onClose={() => !creatingRFQ && setShowQuantityModal(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'warning.main', color: 'white' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DescriptionIcon />
            Quantity Multiplication
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          {/* Multiplier Mode Selection - Only show for multi-BOM flow */}
          {pendingBOMData && (
            <Box sx={{ mb: 3 }}>
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ mb: 1, fontWeight: 600 }}>
                  Multiplication Mode
                </FormLabel>
                <RadioGroup
                  row
                  value={multiplierMode}
                  onChange={(e) => setMultiplierMode(e.target.value)}
                >
                  <FormControlLabel
                    value="general"
                    control={<Radio />}
                    label="General Multiplication (apply after consolidation)"
                  />
                  <FormControlLabel
                    value="per_bom"
                    control={<Radio />}
                    label="Per-BOM Multiplication (apply before consolidation)"
                  />
                </RadioGroup>
              </FormControl>
            </Box>
          )}

          {/* Multiplier Inputs */}
          {multiplierMode === 'per_bom' && pendingBOMData ? (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
                BOM Multipliers
              </Typography>
              <Paper sx={{ p: 2, maxHeight: '30vh', minHeight: 100, overflow: 'auto' }}>
                {pendingBOMData.bomIds.map((bomId, index) => {
                  const bom = multiBOMList.find(b => b.id === bomId)
                  return (
                    <Box key={bomId} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Typography variant="body2" sx={{ minWidth: 200 }}>
                        {bom?.name || pendingBOMData.bomNames?.[index] || `BOM ${bomId}`}
                      </Typography>
                      <TextField
                        size="small"
                        label="Multiplier"
                        type="number"
                        value={bomMultipliers[bomId] || 1}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value) || 1
                          setBomMultipliers({ ...bomMultipliers, [bomId]: value })
                        }}
                        inputProps={{ min: 1 }}
                        sx={{ width: 120 }}
                      />
                    </Box>
                  )
                })}
              </Paper>
            </Box>
          ) : pendingBOMData ? (
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Global Multiplier"
                  type="number"
                  value={globalMultiplier}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value) || 1
                    setGlobalMultiplier(value)
                  }}
                  inputProps={{ min: 1 }}
                  sx={{ mt: 1.25 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Multiply all quantities by this number
                </Typography>
              </Grid>
            </Grid>
          ) : null}

          {/* Global Multiplier for Single BOM */}
          {!pendingBOMData && rfqFileStatus && (
            <Box sx={{ mb: 3 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <TextField
                    fullWidth
                    label="Global Multiplier"
                    type="number"
                    value={globalMultiplier}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value) || 1
                      setGlobalMultiplier(value)
                    }}
                    inputProps={{ min: 1 }}
                    sx={{ mt: 1.25 }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    Multiply all quantities by this number
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Parts List with Custom Quantities */}
          {pendingBOMData ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              Custom quantities can be set after consolidation. Parts will be shown in the RFQ file status modal.
            </Alert>
          ) : (
            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                Parts with Custom Quantities
              </Typography>
              <Paper sx={{ maxHeight: '60vh', minHeight: 200, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ position: 'sticky', top: 0, backgroundColor: tc.tableHeaderBg, zIndex: 10 }}>
                    <tr>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Part Number</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Original QTY</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Multiplied QTY</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>+/- QTY</th>
                      <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontWeight: 600 }}>Total QTY (editable)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rfqFileStatus?.file_status?.map((part) => {
                      const partKey = `${part.part_number}_REV${part.revision}`
                      if (removedRFQParts.has(partKey)) return null

                      const mMode = rfqFileStatus?.metadata?.multiplier_mode
                      const isMultiBOM = rfqFileStatus?.metadata?.is_multi_bom
                      const multiplierAlreadyApplied = isMultiBOM && mMode === 'general' && rfqFileStatus?.metadata?.global_multiplier
                      const originalMultiplier = rfqFileStatus?.metadata?.global_multiplier || 1
                      const originalCustomQty = (rfqFileStatus?.metadata?.custom_quantities || {})[partKey] || 0

                      const qtyFromBackend = parseFloat(part.qty) || 0
                      const baseQty = multiplierAlreadyApplied && originalMultiplier > 0
                        ? (qtyFromBackend - originalCustomQty) / originalMultiplier
                        : qtyFromBackend

                      const originalQty = baseQty
                      const multipliedQty = originalQty * globalMultiplier
                      const customQtyAdd = customQuantities[partKey] || 0
                      const totalQty = multipliedQty + customQtyAdd

                      const hasThumbnailImg = hasThumbnail(part.thumbnail)

                      return (
                        <tr key={partKey} style={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
                          <td style={{ padding: '8px' }}>
                            <Tooltip
                              title={
                                hasThumbnailImg ? (
                                  <img
                                    src={getThumbnailSrc(part.thumbnail)}
                                    alt={`${part.part_number} thumbnail`}
                                    style={{ maxWidth: '200px', maxHeight: '200px', display: 'block' }}
                                  />
                                ) : (
                                  part.part_number
                                )
                              }
                              arrow
                              placement="right"
                            >
                              <span style={{ cursor: hasThumbnailImg ? 'pointer' : 'default' }}>
                                {part.part_number}
                              </span>
                            </Tooltip>
                          </td>
                          <td style={{ padding: '8px' }}>{originalQty}</td>
                          <td style={{ padding: '8px' }}>{multipliedQty}</td>
                          <td style={{ padding: '8px' }}>
                            <TextField
                              size="small"
                              type="number"
                              value={customQtyAdd || ''}
                              onChange={(e) => {
                                const value = parseFloat(e.target.value) || 0
                                const minAllowed = -multipliedQty
                                const clampedValue = Math.max(value, minAllowed)
                                setCustomQuantities({ ...customQuantities, [partKey]: clampedValue })
                              }}
                              placeholder="0"
                              inputProps={{ min: Math.floor(-multipliedQty), step: 1 }}
                              sx={{ width: 100 }}
                            />
                          </td>
                          <td style={{ padding: '8px' }}>
                            <TextField
                              size="small"
                              type="number"
                              value={totalQty}
                              onChange={(e) => {
                                const newTotal = parseFloat(e.target.value) || 0
                                if (newTotal >= 0) {
                                  const newCustom = newTotal - multipliedQty
                                  setCustomQuantities({ ...customQuantities, [partKey]: newCustom })
                                }
                              }}
                              inputProps={{ min: 0, step: 1 }}
                              sx={{ width: 100, fontWeight: 'bold' }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Paper>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowQuantityModal(false)
            setPendingBOMData(null)
          }} disabled={creatingRFQ}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (pendingBOMData) {
                // Multi-BOM flow: process with multipliers
                await processMultiBOMAfterMultiplier(
                  pendingBOMData,
                  multiplierMode,
                  bomMultipliers,
                  globalMultiplier,
                  customQuantities
                )
                setShowQuantityModal(false)
              } else {
                // Single BOM flow: check for incomplete parts and export
                const incompleteParts = []
                const remainingParts = rfqFileStatus?.file_status?.filter(part => {
                  const partKey = `${part.part_number}_REV${part.revision}`
                  return !removedRFQParts.has(partKey)
                }) || []

                remainingParts.forEach(part => {
                  const partKey = `${part.part_number}_REV${part.revision}`
                  const shouldCheck = selectedRFQParts.size === 0 || selectedRFQParts.has(partKey)
                  if (shouldCheck && part.overall_status !== 'Complete') {
                    incompleteParts.push(part.part_number)
                  }
                })

                if (incompleteParts.length > 0) {
                  showNotification(`Cannot export: Parts ${incompleteParts.join(', ')} are not complete. Please remove them first.`, 'error')
                  return
                }

                if (remainingParts.length === 0) {
                  showNotification('No parts available for export', 'warning')
                  return
                }

                // Name should already be set (always prompted), but double-check
                if (!customRFQName.trim()) {
                  setShowQuantityModal(false)
                  setShowRFQNameModal(true)
                  return
                }

                handleExportRFQ()
              }
            }}
            variant="contained"
            color="success"
            disabled={creatingRFQ}
            startIcon={creatingRFQ ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {pendingBOMData
              ? (creatingRFQ ? 'Processing...' : 'Continue to RFQ Analysis')
              : (creatingRFQ ? 'Exporting...' : 'Export RFQ Files')
            }
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* RFQ Name Modal */}
      <ResizableDialog id="limbsRfqNameModal" open={showRFQNameModal} onClose={() => !creatingRFQ && setShowRFQNameModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <InvoiceIcon />
            Enter RFQ Name
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Enter a custom name for this RFQ. This name will be used for the exported files.
          </Alert>
          <TextField
            fullWidth
            label="RFQ Name"
            value={customRFQName}
            onChange={(e) => setCustomRFQName(e.target.value)}
            placeholder="Enter custom RFQ name"
            disabled={creatingRFQ}
            autoFocus
            sx={{ mt: 1 }}
          />
          {selectedRFQParts.size > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              <strong>Note:</strong> Only {selectedRFQParts.size} selected part(s) will be included in this RFQ.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowRFQNameModal(false)
            setCustomRFQName('')
          }} disabled={creatingRFQ}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              if (!customRFQName.trim()) {
                showNotification('Please enter a custom RFQ name', 'warning')
                return
              }
              setShowRFQNameModal(false)
              if (rfqFileStatus) {
                await handleExportRFQ()
              } else {
                setShowQuantityModal(true)
              }
            }}
            variant="contained"
            disabled={creatingRFQ || !customRFQName.trim()}
            startIcon={creatingRFQ ? <CircularProgress size={16} /> : <UploadIcon />}
          >
            {rfqFileStatus ? (creatingRFQ ? 'Exporting...' : 'Export RFQ Files') : 'Continue'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Standard Parts Type Selection Modal */}
      <ResizableDialog id="limbsStandardPartsType" open={showStandardPartsTypeModal} onClose={() => !creatingRFQ && setShowStandardPartsTypeModal(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DescriptionIcon />
            Create Standard Parts RFQ/PO
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            Select one or more part types to create RFQs for standard parts. Each selected type will generate a separate RFQ.
          </Alert>
          {availablePartTypes.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No standard parts found in this BOM.
            </Typography>
          ) : (
            <Box>
              <Box sx={{ mb: 2, display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSelectedPartTypes([...availablePartTypes])}
                  disabled={creatingRFQ}
                >
                  Select All
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSelectedPartTypes([])}
                  disabled={creatingRFQ}
                >
                  Deselect All
                </Button>
              </Box>
              <Paper sx={{ p: 2, maxHeight: '40vh', minHeight: 150, overflow: 'auto' }}>
                {availablePartTypes.map((partType) => (
                  <FormControlLabel
                    key={partType}
                    control={
                      <Checkbox
                        checked={selectedPartTypes.includes(partType)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPartTypes([...selectedPartTypes, partType])
                          } else {
                            setSelectedPartTypes(selectedPartTypes.filter(t => t !== partType))
                          }
                        }}
                        disabled={creatingRFQ}
                      />
                    }
                    label={partType}
                  />
                ))}
              </Paper>
              {selectedPartTypes.length > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  {selectedPartTypes.length} part type(s) selected
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowStandardPartsTypeModal(false)
            setStandardPartsRFQName('')
          }} disabled={creatingRFQ}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateStandardPartsRFQ}
            variant="contained"
            color="secondary"
            disabled={creatingRFQ || selectedPartTypes.length === 0}
            startIcon={creatingRFQ ? <CircularProgress size={16} /> : <DescriptionIcon />}
          >
            {creatingRFQ ? 'Preparing...' : `Next (${selectedPartTypes.length})`}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Standard Parts RFQ Quantity Modal */}
      <ResizableDialog
        id="limbsStandardPartsQuantity"
        open={showStandardPartsQtyModal}
        onClose={() => !creatingRFQ && setShowStandardPartsQtyModal(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DescriptionIcon />
            Review Parts and Set RFQ Name
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 2, mt: 1.25 }}>
            <TextField
              fullWidth
              label="RFQ Name"
              value={standardPartsRFQName}
              onChange={(e) => setStandardPartsRFQName(e.target.value)}
              placeholder={selectedPartTypes.length > 0 ? selectedPartTypes[0] : 'Enter RFQ name'}
              disabled={creatingRFQ}
              sx={{ mb: 2 }}
            />
          </Box>
          <Alert severity="info" sx={{ mb: 2 }}>
            Review the parts list below. You can edit quantities and remove parts that should not be included in the RFQ.
          </Alert>
          {standardPartsQuantityList.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              No parts to display
            </Typography>
          ) : (
            <Paper sx={{ maxHeight: '60vh', minHeight: 200, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: tc.tableHeaderBg, position: 'sticky', top: 0 }}>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Part Number</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Revision</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Description</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Quantity</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Type</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {standardPartsQuantityList.map((part, index) => {
                    const hasThumbnailImg = hasThumbnail(part.thumbnail)
                    return (
                      <tr key={index} style={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
                        <td style={{ padding: '8px' }}>
                          <Tooltip
                            title={
                              hasThumbnailImg ? (
                                <img
                                  src={getThumbnailSrc(part.thumbnail)}
                                  alt={`${part.part_number} thumbnail`}
                                  style={{ maxWidth: '200px', maxHeight: '200px', display: 'block' }}
                                />
                              ) : (
                                part.part_number || 'N/A'
                              )
                            }
                            arrow
                            placement="right"
                          >
                            <span style={{ cursor: hasThumbnailImg ? 'pointer' : 'default' }}>
                              {part.part_number || 'N/A'}
                            </span>
                          </Tooltip>
                        </td>
                        <td style={{ padding: '8px' }}>{part.revision || 'N/A'}</td>
                        <td style={{ padding: '8px' }}>{part.description || 'N/A'}</td>
                        <td style={{ padding: '8px' }}>
                          <TextField
                            type="number"
                            size="small"
                            value={part.qty || 0}
                            onChange={(e) => {
                              const newList = [...standardPartsQuantityList]
                              newList[index].qty = parseInt(e.target.value) || 0
                              setStandardPartsQuantityList(newList)
                            }}
                            inputProps={{ min: 0, step: 1 }}
                            sx={{ width: 100 }}
                            disabled={creatingRFQ}
                          />
                        </td>
                        <td style={{ padding: '8px' }}>{part.part_type || 'Unknown'}</td>
                        <td style={{ padding: '8px' }}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemovePartFromStandardRFQ(index)}
                            disabled={creatingRFQ}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowStandardPartsQtyModal(false)
            setStandardPartsQuantityList([])
            setStandardPartsRFQName('')
          }} disabled={creatingRFQ}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmStandardPartsQuantity}
            variant="contained"
            color="secondary"
            disabled={creatingRFQ || standardPartsQuantityList.length === 0 || !standardPartsRFQName.trim()}
            startIcon={creatingRFQ ? <CircularProgress size={16} /> : <DescriptionIcon />}
          >
            {creatingRFQ ? 'Creating RFQ...' : 'Create RFQ'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Export Success Modal */}
      <ResizableDialog
        id="limbsExportSuccess"
        open={showExportSuccessModal}
        onClose={() => setShowExportSuccessModal(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'success.main', color: 'white' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleIcon />
            RFQ Export Successful
          </Box>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          <Alert severity="success" sx={{ mb: 2 }}>
            RFQ files have been exported successfully.
          </Alert>
          {exportResult?.google_drive?.folder_url && (
            <Button
              variant="contained"
              color="primary"
              fullWidth
              startIcon={<FolderOpenIcon />}
              onClick={() => window.open(exportResult.google_drive.folder_url, '_blank', 'noopener,noreferrer')}
              sx={{ mb: 1 }}
            >
              Open Google Drive Folder
            </Button>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowExportSuccessModal(false)} variant="contained">
            Close
          </Button>
        </DialogActions>
      </ResizableDialog>
    </Container>
  )
}

export default LimbsBOM
