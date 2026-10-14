import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import BOMsAndPartsTabBar from '../components/BOMsAndPartsTabBar'
import {
  Container,
  Grid,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Button,
  Box,
  CircularProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Chip,
  Paper,
  IconButton,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
  Checkbox,
  FormControlLabel,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Radio,
  RadioGroup,
  FormLabel,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material'
import {
  Storage as DatabaseIcon,
  TableChart as TableIcon,
  Download as DownloadIcon,
  Receipt as InvoiceIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Upload as UploadIcon,
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  FolderOpen as FolderOpenIcon,
  InsertDriveFile as FileIcon,
  Archive as ArchiveIcon,
  Link as LinkIcon,
  Info as InfoIcon,
  Search as SearchIcon,
  Description as DescriptionIcon,
  Sync as SyncIcon,
  WarningAmber as WarningAmberIcon,
} from '@mui/icons-material'
import { useTheme } from '@mui/material/styles'
import { getSemanticColors } from '../utils/themeColors'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import { bomService } from '../services/bomService'
import { pdmService } from '../services/pdmService'
import { rfqService } from '../services/rfqService'
import { formatPrice } from '../utils/priceFormatter'
import { adminService } from '../services/adminService'
import { bomCostService } from '../services/bomCostService'
import api from '../services/api'
import BOMTable from '../components/BOMTable'
import PDMImportModal from '../components/PDMImportModal'
import PartThumbnailHover from '../components/PartThumbnailHover'
import ResizableDialog from '../components/ResizableDialog'
import ResizableSidebar from '../components/ResizableSidebar'
import { hasThumbnail, getThumbnailSrc } from '../utils/thumbnail'

const AssemblyBOM = () => {
  const theme = useTheme()
  const tc = getSemanticColors(theme)
  const { user } = useAuth()
  const { showNotification, stalenessVersion, liveVersions } = useNotification()
  const [searchParams, setSearchParams] = useSearchParams()
  const [boms, setBoms] = useState([])
  const [selectedBOMId, setSelectedBOMId] = useState(null)
  const [bomData, setBomData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [editingBOMName, setEditingBOMName] = useState(null)
  const [editNameValue, setEditNameValue] = useState('')
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [revisions, setRevisions] = useState([])
  const [selectedRevision, setSelectedRevision] = useState(null)
  const [showUpdateModal, setShowUpdateModal] = useState(false)
  const [updatingBOM, setUpdatingBOM] = useState(null)
  const [updateConfiguration, setUpdateConfiguration] = useState('')
  const [updating, setUpdating] = useState(false)
  const [showMechanicalRFQModal, setShowMechanicalRFQModal] = useState(false)
  const [showStandardPartsRFQModal, setShowStandardPartsRFQModal] = useState(false)
  const [rfqCustomName, setRfqCustomName] = useState('')
  const [creatingRFQ, setCreatingRFQ] = useState(false)
  const [selectedPartTypes, setSelectedPartTypes] = useState([])
  const [availablePartTypes, setAvailablePartTypes] = useState([])
  const [showStandardPartsQuantityModal, setShowStandardPartsQuantityModal] = useState(false)
  const [standardPartsQuantityList, setStandardPartsQuantityList] = useState([])
  const [standardPartsRFQName, setStandardPartsRFQName] = useState('')
  // General RFQ state
  const [showGeneralRFQModal, setShowGeneralRFQModal] = useState(false)
  const [generalRFQStep, setGeneralRFQStep] = useState(0) // 0: Type selection, 1: Part selection, 2: BOM qty breakdown
  const [generalRFQTypes, setGeneralRFQTypes] = useState([])
  const [selectedGeneralRFQTypes, setSelectedGeneralRFQTypes] = useState([])
  const [generalRFQPartsList, setGeneralRFQPartsList] = useState([])
  const [filteredGeneralRFQParts, setFilteredGeneralRFQParts] = useState([])
  const [selectedGeneralRFQParts, setSelectedGeneralRFQParts] = useState(new Set())
  const [generalRFQSearchTerm, setGeneralRFQSearchTerm] = useState('')
  const [generalRFQName, setGeneralRFQName] = useState('')
  const [loadingGeneralRFQParts, setLoadingGeneralRFQParts] = useState(false)
  const [generalRFQVendorFilter, setGeneralRFQVendorFilter] = useState('')
  // General RFQ step 2 state (BOM qty breakdown)
  const [generalRFQBomList, setGeneralRFQBomList] = useState([]) // All available BOMs
  const [selectedGeneralRFQBoms, setSelectedGeneralRFQBoms] = useState(new Set())
  const [generalRFQBreakdown, setGeneralRFQBreakdown] = useState([]) // Parts with per-BOM qty
  const [generalRFQBomsUsed, setGeneralRFQBomsUsed] = useState([])
  const [generalRFQOrderQtys, setGeneralRFQOrderQtys] = useState({}) // part_id -> custom order qty
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)
  const [generalRFQBomSearchTerm, setGeneralRFQBomSearchTerm] = useState('')
  const [generalRFQBomBadgeFilter, setGeneralRFQBomBadgeFilter] = useState(null)
  // Sheet RFQ state
  const [showSheetRFQURLDialog, setShowSheetRFQURLDialog] = useState(false)
  const [sheetRFQUrl, setSheetRFQUrl] = useState('')
  const [parsingSheet, setParsingSheet] = useState(false)
  const [showSheetRFQReviewDialog, setShowSheetRFQReviewDialog] = useState(false)
  const [sheetRFQMatchedParts, setSheetRFQMatchedParts] = useState([])
  const [sheetRFQUnmatchedParts, setSheetRFQUnmatchedParts] = useState([])
  const [sheetRFQDetectedColumns, setSheetRFQDetectedColumns] = useState(null)
  const [currentVersion, setCurrentVersion] = useState(null)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [showVersionInfoModal, setShowVersionInfoModal] = useState(false)
  const [selectedVersionInfo, setSelectedVersionInfo] = useState(null)
  const [showECOModal, setShowECOModal] = useState(false)
  const [revisionChanges, setRevisionChanges] = useState([])
  const [ecoData, setEcoData] = useState({})
  const [submittingECO, setSubmittingECO] = useState(false)
  const [rfqFileStatus, setRfqFileStatus] = useState(null)
  const [showRFQFileStatusModal, setShowRFQFileStatusModal] = useState(false)
  const [removedRFQParts, setRemovedRFQParts] = useState(new Set())
  const [refreshingRFQStatus, setRefreshingRFQStatus] = useState(false)
  const [showQuantityModal, setShowQuantityModal] = useState(false)
  const [quantityMultipliers, setQuantityMultipliers] = useState({})
  const [customQuantities, setCustomQuantities] = useState({}) // Custom quantity additions per part
  const [globalMultiplier, setGlobalMultiplier] = useState(1)
  const [selectedRFQParts, setSelectedRFQParts] = useState(new Set())
  const [selectedBOMParts, setSelectedBOMParts] = useState(new Set()) // Parts selected from BOM table
  const [showMultiBOMModal, setShowMultiBOMModal] = useState(false)
  const [selectedBOMIds, setSelectedBOMIds] = useState(new Set())
  const [showRFQNameModal, setShowRFQNameModal] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportDialogType, setExportDialogType] = useState('excel') // 'excel' or 'sheets'
  const [exportSelectedBOMIds, setExportSelectedBOMIds] = useState(new Set())
  const [exportName, setExportName] = useState('')
  const [exporting, setExporting] = useState(false)
  const [dissolveAssemblies, setDissolveAssemblies] = useState(false)
  const [exportBomMultipliers, setExportBomMultipliers] = useState({})
  const [customRFQName, setCustomRFQName] = useState('')
  const [showExportSuccessModal, setShowExportSuccessModal] = useState(false)
  const [exportResult, setExportResult] = useState(null)
  const [selectedBadgeId, setSelectedBadgeId] = useState(null)
  const [projectBadges, setProjectBadges] = useState([])
  // Multiplier mode state
  const [multiplierMode, setMultiplierMode] = useState('general') // 'per_bom' | 'general'
  const [bomMultipliers, setBomMultipliers] = useState({}) // Map of BOM ID to multiplier
  const [pendingBOMData, setPendingBOMData] = useState(null) // Store BOM data before consolidation
  // Add Extra Parts to RFQ state
  const [showAddPartsToRFQModal, setShowAddPartsToRFQModal] = useState(false)
  const [addPartsRFQTypes, setAddPartsRFQTypes] = useState([])
  const [addPartsRFQSelectedTypes, setAddPartsRFQSelectedTypes] = useState([])
  const [addPartsRFQList, setAddPartsRFQList] = useState([])
  const [filteredAddPartsRFQList, setFilteredAddPartsRFQList] = useState([])
  const [selectedAddParts, setSelectedAddParts] = useState(new Set())
  const [addPartsRFQSearchTerm, setAddPartsRFQSearchTerm] = useState('')
  const [loadingAddPartsRFQ, setLoadingAddPartsRFQ] = useState(false)

  useEffect(() => {
    loadProjectBadges()
    loadBOMs()
    const bomId = searchParams.get('bom_id')
    if (bomId) {
      setSelectedBOMId(parseInt(bomId))
    }
  }, [])

  useEffect(() => {
    loadBOMs()
  }, [selectedBadgeId])

  // Live update: re-fetch BOM list when the server's staleness version changes
  // (nightly/manual PDM stale check) or when another user changes BOMs
  const staleVersionInitRef = useRef(true)
  useEffect(() => {
    if (staleVersionInitRef.current) {
      staleVersionInitRef.current = false
      return
    }
    loadBOMs()
  }, [stalenessVersion, liveVersions.boms])

  // Check for sub-assembly RFQ data from AssemblyTree
  useEffect(() => {
    const subAssemblyRFQParam = searchParams.get('sub_assembly_rfq')
    if (subAssemblyRFQParam === 'true') {
      const storedData = sessionStorage.getItem('subAssemblyRFQData')
      if (storedData) {
        try {
          const rfqData = JSON.parse(storedData)
          // Clear the stored data
          sessionStorage.removeItem('subAssemblyRFQData')
          // Clear the URL parameter
          setSearchParams({}, { replace: true })
          
          // Process the sub-assembly RFQ
          processMechanicalRFQ(
            rfqData.bom_data,
            rfqData.bom_name || rfqData.assembly_name,
            {
              is_sub_assembly_rfq: true,
              assembly_name: rfqData.assembly_name
            }
          )
        } catch (error) {
          console.error('Error processing sub-assembly RFQ data:', error)
          showNotification('Error processing sub-assembly RFQ', 'error')
        }
      }
    }
  }, [searchParams])

  useEffect(() => {
    if (selectedBOMId) {
      loadBOMData(selectedBOMId)
      loadRevisions(selectedBOMId)
      setSearchParams({ bom_id: selectedBOMId })
    }
  }, [selectedBOMId])

  // Listen for price update events and auto-refresh if this BOM is affected
  useEffect(() => {
    const handlePriceUpdate = (event) => {
      const { affected_assemblies } = event.detail || {}
      
      if (!affected_assemblies || affected_assemblies.length === 0) {
        return
      }

      // Get the assembly part number for the currently selected BOM
      let currentAssemblyPartNumber = null
      
      // Try to get from bomData first (most reliable)
      if (bomData?.flat_data?.metadata?.assembly_name) {
        currentAssemblyPartNumber = bomData.flat_data.metadata.assembly_name
      } else if (bomData?.metadata?.assembly_name) {
        currentAssemblyPartNumber = bomData.metadata.assembly_name
      } else if (selectedBOMId) {
        // Fallback: get from boms array
        const currentBOM = boms.find(b => b.id === selectedBOMId)
        if (currentBOM?.assembly_part_number) {
          currentAssemblyPartNumber = currentBOM.assembly_part_number
        }
      }

      // Check if current assembly is in the affected list
      if (currentAssemblyPartNumber && affected_assemblies.includes(currentAssemblyPartNumber)) {
        console.log(`Price update detected for assembly ${currentAssemblyPartNumber}, refreshing BOM data...`)
        if (selectedBOMId) {
          loadBOMData(selectedBOMId)
        }
      }
    }

    // Add event listener
    window.addEventListener('priceUpdateComplete', handlePriceUpdate)

    // Cleanup on unmount
    return () => {
      window.removeEventListener('priceUpdateComplete', handlePriceUpdate)
    }
  }, [selectedBOMId, bomData, boms]) // Dependencies: re-run if BOM selection or data changes

  // Auto-trigger get-latest when RFQ file status modal opens
  useEffect(() => {
    if (showRFQFileStatusModal && rfqFileStatus?.file_status) {
      // Auto-fetch latest files from PDM for parts with missing files
      handleGetLatestFiles()
    }
  }, [showRFQFileStatusModal]) // eslint-disable-line react-hooks/exhaustive-deps

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
      console.log('BOMs response:', response.data)

      // The API returns an array directly, not wrapped in {success, boms}
      if (Array.isArray(response.data)) {
        console.log('Loaded BOMs count:', response.data.length)
        setBoms(response.data)
      } else if (response.data.success && response.data.boms) {
        // Fallback for if API structure changes
        setBoms(response.data.boms)
      } else {
        console.warn('Unexpected BOMs response structure:', response.data)
        setBoms([])
      }
    } catch (error) {
      console.error('Error loading BOMs:', error)
      console.error('Error response:', error.response?.data)
      showNotification(error.response?.data?.error || 'Error loading BOMs', 'error')
      setBoms([])
    }
  }

  const loadBOMData = async (bomId) => {
    setLoading(true)
    try {
      const response = await bomService.getBOMDataNew(bomId, 'flat')
      console.log('BOM data response:', response.data)

      if (response.data.success) {
        const items = response.data.flat_data?.items || []
        console.log('Loaded items count:', items.length)

        const transformedData = {
          ...response.data,
          items: items
        }
        setBomData(transformedData)
      } else {
        const errorMsg = response.data.error || 'Error loading BOM data'
        console.error('BOM data error:', errorMsg)
        showNotification(errorMsg, 'error')
        setBomData(null)
      }
    } catch (error) {
      console.error('Error loading BOM data:', error)
      console.error('Error response:', error.response?.data)
      showNotification(error.response?.data?.error || 'Error loading BOM data', 'error')
      setBomData(null)
    } finally {
      setLoading(false)
    }
  }

  const loadRevisions = async (bomId, setCurrentToBomId = null) => {
    if (!bomId) return

    setLoadingVersions(true)
    try {
      const response = await bomService.getBOMRevisions(bomId)
      console.log('Revisions response:', response.data)

      if (response.data.success && response.data.revisions) {
        const revisions = response.data.revisions
        setRevisions(revisions)

        // If setCurrentToBomId is provided, set that as current version
        // Otherwise, find the version matching the bomId, or latest, or first
        let versionToSet = null
        if (setCurrentToBomId) {
          versionToSet = revisions.find(v => v.id === setCurrentToBomId)
        }
        if (!versionToSet) {
          // Try to find version matching the bomId
          versionToSet = revisions.find(v => v.id === bomId)
        }
        if (!versionToSet) {
          // Fallback to latest or first
          versionToSet = revisions.find(v => v.is_latest) || revisions[0]
        }

        if (versionToSet) {
          setCurrentVersion(versionToSet)
          setSelectedRevision(versionToSet.id)
        }
      } else {
        setRevisions([])
        setCurrentVersion(null)
      }
    } catch (error) {
      console.error('Error loading revisions:', error)
      setRevisions([])
      setCurrentVersion(null)
    } finally {
      setLoadingVersions(false)
    }
  }

  const handleSwitchVersion = async (versionId, versionNumber) => {
    if (!versionId) return

    setLoading(true)
    try {
      // Load the BOM data for the selected version
      await loadBOMData(versionId)

      // Update selected BOM ID to the version ID
      setSelectedBOMId(versionId)

      // Reload revisions and set the current version to the one we just switched to
      // Pass versionId as second parameter to set it as current
      await loadRevisions(versionId, versionId)

      showNotification(`Switched to version ${versionNumber}`, 'success')
    } catch (error) {
      console.error('Error switching version:', error)
      showNotification('Error switching version', 'error')
    } finally {
      setLoading(false)
    }
  }

  // BOM name editing removed - name is now derived from assembly description and not editable

  const handleUnloadBOM = () => {
    setSelectedBOMId(null)
    setBomData(null)
    setRevisions([])
    setCurrentVersion(null)
    setSelectedRevision(null)
    setSearchParams({}) // Clear URL params
    showNotification('BOM unloaded', 'info')
  }

  // Helper function to process mechanical RFQ with BOM data
  const processMechanicalRFQ = async (treeData, bomName, metadata = {}) => {
    setCreatingRFQ(true)
    try {
      // Analyze RFQ files
      const response = await rfqService.analyzeRFQFiles({
        bom_data: treeData,
        bom_name: bomName
      })

      if (response.data.success) {
        // Store metadata for refresh functionality
        // For sub-assembly RFQ, store the original BOM data for refresh
        const rfqStatusWithMetadata = {
          ...response.data,
          metadata: {
            ...response.data.metadata,
            ...metadata,
            is_sub_assembly_rfq: metadata.is_sub_assembly_rfq || false,
            // Store original BOM data for sub-assembly RFQ refresh
            original_bom_data: metadata.is_sub_assembly_rfq ? treeData : metadata.original_bom_data,
            assembly_name: metadata.assembly_name || null
          }
        }
        setRfqFileStatus(rfqStatusWithMetadata)
        setRemovedRFQParts(new Set())
        setSelectedRFQParts(new Set())
        setShowRFQFileStatusModal(true)
        setShowMechanicalRFQModal(false)
        // Don't show name modal here - it will show when user clicks "Export RFQ Files"
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

  const handleDeleteBOM = async (bom) => {
    if (!window.confirm(`Are you sure you want to delete "${bom.name}"? This action cannot be undone.`)) {
      return
    }
    try {
      const response = await bomService.deleteBOM(bom.id)
      if (response.data.success) {
        showNotification('BOM deleted successfully', 'success')
        if (selectedBOMId === bom.id) {
          setSelectedBOMId(null)
          setBomData(null)
        }
        loadBOMs()
      } else {
        showNotification('Error deleting BOM', 'error')
      }
    } catch (error) {
      showNotification('Error deleting BOM', 'error')
    }
  }

  const handleUpdateBOM = async (bom) => {
    setUpdatingBOM(bom)
    // Keep the BOM's last configuration; leave blank (not "Default") if it never had one.
    setUpdateConfiguration(bom.configuration || '')
    setShowUpdateModal(true)
  }

  const handleRefreshBOMCost = async (bomId) => {
    try {
      const response = await bomService.refreshBOMCost(bomId)
      if (response.data.success) {
        showNotification(response.data.message || 'BOM cost refreshed successfully', 'success')
        // Reload BOM data if this BOM is currently selected
        if (selectedBOMId === bomId) {
          loadBOMData(bomId)
        }
        // Reload BOMs list to update any displayed costs
        loadBOMs()
      } else {
        showNotification(response.data.error || 'Error refreshing BOM cost', 'error')
      }
    } catch (error) {
      console.error('Error refreshing BOM cost:', error)
      showNotification(error.response?.data?.error || 'Error refreshing BOM cost', 'error')
    }
  }

  const confirmUpdateBOM = async () => {
    if (!updatingBOM) return

    setUpdating(true)
    try {
      const response = await pdmService.updateBOM({
        bom_id: updatingBOM.id,
        bom_name: updatingBOM.name,
        configuration: updateConfiguration
      })

      if (response.data.success) {
        showNotification(response.data.message || 'BOM updated successfully', 'success')
        setShowUpdateModal(false)
        setUpdatingBOM(null)
        // Reload BOMs and current BOM data
        loadBOMs()
        if (selectedBOMId === updatingBOM.id) {
          // Load the new BOM version that was created
          if (response.data.bom_data && response.data.bom_data.id) {
            const newBomId = response.data.bom_data.id
            setSelectedBOMId(newBomId)
            loadBOMData(newBomId)
            loadRevisions(newBomId)
          } else {
            loadBOMData(selectedBOMId)
            loadRevisions(selectedBOMId)
          }
        }
      } else if (response.data.requires_eco) {
        // Handle ECO workflow - show ECO modal
        // Store exported data to reuse later
        setUpdatingBOM({
          ...updatingBOM,
          exportedBomData: response.data.exported_bom_data,
          treeData: response.data.tree_data,
          newPartsData: response.data.new_parts_data
        })
        setRevisionChanges(response.data.revision_changes || [])
        setEcoData({})
        setShowUpdateModal(false)
        setShowECOModal(true)
        // Auto-fill ECO numbers for each revision change
        loadNextECOCodes(response.data.revision_changes || [])
      } else {
        showNotification(response.data.error || 'Error updating BOM', 'error')
      }
    } catch (error) {
      console.error('Error updating BOM:', error)
      showNotification(error.response?.data?.error || 'Error updating BOM', 'error')
    } finally {
      setUpdating(false)
    }
  }

  const loadNextECOCodes = async (changes) => {
    try {
      if (!changes || changes.length === 0) {
        return
      }
      
      // Get all ECO codes in one batch request
      const response = await api.post('/api/eco/next-batch', {
        count: changes.length
      })
      
      if (response.data.success && response.data.eco_codes) {
        const newEcoData = { ...ecoData }
        response.data.eco_codes.forEach((ecoCode, index) => {
          newEcoData[`eco_number_${index}`] = ecoCode
        })
        setEcoData(newEcoData)
      } else {
        showNotification(response.data.error || 'Error loading ECO codes', 'error')
      }
    } catch (error) {
      console.error('Error loading ECO codes:', error)
      const errorMsg = error.response?.data?.error || error.message || 'Error loading ECO codes'
      showNotification(errorMsg, 'error')
    }
  }

  const handleSubmitECO = async () => {
    if (!updatingBOM) return

    // Validate all ECO fields are filled
    const missingFields = []
    revisionChanges.forEach((change, index) => {
      if (!ecoData[`eco_number_${index}`] || !ecoData[`eco_description_${index}`] || ecoData[`backward_compatible_${index}`] === undefined) {
        missingFields.push(change.part_number)
      }
    })

    if (missingFields.length > 0) {
      showNotification(`Please fill all ECO fields for: ${missingFields.join(', ')}`, 'warning')
      return
    }

    setSubmittingECO(true)
    try {
      // Prepare ECO data and update ECO database
      const ecoDataArray = []
      for (let index = 0; index < revisionChanges.length; index++) {
        const change = revisionChanges[index]
        const ecoCode = ecoData[`eco_number_${index}`]
        const ecoDescription = ecoData[`eco_description_${index}`]
        const backwardCompatible = ecoData[`backward_compatible_${index}`] === 'true' || ecoData[`backward_compatible_${index}`] === true
        
        // Update ECO in database
        try {
          await api.put(`/api/eco/${ecoCode}/update`, {
            description: ecoDescription,
            backward_compatible: backwardCompatible
          })
        } catch (error) {
          console.error(`Error updating ECO ${ecoCode}:`, error)
          showNotification(`Error updating ECO ${ecoCode} in database`, 'warning')
        }
        
        ecoDataArray.push({
          part_number: change.part_number,
          old_revision: change.old_revision,
          new_revision: change.new_revision,
          eco_number: ecoCode,
          eco_description: ecoDescription,
          backward_compatible: backwardCompatible
        })
      }

      const response = await pdmService.updateBOMWithECO({
        bom_id: updatingBOM.id,
        bom_name: updatingBOM.name,
        configuration: updateConfiguration,
        eco_data: ecoDataArray,
        exported_bom_data: updatingBOM.exportedBomData,
        tree_data: updatingBOM.treeData,
        new_parts_data: updatingBOM.newPartsData
      })

      if (response.data.success) {
        showNotification(response.data.message || 'BOM updated successfully with ECO', 'success')
        setShowECOModal(false)
        setUpdatingBOM(null)
        setEcoData({})
        setRevisionChanges([])

        // Reload BOMs and current BOM data
        loadBOMs()
        if (selectedBOMId === updatingBOM.id) {
          // Load the new BOM version that was created
          if (response.data.bom_data && response.data.bom_data.id) {
            const newBomId = response.data.bom_data.id
            setSelectedBOMId(newBomId)
            loadBOMData(newBomId)
            loadRevisions(newBomId)
          } else {
            loadBOMData(selectedBOMId)
            loadRevisions(selectedBOMId)
          }
        }
      } else {
        showNotification(response.data.error || 'Error updating BOM with ECO', 'error')
      }
    } catch (error) {
      console.error('Error submitting ECO:', error)
      showNotification(error.response?.data?.error || 'Error submitting ECO', 'error')
    } finally {
      setSubmittingECO(false)
    }
  }

  const handleImportBOM = () => {
    setShowImportModal(true)
  }

  const handleImportSuccess = () => {
    setShowImportModal(false)
    loadProjectBadges() // Reload badges in case a new one was created
    loadBOMs()
    showNotification('BOM imported successfully', 'success')
  }

  const handleExportToSheets = () => {
    // Always start fresh — no carried-over selections from previous opens
    setExportSelectedBOMIds(new Set())

    // Pre-fill export name if available
    if (bomData) {
      const assemblyName =
        bomData?.flat_data?.metadata?.assembly_name ||
        bomData?.flat_data?.name ||
        bomData?.name ||
        `bom_${selectedBOMId}`
      setExportName(assemblyName)
    }
    
    setExportDialogType('sheets')
    setShowExportDialog(true)
  }

  const handleExportToExcel = () => {
    // Always start fresh — no carried-over selections from previous opens
    setExportSelectedBOMIds(new Set())

    // Pre-fill export name if available
    if (bomData) {
      const assemblyName =
        bomData?.flat_data?.metadata?.assembly_name ||
        bomData?.flat_data?.name ||
        bomData?.name ||
        `bom_${selectedBOMId}`
      setExportName(assemblyName)
    }
    
    setExportDialogType('excel')
    setShowExportDialog(true)
  }

  const handleMechanicalRFQ = async () => {
    // If no BOM is loaded, show multi-BOM selection modal
    if (!selectedBOMId || !bomData) {
      setShowMultiBOMModal(true)
      return
    }

    setCreatingRFQ(true)
    try {
      const selectedBOM = boms.find(b => b.id === selectedBOMId)
      const bomName = selectedBOM?.name || `BOM_${selectedBOMId}`

      // Get tree data for RFQ analysis
      const treeResponse = await bomService.getBOMDataNew(selectedBOMId, 'tree')
      if (!treeResponse.data.success) {
        throw new Error('Failed to get BOM tree data')
      }

      let filteredTreeData = treeResponse.data.tree_data || treeResponse.data

      // Only filter if parts are selected; otherwise use whole BOM
      if (selectedBOMParts.size > 0) {
        // Filter tree data to only include selected parts
        const filterTreeBySelectedParts = (node) => {
          const partKey = `${node.bom_columns?.['PART NUMBER'] || node.name}_${node.bom_columns?.['Revision'] || node.revision || '01'}`
          const isSelected = selectedBOMParts.has(partKey)

          // Filter children recursively
          let filteredChildren = []
          if (node.children && Array.isArray(node.children)) {
            filteredChildren = node.children
              .map(child => filterTreeBySelectedParts(child))
              .filter(child => child !== null)
          }

          // If this node is selected or has selected children, include it
          if (isSelected || filteredChildren.length > 0) {
            return {
              ...node,
              children: filteredChildren
            }
          }

          return null
        }

        filteredTreeData = filterTreeBySelectedParts(filteredTreeData)
        if (!filteredTreeData) {
          throw new Error('No selected parts found in BOM tree')
        }
      }

      // Use helper function to process RFQ
      await processMechanicalRFQ(filteredTreeData, bomName, {
        selected_bom_parts: selectedBOMParts.size > 0 ? Array.from(selectedBOMParts) : null,
        selected_bom_id: selectedBOMId
      })
    } catch (error) {
      console.error('Error analyzing RFQ:', error)
      showNotification(error.response?.data?.error || 'Error analyzing RFQ files', 'error')
      setCreatingRFQ(false)
    }
  }

  const handleStandardPartsRFQ = async () => {
    // If no BOM is loaded, show multi-BOM selection modal
    if (!selectedBOMId || !bomData) {
      // Set flag to indicate this is for Standard RFQ
      window.standardRFQMultiBOM = true
      setShowMultiBOMModal(true)
      return
    }
    
    // BOM is loaded, proceed with type selection
    await showStandardPartsRFQTypeSelection()
  }

  const showStandardPartsRFQTypeSelection = async () => {
    // Extract unique part types from BOM data
    const partTypes = new Set()
    if (bomData && bomData.items) {
      bomData.items.forEach(item => {
        const partType = item.part_type || item['Type'] || 'Unknown'
        if (partType && partType !== 'Assembly') {
          partTypes.add(partType)
        }
      })
    }
    setAvailablePartTypes(Array.from(partTypes).sort())
    setSelectedPartTypes([])
    setShowStandardPartsRFQModal(true)
  }

  const handleRefreshRFQStatus = async () => {
    if (!rfqFileStatus) return

    setRefreshingRFQStatus(true)
    try {
      // Check if this is a multi-BOM RFQ - use metadata first, then state
      const isMultiBOM = rfqFileStatus.metadata?.is_multi_bom || selectedBOMIds.size > 0
      const bomIdsToUse = rfqFileStatus.metadata?.selected_bom_ids
        ? new Set(rfqFileStatus.metadata.selected_bom_ids)
        : selectedBOMIds

      let response

      if (isMultiBOM && bomIdsToUse.size > 0) {
        // Multi-BOM refresh: re-consolidate and analyze
        const bomDataList = []
        const bomNames = []

        for (const bomId of bomIdsToUse) {
          const bom = boms.find(b => b.id === bomId)
          if (!bom) continue

          const treeResponse = await bomService.getBOMDataNew(bomId, 'tree')
          if (treeResponse.data.success && treeResponse.data.tree_data) {
            bomDataList.push(treeResponse.data.tree_data)
            bomNames.push(bom.name)
          }
        }

        if (bomDataList.length === 0) {
          throw new Error('No valid BOM data found')
        }

        // Re-consolidate using the same function as the initial flow,
        // with stored multiplier settings so quantities stay correct
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
          bom_name: `Multi-BOM RFQ`
        })
      } else if (!rfqFileStatus.metadata?.is_sub_assembly_rfq && !rfqFileStatus.metadata?.is_general_rfq &&
                 (selectedBOMId || rfqFileStatus.metadata?.selected_bom_id)) {
        // Single BOM refresh - use metadata if available, otherwise use state.
        // Sub-assembly/General RFQs must NOT fall into this branch even when a
        // BOM happens to be selected — it would overwrite the RFQ's contents
        // with the whole selected BOM.
        const bomIdToUse = rfqFileStatus.metadata?.selected_bom_id || selectedBOMId
        const selectedBOM = boms.find(b => b.id === bomIdToUse)
        const bomName = selectedBOM?.name || `BOM_${bomIdToUse}`

        const treeResponse = await bomService.getBOMDataNew(bomIdToUse, 'tree')
        if (!treeResponse.data.success) {
          throw new Error('Failed to get BOM tree data')
        }

        let treeData = treeResponse.data.tree_data || treeResponse.data

        // If parts were selected originally, filter tree data to only include those parts
        const selectedPartsFromMetadata = rfqFileStatus.metadata?.selected_bom_parts
        if (selectedPartsFromMetadata && selectedPartsFromMetadata.length > 0) {
          const selectedPartsSet = new Set(selectedPartsFromMetadata)

          const filterTreeBySelectedParts = (node) => {
            const partKey = `${node.bom_columns?.['PART NUMBER'] || node.name}_${node.bom_columns?.['Revision'] || node.revision || '01'}`
            const isSelected = selectedPartsSet.has(partKey)

            // Filter children recursively
            let filteredChildren = []
            if (node.children && Array.isArray(node.children)) {
              filteredChildren = node.children
                .map(child => filterTreeBySelectedParts(child))
                .filter(child => child !== null)
            }

            // If this node is selected or has selected children, include it
            if (isSelected || filteredChildren.length > 0) {
              return {
                ...node,
                children: filteredChildren
              }
            }

            return null
          }

          treeData = filterTreeBySelectedParts(treeData)
          if (!treeData) {
            throw new Error('No selected parts found in BOM tree')
          }
        }

        response = await rfqService.analyzeRFQFiles({
          bom_data: treeData,
          bom_name: bomName,
          removed_parts: Array.from(removedRFQParts)
        })
      } else if (rfqFileStatus.metadata?.is_sub_assembly_rfq) {
        // Sub-assembly RFQ refresh - use original BOM data stored in metadata
        const assemblyName = rfqFileStatus.metadata.assembly_name || 'Sub-Assembly RFQ'
        let bomData = rfqFileStatus.metadata.original_bom_data
        
        if (!bomData) {
          throw new Error('Original BOM data not available for sub-assembly RFQ refresh')
        }
        
        // Filter out removed parts from original BOM data
        bomData = {
          ...bomData,
          children: bomData.children.filter(child => {
            const partNumber = child.bom_columns?.['PART NUMBER'] || child.name || ''
            const revision = child.bom_columns?.['Revision'] || child.revision || '01'
            const partKey = `${partNumber}_REV${revision}`
            return !removedRFQParts.has(partKey)
          })
        }
        
        response = await rfqService.analyzeRFQFiles({
          bom_data: bomData,
          bom_name: assemblyName,
          removed_parts: Array.from(removedRFQParts)
        })
      } else if (rfqFileStatus.metadata?.is_general_rfq) {
        // General RFQ refresh - use original BOM data if available, otherwise rebuild from file_status
        const generalRFQName = rfqFileStatus.metadata.general_rfq_name || 'General RFQ'
        let bomData = rfqFileStatus.metadata.original_bom_data
        
        if (!bomData) {
          // Fallback: rebuild BOM data structure from current file_status
          bomData = {
            name: generalRFQName,
            children: rfqFileStatus.file_status
              .filter(part => !removedRFQParts.has(`${part.part_number}_REV${part.revision}`))
              .map(part => ({
                name: part.part_number || '',
                bom_columns: {
                  'PART NUMBER': part.part_number || '',
                  'Revision': part.revision || '01',
                  'DESCRIPTION': part.description || '',
                  'QTY.': part.qty || 1,
                  'Type': 'Mechanical part',
                  'State': part.state || '',
                  'Material': part.material || '',
                  'FINISH1': part.finish1 || '',
                  'FINISH2': part.finish2 || '',
                  'PART NAME': part.description || part.part_number || ''
                },
                part_type: 'Mechanical part',
                revision: part.revision || '01',
                qty: part.qty || 1,
                description: part.description || '',
                children: []
              }))
          }
        } else {
          // Filter out removed parts from original BOM data
          bomData = {
            ...bomData,
            children: bomData.children.filter(child => {
              const partNumber = child.bom_columns?.['PART NUMBER'] || child.name || ''
              const revision = child.bom_columns?.['Revision'] || child.revision || '01'
              const partKey = `${partNumber}_REV${revision}`
              return !removedRFQParts.has(partKey)
            })
          }
        }

        response = await rfqService.analyzeRFQFiles({
          bom_data: bomData,
          bom_name: generalRFQName,
          removed_parts: Array.from(removedRFQParts)
        })
      } else {
        throw new Error('No BOM data available for refresh')
      }

      if (response.data.success) {
        // Filter out removed parts and preserve original quantities from previous file_status
        const previousFileStatusMap = new Map()
        if (rfqFileStatus.file_status) {
          rfqFileStatus.file_status.forEach(part => {
            const partKey = `${part.part_number}_REV${part.revision}`
            previousFileStatusMap.set(partKey, part)
          })
        }
        
        const filteredFileStatus = response.data.file_status
          .filter(part => {
            const partKey = `${part.part_number}_REV${part.revision}`
            return !removedRFQParts.has(partKey)
          })
          .map(part => {
            // Preserve original qty from previous file_status if it exists
            const partKey = `${part.part_number}_REV${part.revision}`
            const previousPart = previousFileStatusMap.get(partKey)
            if (previousPart && previousPart.qty !== undefined) {
              return {
                ...part,
                qty: previousPart.qty  // Preserve original quantity
              }
            }
            return part
          })
        
        // Recalculate all_complete based on remaining (non-removed) parts
        const allComplete = filteredFileStatus.length > 0 && filteredFileStatus.every(part => part.overall_status === 'Complete')
        // Preserve metadata for refresh functionality, including custom quantities
        const isGeneralRFQ = rfqFileStatus.metadata?.is_general_rfq
        const isSubAssemblyRFQ = rfqFileStatus.metadata?.is_sub_assembly_rfq
        const preservedCustomQuantities = rfqFileStatus.metadata?.custom_quantities || {}
        const updatedMetadata = isMultiBOM ? {
          ...response.data.metadata,
          is_multi_bom: true,
          selected_bom_ids: Array.from(bomIdsToUse),
          custom_quantities: preservedCustomQuantities,
          // Preserve multiplier settings so export doesn't double-multiply
          multiplier_mode: rfqFileStatus.metadata?.multiplier_mode,
          global_multiplier: rfqFileStatus.metadata?.global_multiplier,
          bom_multipliers: rfqFileStatus.metadata?.bom_multipliers,
          consolidated_data: rfqFileStatus.metadata?.consolidated_data
        } : isSubAssemblyRFQ ? {
          ...response.data.metadata,
          is_sub_assembly_rfq: true,
          assembly_name: rfqFileStatus.metadata.assembly_name,
          original_bom_data: rfqFileStatus.metadata.original_bom_data,
          custom_quantities: preservedCustomQuantities
        } : isGeneralRFQ ? {
          ...response.data.metadata,
          is_general_rfq: true,
          general_rfq_name: rfqFileStatus.metadata.general_rfq_name,
          standard_parts: rfqFileStatus.metadata.standard_parts,
          custom_quantities: preservedCustomQuantities
        } : {
          ...response.data.metadata,
          selected_bom_parts: rfqFileStatus.metadata?.selected_bom_parts || null,
          selected_bom_id: rfqFileStatus.metadata?.selected_bom_id || selectedBOMId,
          custom_quantities: preservedCustomQuantities
        }
        setRfqFileStatus({ ...response.data, file_status: filteredFileStatus, all_complete: allComplete, metadata: updatedMetadata })
        showNotification('RFQ status refreshed', 'success')
      } else {
        showNotification(response.data.error || 'Error refreshing RFQ status', 'error')
      }
    } catch (error) {
      console.error('Error refreshing RFQ status:', error)
      showNotification(error.response?.data?.error || 'Error refreshing RFQ status', 'error')
    } finally {
      setRefreshingRFQStatus(false)
    }
  }

  const handleRemovePartFromRFQ = (partKey, partNumber, revision) => {
    const newRemoved = new Set(removedRFQParts)
    newRemoved.add(partKey)
    setRemovedRFQParts(newRemoved)

    // Filter out removed part from file status and recalculate counts
    if (rfqFileStatus && rfqFileStatus.file_status) {
      const filteredFileStatus = rfqFileStatus.file_status.filter(part => {
        const key = `${part.part_number}_REV${part.revision}`
        return key !== partKey
      })
      
      // Recalculate counts based on remaining (non-removed) parts
      const completeCount = filteredFileStatus.filter(part => part.overall_status === 'Complete').length
      const notReleasedCount = filteredFileStatus.filter(part => part.state !== 'Released').length
      const filesMissingCount = filteredFileStatus.filter(part => 
        part.x_t_status === 'Missing' || part.pdf_status === 'Missing'
      ).length
      const allComplete = filteredFileStatus.length > 0 && filteredFileStatus.every(part => part.overall_status === 'Complete')
      const allPartsReleased = filteredFileStatus.length > 0 && filteredFileStatus.every(part => part.state === 'Released')
      
      // Update rfqFileStatus with filtered data and recalculated counts
      setRfqFileStatus({ 
        ...rfqFileStatus, 
        file_status: filteredFileStatus,
        complete_count: completeCount,
        not_released_count: notReleasedCount,
        files_missing_count: filesMissingCount,
        all_complete: allComplete,
        all_parts_released: allPartsReleased,
        // Update analysis counts to reflect remaining parts
        analysis: {
          ...rfqFileStatus.analysis,
          manufacturing_parts_count: filteredFileStatus.length
        }
      })
    }

    showNotification(`Part ${partNumber} REV${revision} removed from RFQ`, 'info')
  }

  const handleGetLatestFiles = async () => {
    if (!rfqFileStatus) return

    setCreatingRFQ(true)
    try {
      // Extract missing files from file_status
      // Missing files are parts that don't have both x_t and pdf files
      const missingFiles = []

      if (rfqFileStatus.file_status) {
        rfqFileStatus.file_status.forEach(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          // Skip removed parts
          if (removedRFQParts.has(partKey)) return

          // Check if files are missing OR status is not complete
          if (part.x_t_status === 'Missing' || part.pdf_status === 'Missing' || part.overall_status !== 'Complete') {
            // Format: "PART_NUMBER REVREVISION" (e.g., "029-MP-03221 REV01")
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
        
        // Only show "nothing received" if actually nothing was retrieved
        if (retrievedCount === 0 && failedCount === 0) {
          showNotification('No files were retrieved from PDM', 'warning')
        } else {
          let message = `Retrieved ${retrievedCount} file(s) from PDM`
          if (failedCount > 0) {
            message += `, ${failedCount} failed`
          }
          showNotification(message, retrievedCount > 0 ? 'success' : 'warning')
        }
        
        // Automatically refresh status after getting latest files
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

  // Consolidate BOMs with multipliers applied
  const consolidateBOMsWithMultipliers = (bomDataList, bomIds, bomMultipliersMap, mode, globalMultiplier, customQuantitiesMap) => {
    const consolidatedParts = {}

    // Helper to get custom quantity for a part
    const getCustomQuantity = (partNumber, revision) => {
      const partKey = `${partNumber}_REV${revision}`
      return customQuantitiesMap[partKey] || 0
    }

    // Process a single BOM tree with multiplier
    const processBOMTree = (node, bomId, parentQty = 1) => {
      // Calculate current node quantity
      const nodeQty = parseFloat(node.bom_columns?.['QTY.'] || node.qty || 1) || 1
      const effectiveQty = parentQty * nodeQty

      // Apply multiplier based on mode (for per-BOM mode, apply before consolidation)
      let multipliedQty = effectiveQty
      if (mode === 'per_bom' && bomMultipliersMap[bomId]) {
        multipliedQty = effectiveQty * bomMultipliersMap[bomId]
      }

      // Check if this node has part data
      if (node.bom_columns && node.bom_columns['PART NUMBER']) {
        const partNumber = node.bom_columns['PART NUMBER']
        const revision = node.bom_columns['Revision'] || '01'
        const key = `${partNumber}_${revision}`

        // Add custom quantity (will be applied after consolidation for general mode)
        const customQty = mode === 'per_bom' ? getCustomQuantity(partNumber, revision) : 0
        const finalQty = multipliedQty + customQty

        // Get file extension from file or PART NAME field
        const fileName = node.file || node.bom_columns?.['PART NAME'] || ''
        const fileExt = fileName && fileName.includes('.') ? fileName.toLowerCase().split('.').pop() : ''
        
        if (!consolidatedParts[key]) {
          // Create new consolidated part entry
          consolidatedParts[key] = {
            ...node.bom_columns,
            'QTY.': 0,
            _fileExt: fileExt // Store extension for comparison
          }
          // Preserve Type from node.part_type if not in bom_columns
          if (!consolidatedParts[key]['Type'] && node.part_type) {
            consolidatedParts[key]['Type'] = node.part_type
          }
        } else {
          // Check if we should prefer this node over existing (prefer .sldprt over .sldasm)
          const existingExt = consolidatedParts[key]._fileExt || ''
          const shouldPrefer = fileExt === 'sldprt' && existingExt === 'sldasm'
          
          if (shouldPrefer) {
            // Replace existing with new part data, but preserve quantity
            const existingQty = parseFloat(consolidatedParts[key]['QTY.']) || 0
            consolidatedParts[key] = {
              ...node.bom_columns,
              'QTY.': existingQty,
              _fileExt: fileExt
            }
            // Preserve Type
            if (node.part_type) {
              consolidatedParts[key]['Type'] = node.part_type
            }
          } else {
            // Part already exists - update Type if missing
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

        // Add to consolidated quantity
        consolidatedParts[key]['QTY.'] = (parseFloat(consolidatedParts[key]['QTY.']) || 0) + finalQty

        // Recalculate Price/BOM if Unit Cost is available
        if (consolidatedParts[key]['Unit Cost']) {
          const unitCost = parseFloat(consolidatedParts[key]['Unit Cost']) || 0
          consolidatedParts[key]['Price/BOM'] = unitCost * consolidatedParts[key]['QTY.']
        }
      }

      // Recursively process children
      if (node.children && Array.isArray(node.children)) {
        node.children.forEach(child => processBOMTree(child, bomId, effectiveQty))
      }
    }

    // Process each BOM with its corresponding ID
    bomDataList.forEach((bom, index) => {
      const bomId = bomIds[index]
      processBOMTree(bom, bomId)
    })

    // If general mode, apply global multiplier after consolidation
    if (mode === 'general') {
      Object.keys(consolidatedParts).forEach(key => {
        const part = consolidatedParts[key]
        const originalQty = part['QTY.']
        const customQty = getCustomQuantity(part['PART NUMBER'], part['Revision'] || '01')
        part['QTY.'] = (originalQty * globalMultiplier) + customQty

        // Recalculate Price/BOM
        if (part['Unit Cost']) {
          const unitCost = parseFloat(part['Unit Cost']) || 0
          part['Price/BOM'] = unitCost * part['QTY.']
        }
      })
    }

    // Create consolidated structure for tree format
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

  const handleShowQuantityModal = () => {
    if (!rfqFileStatus && !pendingBOMData) {
      showNotification('No RFQ data available', 'error')
      return
    }

    // For the RFQ status modal (third modal), always show quantity modal first
    // The name will be required when actually exporting
    // Only check for name if we're in the second modal (pendingBOMData exists)
    if (pendingBOMData) {
      // Second modal: Check if custom name is needed
      const isMultiBOM = selectedBOMIds.size > 0
      const needsCustomName = isMultiBOM || selectedBOMParts.size > 0 || removedRFQParts.size > 0

      // If name is needed and not set, show name modal first
      if (needsCustomName && !customRFQName.trim()) {
        setShowRFQNameModal(true)
        return
      }
    }

    // Show quantity modal directly (for both second and third modal)
    setShowQuantityModal(true)
  }

  const handleProcessMultiBOMRFQ = async () => {
    if (selectedBOMIds.size === 0) {
      showNotification('Please select at least one BOM', 'warning')
      return
    }


    const isStandardRFQ = window.standardRFQMultiBOM === true
    window.standardRFQMultiBOM = false // Reset flag

    setShowMultiBOMModal(false)
    setCreatingRFQ(true)

    try {
      // Collect tree data from all selected BOMs
      const bomDataList = []
      const bomNames = []

      for (const bomId of selectedBOMIds) {
        const bom = boms.find(b => b.id === bomId)
        if (!bom) continue

        const treeResponse = await bomService.getBOMDataNew(bomId, 'tree')
        if (treeResponse.data.success && treeResponse.data.tree_data) {
          bomDataList.push(treeResponse.data.tree_data)
          bomNames.push(bom.name)
        }
      }

      if (bomDataList.length === 0) {
        throw new Error('No valid BOM data found')
      }

      // Store BOM data temporarily for multiplier modal
      // Store as object with bomIds, bomDataList, and bomNames
      const pendingData = {
        bomIds: Array.from(selectedBOMIds),
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

      // Show multiplier modal for both Mechanical RFQ and Standard RFQ
      setCreatingRFQ(false)
      setShowQuantityModal(true)
    } catch (error) {
      console.error('Error creating multi-BOM RFQ:', error)
      showNotification(error.response?.data?.error || 'Error creating multi-BOM RFQ', 'error')
      setCreatingRFQ(false)
    }
  }

  // Process multi-BOM after multiplier selection
  const processMultiBOMAfterMultiplier = async (pendingData, mode, bomMultipliersMap, globalMult, customQtyMap) => {
    if (!pendingData) return

    setCreatingRFQ(true)
    try {
      const { bomIds, bomDataList, bomNames, isStandardRFQ } = pendingData

      // Consolidate with multipliers
      const consolidatedData = consolidateBOMsWithMultipliers(
        bomDataList,
        bomIds,
        bomMultipliersMap,
        mode,
        globalMult,
        customQtyMap
      )

      // Analyze RFQ files
      const response = await rfqService.analyzeRFQFiles({
        bom_data: consolidatedData,
        bom_name: `Multi-BOM RFQ`
      })

      if (response.data.success) {
        if (isStandardRFQ) {
          // For Standard RFQ, consolidate parts and show type selection
          window.standardRFQConsolidatedData = consolidatedData
          window.standardRFQSelectedBOMIds = bomIds
          
          // Extract unique part types from consolidated data
          const partTypes = new Set()
          consolidatedData.children.forEach(part => {
            const partType = part.part_type || part.bom_columns?.['Type'] || 'Unknown'
            if (partType && partType !== 'Assembly') {
              partTypes.add(partType)
            }
          })
          setAvailablePartTypes(Array.from(partTypes).sort())
          setSelectedPartTypes([])
          setShowStandardPartsRFQModal(true)
          setSelectedBOMIds(new Set())
        } else {
          // For Mechanical RFQ, show file status modal
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
              consolidated_data: consolidatedData // Store consolidated data for export
            }
          }
          setRfqFileStatus(rfqStatusWithMetadata)
          setRemovedRFQParts(new Set())
          setSelectedRFQParts(new Set())
          setShowRFQFileStatusModal(true)
          setSelectedBOMIds(new Set())
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


  // --- Add Extra Parts to RFQ handlers ---
  const handleOpenAddPartsToRFQ = async () => {
    setShowAddPartsToRFQModal(true)
    setAddPartsRFQSearchTerm('')
    setSelectedAddParts(new Set())
    setAddPartsRFQSelectedTypes([])
    setAddPartsRFQList([])
    setFilteredAddPartsRFQList([])
    // Load part types
    try {
      const res = await bomCostService.getPartTypes()
      if (res.data.success) {
        setAddPartsRFQTypes(res.data.types || [])
      }
    } catch (e) {
      console.error('Error loading part types for Add Parts:', e)
    }
  }

  const handleAddPartsRFQTypeToggle = async (type) => {
    const newTypes = addPartsRFQSelectedTypes.includes(type)
      ? addPartsRFQSelectedTypes.filter(t => t !== type)
      : [...addPartsRFQSelectedTypes, type]
    setAddPartsRFQSelectedTypes(newTypes)
    if (newTypes.length === 0) {
      setAddPartsRFQList([])
      setFilteredAddPartsRFQList([])
      return
    }
    setLoadingAddPartsRFQ(true)
    try {
      const res = await bomCostService.getPartsByTypes(newTypes)
      if (res.data.success) {
        // Exclude parts already in the RFQ
        const existingKeys = new Set(
          (rfqFileStatus?.file_status || []).map(p => `${p.part_number}_${p.revision}`)
        )
        const parts = (res.data.parts || []).filter(
          p => !existingKeys.has(`${p.part_number}_${p.revision}`)
        )
        setAddPartsRFQList(parts)
        setFilteredAddPartsRFQList(parts)
      }
    } catch (e) {
      console.error('Error loading parts for Add Parts:', e)
    } finally {
      setLoadingAddPartsRFQ(false)
    }
  }

  // Filter the add-parts list when search term changes
  const handleAddPartsRFQSearch = (term) => {
    setAddPartsRFQSearchTerm(term)
    const lower = term.toLowerCase()
    setFilteredAddPartsRFQList(
      addPartsRFQList.filter(p =>
        !term ||
        (p.part_number || '').toLowerCase().includes(lower) ||
        (p.description || '').toLowerCase().includes(lower)
      )
    )
  }

  const handleConfirmAddPartsToRFQ = async () => {
    const partsToAdd = addPartsRFQList.filter(p => selectedAddParts.has(p.id))
    if (partsToAdd.length === 0) return

    setLoadingAddPartsRFQ(true)
    try {
      // Analyze these parts via the existing RFQ analyze endpoint to get real PDM/file status
      const miniBoM = {
        name: 'Extra Parts',
        children: partsToAdd.map(part => ({
          name: part.part_number || '',
          bom_columns: {
            'PART NUMBER': part.part_number || '',
            'Revision': part.revision || '01',
            'DESCRIPTION': part.description || '',
            'QTY.': 1,
            'Type': part.part_type || 'Mechanical part',
            'Material': part.material || '',
            'FINISH1': part.finish1 || '',
            'FINISH2': part.finish2 || '',
          },
          part_type: part.part_type || 'Mechanical part',
          revision: part.revision || '01',
          qty: 1,
          description: part.description || '',
          children: []
        }))
      }

      const analysisResp = await rfqService.analyzeRFQFiles({ bom_data: miniBoM, bom_name: 'Extra Parts' })
      const analyzedStatuses = analysisResp.data?.success
        ? (analysisResp.data.file_status || [])
        : []

      // Build a lookup by part_number+revision from the analysis result
      const statusByKey = {}
      analyzedStatuses.forEach(s => { statusByKey[`${s.part_number}_${s.revision}`] = s })

      // Build file_status entries using real PDM data where available
      const newFileStatusEntries = partsToAdd.map(part => {
        const key = `${part.part_number}_${part.revision || '01'}`
        const analyzed = statusByKey[key]
        return analyzed
          ? { ...analyzed, qty: 1, manually_added: true }
          : {
              part_number: part.part_number || '',
              revision: part.revision || '01',
              description: part.description || '',
              qty: 1,
              part_type: part.part_type || '',
              material: part.material || '',
              finish1: part.finish1 || '',
              finish2: part.finish2 || '',
              overall_status: 'Complete',
              x_t_status: 'N/A',
              pdf_status: 'N/A',
              state: 'Manual Add',
              manually_added: true
            }
      })

      // Build BOM children entries for added parts
      const newBomChildren = partsToAdd.map(part => ({
        name: part.part_number || '',
        bom_columns: {
          'PART NUMBER': part.part_number || '',
          'Revision': part.revision || '01',
          'DESCRIPTION': part.description || '',
          'QTY.': 1,
          'Type': part.part_type || 'Mechanical part',
          'State': part.state || '',
          'Material': part.material || '',
          'FINISH1': part.finish1 || '',
          'FINISH2': part.finish2 || '',
        },
        part_type: part.part_type || 'Mechanical part',
        revision: part.revision || '01',
        qty: 1,
        description: part.description || '',
        children: []
      }))

      setRfqFileStatus(prev => {
        const updatedFileStatus = [...(prev.file_status || []), ...newFileStatusEntries]
        const updatedMetadata = { ...prev.metadata }

        // Update consolidated_data (multi-BOM path)
        if (updatedMetadata.consolidated_data?.children) {
          updatedMetadata.consolidated_data = {
            ...updatedMetadata.consolidated_data,
            children: [...updatedMetadata.consolidated_data.children, ...newBomChildren]
          }
        }
        // Update original_bom_data (general RFQ path)
        if (updatedMetadata.original_bom_data?.children) {
          updatedMetadata.original_bom_data = {
            ...updatedMetadata.original_bom_data,
            children: [...updatedMetadata.original_bom_data.children, ...newBomChildren]
          }
        }

        return { ...prev, file_status: updatedFileStatus, metadata: updatedMetadata }
      })

      showNotification(`Added ${partsToAdd.length} part(s) to RFQ`, 'success')
      setShowAddPartsToRFQModal(false)
    } catch (e) {
      console.error('Error analyzing added parts:', e)
      showNotification('Error retrieving PDM status for added parts', 'error')
    } finally {
      setLoadingAddPartsRFQ(false)
    }
  }
  // --- End Add Extra Parts to RFQ handlers ---

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

  const handleExportRFQ = async () => {
    if (!rfqFileStatus) return

    // Check if this is a multi-BOM export
    const isMultiBOM = rfqFileStatus.metadata?.is_multi_bom || selectedBOMIds.size > 0
    const bomIdsToUse = rfqFileStatus.metadata?.selected_bom_ids 
      ? new Set(rfqFileStatus.metadata.selected_bom_ids)
      : selectedBOMIds

    // Determine export name:
    // - Use custom name if provided
    // - For General RFQ, use name from metadata
    // - Use BOM name only if: no parts selected, no multiple BOMs, no parts removed
    // Always require a user-chosen name before exporting
    let exportName = customRFQName.trim()

    if (!exportName) {
      setShowRFQNameModal(true)
      return
    }

    setCreatingRFQ(true)
    try {
      let bomDataToExport = null
      let bomIdToUse = selectedBOMId

      // If we have selected BOM IDs (multi-BOM), merge them
      if (bomIdsToUse.size > 0) {
        const bomDataList = []
        for (const bomId of bomIdsToUse) {
          const bom = boms.find(b => b.id === bomId)
          if (!bom) continue

          const treeResponse = await bomService.getBOMDataNew(bomId, 'tree')
          if (treeResponse.data.success && treeResponse.data.tree_data) {
            bomDataList.push(treeResponse.data.tree_data)
          }
        }

        if (bomDataList.length > 0) {
          // For multi-BOM, the data is already consolidated with multipliers applied
          // We need to check if we have consolidated data from metadata
          if (rfqFileStatus?.metadata?.is_multi_bom && rfqFileStatus?.metadata?.consolidated_data) {
            // Use the already-consolidated data from metadata
            // Wrap it in 'data' key as backend expects
            bomDataToExport = {
              data: rfqFileStatus.metadata.consolidated_data
            }
          } else {
            // Fallback: send as multi-BOM structure (will be consolidated by backend)
            bomDataToExport = {
              data: {
                name: exportName,
                children: bomDataList,
                metadata: { is_multi_bom: true }
              }
            }
          }
        }
      } else if (rfqFileStatus.metadata?.is_general_rfq) {
        // General RFQ: use original BOM data from metadata
        const originalBomData = rfqFileStatus.metadata.original_bom_data
        if (!originalBomData) {
          throw new Error('No BOM data available for General RFQ export')
        }
        // Filter out removed parts from original BOM data
        bomDataToExport = {
          ...originalBomData,
          children: originalBomData.children.filter(child => {
            const partNumber = child.bom_columns?.['PART NUMBER'] || child.name || ''
            const revision = child.bom_columns?.['Revision'] || child.revision || '01'
            const partKey = `${partNumber}_REV${revision}`
            return !removedRFQParts.has(partKey)
          })
        }
        // Update quantities based on custom quantities from quantity modal
        // Note: filteredFileStatus will be set after this, so we need to use rfqFileStatus.file_status
        const currentFileStatus = (rfqFileStatus.file_status || []).filter(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          return !removedRFQParts.has(partKey)
        })
        
        bomDataToExport.children = bomDataToExport.children.map(child => {
          const partNumber = child.bom_columns?.['PART NUMBER'] || child.name || ''
          const revision = child.bom_columns?.['Revision'] || child.revision || '01'
          
          // Find corresponding part in file_status to get updated qty
          const fileStatusPart = currentFileStatus.find(p => 
            p.part_number === partNumber && p.revision === revision
          )
          
          if (fileStatusPart) {
            // Use qty from file_status which includes custom quantities from quantity modal
            const updatedQty = parseFloat(fileStatusPart.qty) || 1
            if (child.bom_columns) {
              child.bom_columns['QTY.'] = updatedQty
            }
            child.qty = updatedQty
          }
          
          return child
        })
      } else if (selectedBOMId) {
        // Single BOM
        const treeResponse = await bomService.getBOMDataNew(selectedBOMId, 'tree')
        if (!treeResponse.data.success) {
          throw new Error('Failed to get BOM tree data')
        }
        bomDataToExport = treeResponse.data.tree_data || treeResponse.data
        // Append any manually-added parts (via "Add Extra Parts") to the BOM data
        const manuallyAdded = (rfqFileStatus.file_status || []).filter(p => p.manually_added)
        if (manuallyAdded.length > 0 && bomDataToExport?.children) {
          const manualChildren = manuallyAdded.map(part => ({
            name: part.part_number || '',
            bom_columns: {
              'PART NUMBER': part.part_number || '',
              'Revision': part.revision || '01',
              'DESCRIPTION': part.description || '',
              'QTY.': part.qty || 1,
              'Type': part.part_type || 'Mechanical part',
              'State': part.pdm_state || '',
              'Material': part.material || '',
              'FINISH1': part.finish1 || '',
              'FINISH2': part.finish2 || '',
            },
            part_type: part.part_type || 'Mechanical part',
            revision: part.revision || '01',
            qty: part.qty || 1,
            description: part.description || '',
            children: []
          }))
          bomDataToExport = { ...bomDataToExport, children: [...(bomDataToExport.children || []), ...manualChildren] }
        }
      } else {
        throw new Error('No BOM data available for export')
      }

      // Filter file_status: first remove removed parts, then check if remaining are complete
      let filteredFileStatus = rfqFileStatus.file_status || []

      // Step 1: Filter out removed parts
      filteredFileStatus = filteredFileStatus.filter(part => {
        const partKey = `${part.part_number}_REV${part.revision}`
        return !removedRFQParts.has(partKey)
      })

      // Step 2: If parts are selected from RFQ status modal, filter to only those
      if (selectedRFQParts.size > 0) {
        filteredFileStatus = filteredFileStatus.filter(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          return selectedRFQParts.has(partKey)
        })
      }

      // Step 3: Validate that all remaining parts are complete
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

      if (filteredFileStatus.length === 0) {
        showNotification('No parts available for export', 'warning')
        setCreatingRFQ(false)
        return
      }

      // Get multiplier settings from metadata if available
      const exportMultiplierMode = rfqFileStatus.metadata?.multiplier_mode || multiplierMode
      const isMultiBOMWithMultipliers = isMultiBOM && rfqFileStatus.metadata?.multiplier_mode

      // For multi-BOM: Update consolidated data with current quantities from third modal
      // The file_status part.qty already has multipliers/custom qty from second modal applied
      // We need to recalculate based on current multiplier and custom quantities from third modal
      if (isMultiBOMWithMultipliers && bomDataToExport?.data) {
        const originalCustomQuantities = rfqFileStatus.metadata?.custom_quantities || {}
        const originalGlobalMultiplier = rfqFileStatus.metadata?.global_multiplier || 1
        const consolidatedData = bomDataToExport.data
        
        // Build map of target quantities: what should be in Excel (matching third modal display)
        const targetQuantitiesByPartKey = {}
        filteredFileStatus.forEach(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          // part.qty in file_status already has original multiplier + original custom qty from second modal
          const qtyFromSecondModal = parseFloat(part.qty) || 0
          
          // Extract base quantity: (qtyFromSecondModal - originalCustomQty) / originalMultiplier
          const originalCustomQty = originalCustomQuantities[partKey] || 0
          let baseQty
          if (exportMultiplierMode === 'general' && originalGlobalMultiplier > 0) {
            baseQty = (qtyFromSecondModal - originalCustomQty) / originalGlobalMultiplier
          } else {
            // For per_bom mode, multipliers were applied per-BOM, so qtyFromSecondModal is already multiplied
            // We can't easily extract base, so use qtyFromSecondModal as base and adjust for custom qty changes
            baseQty = qtyFromSecondModal - originalCustomQty
          }
          
          // Calculate target qty with current multiplier and custom qty
          // Both general and per_bom modes apply globalMultiplier from the 3rd modal
          // (for per_bom, baseQty already has per-BOM multipliers, globalMultiplier is additional)
          const currentCustomQty = customQuantities[partKey] || 0
          const targetQty = Math.max(0, (baseQty * globalMultiplier) + currentCustomQty)

          targetQuantitiesByPartKey[partKey] = targetQty
        })
        
        // Update consolidated data with target quantities
        if (Object.keys(targetQuantitiesByPartKey).length > 0) {
          const updateConsolidatedQuantities = (node) => {
            if (!node || typeof node !== 'object') return
            
            const partNumber = node.bom_columns?.['PART NUMBER'] || node['PART NUMBER'] || node.name
            const revision = node.bom_columns?.['Revision'] || node.revision || '01'
            const partKey = `${partNumber}_REV${revision}`
            
            if (partNumber && targetQuantitiesByPartKey[partKey] !== undefined) {
              const targetQty = targetQuantitiesByPartKey[partKey]
              
              // Update all quantity fields
              if (node.bom_columns) {
                node.bom_columns['QTY.'] = targetQty
              }
              node.qty = targetQty
              node['QTY.'] = targetQty
              
              // Recalculate Price/BOM if Unit Cost is available
              if (node.bom_columns?.['Unit Cost']) {
                const unitCost = parseFloat(node.bom_columns['Unit Cost']) || 0
                node.bom_columns['Price/BOM'] = unitCost * targetQty
              }
            }
            
            // Process children
            if (node.children && Array.isArray(node.children)) {
              node.children.forEach(child => updateConsolidatedQuantities(child))
            }
            if (node.items && Array.isArray(node.items)) {
              node.items.forEach(item => updateConsolidatedQuantities(item))
            }
          }
          
          // Update the consolidated data structure
          if (consolidatedData.children && Array.isArray(consolidatedData.children)) {
            consolidatedData.children.forEach(child => updateConsolidatedQuantities(child))
          } else {
            updateConsolidatedQuantities(consolidatedData)
          }
        }
      }

      // Convert custom quantities to format expected by backend
      // For multi-BOM: quantities are already updated in consolidated data above, so don't send custom quantities
      // For single BOM: we need to send custom quantities to be added
      const customQuantitiesToSend = {}
      if (!isMultiBOMWithMultipliers) {
        // Single BOM: use current custom quantities
        filteredFileStatus.forEach(part => {
          const partKey = `${part.part_number}_REV${part.revision}`
          if (customQuantities[partKey] !== undefined && customQuantities[partKey] !== 0) {
            // Store as addition/subtraction amount (negative values decrease qty)
            customQuantitiesToSend[part.part_number] = customQuantities[partKey]
          }
        })
      }
      // For multi-BOM, customQuantitiesToSend remains empty (quantities already updated in consolidated data)

      // For multi-BOM exports where multipliers were already applied during consolidation,
      // set quantity_multiplier to 1 to avoid double multiplication
      // For single BOM exports, use the global multiplier
      let exportQuantityMultiplier = 1
      if (!isMultiBOMWithMultipliers) {
        exportQuantityMultiplier = globalMultiplier
      }

      // Prepare export data
      const exportData = {
        bom_data: bomDataToExport,
        bom_name: exportName,
        bom_id: bomIdToUse,
        bom_revision: selectedBOMId ? boms.find(b => b.id === selectedBOMId)?.version : null,
        quantity_multiplier: exportQuantityMultiplier,
        custom_quantities: customQuantitiesToSend,
        removed_parts: Array.from(removedRFQParts),
        selected_parts: selectedRFQParts.size > 0 ? Array.from(selectedRFQParts) : null
      }

      const response = await rfqService.exportRFQFiles(exportData)

      if (response.data.success) {
        // Check if this is a General RFQ with standard parts to process
        const isGeneralRFQ = rfqFileStatus?.metadata?.is_general_rfq
        const standardParts = rfqFileStatus?.metadata?.standard_parts || []
        
        if (isGeneralRFQ && standardParts.length > 0) {
          // Process standard parts after mechanical RFQ export
          try {
            const generalRFQName = rfqFileStatus.metadata.general_rfq_name || 'General RFQ'
            
            // Group standard parts by type
            const partsByType = {}
            standardParts.forEach(part => {
              const type = part.part_type || 'Unknown'
              if (!partsByType[type]) {
                partsByType[type] = []
              }
              partsByType[type].push({
                part_number: part.part_number || '',
                revision: part.revision || '',
                qty: 1,
                description: part.description || '',
                part_type: type
              })
            })

            // Create RFQ for each type
            for (const [type, typeParts] of Object.entries(partsByType)) {
              await rfqService.exportStandardPartsRFQ({
                bom_name: generalRFQName,
                bom_id: null,
                bom_revision: null,
                part_type: type,
                filtered_parts: typeParts,
                is_multi_bom: false,
                rfq_name: generalRFQName
              })
            }
            
            showNotification('General RFQ (Mechanical + Standard Parts) exported successfully', 'success')
          } catch (error) {
            console.error('Error processing standard parts from General RFQ:', error)
            showNotification('Mechanical RFQ exported, but error processing standard parts', 'warning')
          }
        } else {
          showNotification('RFQ files exported successfully', 'success')
        }
        
        setExportResult(response.data)
        setShowQuantityModal(false)
        setShowRFQFileStatusModal(false)
        setShowRFQNameModal(false)
        setShowExportSuccessModal(true)
        setQuantityMultipliers({})
        setCustomQuantities({})
        setCustomRFQName('')
        setGlobalMultiplier(1)
        setSelectedRFQParts(new Set())
        setMultiplierMode('general')
        setBomMultipliers({})
        setPendingBOMData(null)
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

  const handleCreateStandardPartsRFQ = async () => {
    if (selectedPartTypes.length === 0) {
      showNotification('Please select at least one part type', 'warning')
      return
    }

    // Set default RFQ name from first selected type (only if not already set)
    if (selectedPartTypes.length > 0 && !standardPartsRFQName) {
      // Default: just the type name (user can change it)
      setStandardPartsRFQName(selectedPartTypes[0])
    }

    // Check if this is a multi-BOM RFQ
    const isMultiBOM = window.standardRFQConsolidatedData !== undefined
    const consolidatedData = window.standardRFQConsolidatedData
    const selectedBOMIdsForRFQ = window.standardRFQSelectedBOMIds || []

    // Prepare parts list for quantity modal
    let filteredParts = []
    let bomName = 'Standard Parts RFQ'

    try {
      if (isMultiBOM && consolidatedData) {
        // Multi-BOM: use consolidated data
        bomName = `Multi-BOM Standard Parts RFQ`
        
        // Consolidate parts by part_number+revision and filter by type
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
      } else if (selectedBOMId && bomData) {
        // Single BOM: use existing logic
        const selectedBOM = boms.find(b => b.id === selectedBOMId)
        bomName = selectedBOM?.name || `BOM_${selectedBOMId}`
        
        // Filter parts by selected types
        if (bomData.items) {
          bomData.items.forEach(item => {
            const partType = item.part_type || item['Type'] || 'Unknown'
            if (selectedPartTypes.includes(partType)) {
              filteredParts.push({
                part_number: item.part_number || item['PART NUMBER'] || '',
                revision: item.revision || item['Revision'] || '',
                qty: parseInt(item.qty || item.quantity || item['QTY.'] || 0),
                description: item.description || item['DESCRIPTION'] || item['PART NAME'] || '',
                part_type: partType,
                thumbnail: item.thumbnail || null
              })
            }
          })
        }
      } else {
        throw new Error('No BOM data available')
      }

      // Store parts list and show quantity modal
      setStandardPartsQuantityList(filteredParts)
      setShowStandardPartsRFQModal(false)
      setShowStandardPartsQuantityModal(true)
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

    // Check if this is a multi-BOM RFQ
    const isMultiBOM = window.standardRFQConsolidatedData !== undefined
    const selectedBOMIdsForRFQ = window.standardRFQSelectedBOMIds || []

    setCreatingRFQ(true)
    try {
      let bomName = 'Standard Parts RFQ'
      if (isMultiBOM) {
        bomName = `Multi-BOM Standard Parts RFQ`
      } else if (selectedBOMId) {
        const selectedBOM = boms.find(b => b.id === selectedBOMId)
        bomName = selectedBOM?.name || `BOM_${selectedBOMId}`
      }

      // Group parts by type
      const partsByType = {}
      standardPartsQuantityList.forEach(part => {
        const partType = part.part_type || 'Unknown'
        if (!partsByType[partType]) {
          partsByType[partType] = []
        }
        // Ensure qty is an integer
        partsByType[partType].push({
          ...part,
          qty: parseInt(part.qty) || 1
        })
      })

      // Create RFQ for each selected part type
      const allResponses = []
      let hasDriveLink = false
      let driveFolderUrl = null
      
      for (const partType of selectedPartTypes) {
        const typeFilteredParts = partsByType[partType] || []

        if (typeFilteredParts.length === 0) continue

        // Determine BOM ID and revision for multi-BOM case
        let bomIdForRFQ = selectedBOMId
        let bomRevisionForRFQ = null
        
        if (isMultiBOM && selectedBOMIdsForRFQ.length > 0) {
          // For multi-BOM, use first BOM ID or create a combined identifier
          const firstBOMId = selectedBOMIdsForRFQ[0]
          const firstBOM = boms.find(b => b.id === firstBOMId)
          bomIdForRFQ = firstBOMId
          bomRevisionForRFQ = firstBOM?.version || null
        } else if (selectedBOMId) {
          const selectedBOM = boms.find(b => b.id === selectedBOMId)
          bomRevisionForRFQ = selectedBOM?.version || null
        }

        // Use custom RFQ name if provided, otherwise use default with type
        // Default format includes type, but user-provided name should not
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
        
        // Check for Google Drive link (use first one found)
        if (!hasDriveLink && response.data.google_drive?.folder_url) {
          hasDriveLink = true
          driveFolderUrl = response.data.google_drive.folder_url
        }
      }
      
      // Clear multi-BOM data
      window.standardRFQConsolidatedData = undefined
      window.standardRFQSelectedBOMIds = undefined

      showNotification(`Standard Parts RFQ created successfully for ${selectedPartTypes.length} part type(s)`, 'success')
      setShowStandardPartsQuantityModal(false)
      setStandardPartsQuantityList([])
      setStandardPartsRFQName('')
      setSelectedPartTypes([])
      
      // Show success modal with Drive link if available
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

  // General RFQ handlers
  const handleGeneralRFQ = async () => {
    try {
      const response = await bomCostService.getPartTypes()
      if (response.data.success) {
        setGeneralRFQTypes(response.data.types || [])
        setSelectedGeneralRFQTypes([])
        setGeneralRFQStep(0)
        setGeneralRFQSearchTerm('')
        setSelectedGeneralRFQParts(new Set())
        setGeneralRFQName('')
        setShowGeneralRFQModal(true)
      }
    } catch (error) {
      showNotification('Error loading part types', 'error')
    }
  }

  const handleGeneralRFQTypeSelect = async (type) => {
    if (selectedGeneralRFQTypes.includes(type)) {
      setSelectedGeneralRFQTypes(selectedGeneralRFQTypes.filter(t => t !== type))
    } else {
      setSelectedGeneralRFQTypes([...selectedGeneralRFQTypes, type])
    }
  }

  const handleGeneralRFQContinueToParts = async () => {
    if (selectedGeneralRFQTypes.length === 0) {
      showNotification('Please select at least one part type', 'warning')
      return
    }

    setLoadingGeneralRFQParts(true)
    try {
      // Fetch parts for all selected types
      const allParts = []
      for (const type of selectedGeneralRFQTypes) {
        const response = await bomCostService.getPartsByType(type)
        if (response.data.success && response.data.parts) {
          const partsWithType = response.data.parts.map(part => ({
            ...part,
            part_type: type
          }))
          allParts.push(...partsWithType)
        }
      }
      setGeneralRFQPartsList(allParts)
      setFilteredGeneralRFQParts(allParts)
      setGeneralRFQStep(1)
      // Don't set RFQ name here - it will be set in the quantity modal or mechanical RFQ process
    } catch (error) {
      showNotification('Error loading parts', 'error')
    } finally {
      setLoadingGeneralRFQParts(false)
    }
  }

  // Filter parts based on search term and vendor
  useEffect(() => {
    let filtered = generalRFQPartsList
    if (generalRFQSearchTerm.trim()) {
      const searchLower = generalRFQSearchTerm.toLowerCase()
      filtered = filtered.filter(part => {
        const partNumber = (part.part_number || '').toLowerCase()
        const description = (part.description || '').toLowerCase()
        return partNumber.includes(searchLower) || description.includes(searchLower)
      })
    }
    if (generalRFQVendorFilter) {
      filtered = filtered.filter(part => (part.vendor || '') === generalRFQVendorFilter)
    }
    setFilteredGeneralRFQParts(filtered)
  }, [generalRFQSearchTerm, generalRFQPartsList, generalRFQVendorFilter])

  // Get unique vendors from the parts list for vendor filter dropdown
  const generalRFQAvailableVendors = useMemo(() => {
    const vendors = new Set()
    generalRFQPartsList.forEach(part => {
      if (part.vendor) vendors.add(part.vendor)
    })
    return Array.from(vendors).sort()
  }, [generalRFQPartsList])

  const handleGeneralRFQPartToggle = (partId) => {
    const newSelected = new Set(selectedGeneralRFQParts)
    if (newSelected.has(partId)) {
      newSelected.delete(partId)
    } else {
      newSelected.add(partId)
    }
    setSelectedGeneralRFQParts(newSelected)
  }

  const handleGeneralRFQContinueToBoms = async () => {
    if (selectedGeneralRFQParts.size === 0) {
      showNotification('Please select at least one part', 'warning')
      return
    }
    // Load available BOMs for qty breakdown
    try {
      const response = await bomService.getBOMs()
      setGeneralRFQBomList(response.data.boms || response.data || [])
      setSelectedGeneralRFQBoms(new Set())
      setGeneralRFQBreakdown([])
      setGeneralRFQBomsUsed([])
      setGeneralRFQOrderQtys({})
      setGeneralRFQBomSearchTerm('')
      setGeneralRFQBomBadgeFilter(null)
      setGeneralRFQStep(2)
    } catch (error) {
      showNotification('Error loading BOMs', 'error')
    }
  }

  const handleGeneralRFQCalculateBreakdown = async () => {
    if (selectedGeneralRFQBoms.size === 0) {
      showNotification('Please select at least one BOM', 'warning')
      return
    }
    setLoadingBreakdown(true)
    try {
      const partIds = Array.from(selectedGeneralRFQParts)
      const bomIds = Array.from(selectedGeneralRFQBoms)
      const response = await rfqService.getPartsBomBreakdown(partIds, bomIds)
      if (response.data.success) {
        setGeneralRFQBreakdown(response.data.parts || [])
        setGeneralRFQBomsUsed(response.data.boms_used || [])
        const qtys = {}
        for (const part of response.data.parts || []) {
          qtys[part.part_id] = part.total_qty
        }
        setGeneralRFQOrderQtys(qtys)
      }
    } catch (error) {
      showNotification('Error calculating breakdown', 'error')
    } finally {
      setLoadingBreakdown(false)
    }
  }

  const handleGeneralRFQCreate = async () => {
    if (selectedGeneralRFQParts.size === 0) {
      showNotification('Please select at least one part', 'warning')
      return
    }

    setCreatingRFQ(true)
    try {
      // Get selected parts
      const selectedParts = generalRFQPartsList.filter(part => selectedGeneralRFQParts.has(part.id))
      
      // Separate parts by type for routing
      const mechanicalParts = []
      const standardParts = []
      
      selectedParts.forEach(part => {
        if (part.part_type === 'Mechanical part') {
          mechanicalParts.push(part)
        } else {
          standardParts.push(part)
        }
      })

      let hasDriveLink = false
      let driveFolderUrl = null

      // Handle Mechanical RFQ if there are mechanical parts
      if (mechanicalParts.length > 0) {
        // Build BOM data structure for mechanical RFQ analysis
        const rfqDisplayName = 'General RFQ'
        const bomData = {
          name: rfqDisplayName,
          children: mechanicalParts.map(part => {
            const orderQty = generalRFQOrderQtys[part.id] || 1
            return {
              name: part.part_number || '',
              bom_columns: {
                'PART NUMBER': part.part_number || '',
                'Revision': part.revision || '01',
                'DESCRIPTION': part.description || '',
                'QTY.': orderQty,
                'Type': part.part_type || 'Mechanical part',
                'State': part.state || '',
                'Material': part.material || '',
                'FINISH1': part.finish1 || '',
                'FINISH2': part.finish2 || '',
                'PART NAME': part.description || part.part_number || ''
              },
              part_type: 'Mechanical part',
              revision: part.revision || '01',
              qty: orderQty,
              description: part.description || '',
              children: []
            }
          })
        }

        // Analyze RFQ files (same as normal mechanical RFQ process)
        const response = await rfqService.analyzeRFQFiles({
          bom_data: bomData,
          bom_name: rfqDisplayName
        })

        if (response.data.success) {
          // Store metadata for General RFQ
          // Store original BOM data for refresh functionality
          const rfqStatusWithMetadata = {
            ...response.data,
            metadata: {
              ...response.data.metadata,
              is_general_rfq: true,
              general_rfq_name: rfqDisplayName,
              standard_parts: standardParts.length > 0 ? standardParts : null, // Store standard parts for later processing
              original_bom_data: bomData // Store original BOM data for refresh
            }
          }
          setRfqFileStatus(rfqStatusWithMetadata)
          setRemovedRFQParts(new Set())
          setSelectedRFQParts(new Set())
          setShowRFQFileStatusModal(true)
          setShowGeneralRFQModal(false)
          // Close General RFQ modal - user will continue in file status modal
          return // Exit early - don't process standard parts yet
        } else {
          throw new Error(response.data.error || 'Error analyzing Mechanical RFQ files')
        }
      }

      // Handle Standard Parts RFQ for other types
      if (standardParts.length > 0 && mechanicalParts.length === 0) {
        // Show quantity modal for standard parts (similar to Standard Parts RFQ flow)
        // Prepare parts list for quantity modal
        const partsForQuantityModal = standardParts.map(part => ({
          part_number: part.part_number || '',
          revision: part.revision || '',
          qty: generalRFQOrderQtys[part.id] || parseInt(part.qty) || 1,
          description: part.description || '',
          part_type: part.part_type || 'Unknown',
          thumbnail: part.thumbnail || null
        }))
        
        // Store in state for quantity modal
        setStandardPartsQuantityList(partsForQuantityModal)
        // Set default RFQ name from selected types
        const defaultName = selectedGeneralRFQTypes.length > 0 
          ? selectedGeneralRFQTypes.join(', ')
          : 'General RFQ'
        setStandardPartsRFQName(defaultName)
        setSelectedPartTypes([...new Set(standardParts.map(p => p.part_type || 'Unknown'))])
        
        // Close General RFQ modal and show quantity modal
        setShowGeneralRFQModal(false)
        setShowStandardPartsQuantityModal(true)
        
        // Reset General RFQ state
        setGeneralRFQStep(0)
        setSelectedGeneralRFQTypes([])
        setSelectedGeneralRFQParts(new Set())
        setGeneralRFQSearchTerm('')
        setGeneralRFQName('')
        setGeneralRFQPartsList([])
        setFilteredGeneralRFQParts([])
      } else if (mechanicalParts.length > 0) {
        // Mechanical parts are being processed - modal already closed, just reset state
        setGeneralRFQStep(0)
        setSelectedGeneralRFQTypes([])
        setSelectedGeneralRFQParts(new Set())
        setGeneralRFQSearchTerm('')
        setGeneralRFQName('')
        setGeneralRFQPartsList([])
        setFilteredGeneralRFQParts([])
      }
    } catch (error) {
      console.error('Error creating General RFQ:', error)
      showNotification(error.response?.data?.error || 'Error creating RFQ', 'error')
    } finally {
      setCreatingRFQ(false)
    }
  }

  // Sheet RFQ handlers
  const handleSheetRFQParse = async () => {
    if (!sheetRFQUrl.trim()) {
      showNotification('Please enter a Google Sheets URL', 'warning')
      return
    }
    setParsingSheet(true)
    try {
      const response = await rfqService.parseSheetRFQ({ sheet_url: sheetRFQUrl.trim() })
      if (response.data.success) {
        setSheetRFQMatchedParts(response.data.matched_parts || [])
        setSheetRFQUnmatchedParts(response.data.unmatched_parts || [])
        setSheetRFQDetectedColumns(response.data.detected_columns || null)
        setShowSheetRFQURLDialog(false)
        setShowSheetRFQReviewDialog(true)
      } else {
        showNotification(response.data.error || 'Error parsing sheet', 'error')
      }
    } catch (error) {
      console.error('Error parsing sheet for RFQ:', error)
      showNotification(error.response?.data?.error || 'Error reading Google Sheet', 'error')
    } finally {
      setParsingSheet(false)
    }
  }

  const handleSheetRFQRemoveUnmatched = (index) => {
    setSheetRFQUnmatchedParts(prev => prev.filter((_, i) => i !== index))
  }

  const handleSheetRFQRemoveMatched = (index) => {
    setSheetRFQMatchedParts(prev => prev.filter((_, i) => i !== index))
  }

  const handleSheetRFQUpdateQty = (index, newQty) => {
    setSheetRFQMatchedParts(prev => prev.map((part, i) =>
      i === index ? { ...part, qty: Math.max(1, parseInt(newQty) || 1) } : part
    ))
  }

  const handleSheetRFQCreate = async () => {
    if (sheetRFQUnmatchedParts.length > 0) {
      showNotification('Please remove all unmatched parts before continuing', 'warning')
      return
    }
    if (sheetRFQMatchedParts.length === 0) {
      showNotification('No parts to create RFQ for', 'warning')
      return
    }

    setCreatingRFQ(true)
    try {
      const defaultRFQName = 'Sheet RFQ'
      const bomData = {
        name: defaultRFQName,
        children: sheetRFQMatchedParts.map(part => ({
          name: part.part_number || '',
          bom_columns: {
            'PART NUMBER': part.part_number || '',
            'Revision': part.revision || '01',
            'DESCRIPTION': part.description || '',
            'QTY.': part.qty || 1,
            'Type': part.part_type || 'Mechanical part',
            'State': part.state || '',
            'Material': part.material || '',
            'FINISH1': part.finish1 || '',
            'FINISH2': part.finish2 || '',
            'PART NAME': part.description || part.part_number || ''
          },
          part_type: 'Mechanical part',
          revision: part.revision || '01',
          qty: part.qty || 1,
          description: part.description || '',
          children: []
        }))
      }

      const response = await rfqService.analyzeRFQFiles({
        bom_data: bomData,
        bom_name: defaultRFQName
      })

      if (response.data.success) {
        const rfqStatusWithMetadata = {
          ...response.data,
          metadata: {
            ...response.data.metadata,
            is_general_rfq: true,
            is_sheet_rfq: true,
            general_rfq_name: defaultRFQName,
            original_bom_data: bomData
          }
        }
        setRfqFileStatus(rfqStatusWithMetadata)
        setRemovedRFQParts(new Set())
        setSelectedRFQParts(new Set())
        setShowRFQFileStatusModal(true)
        setShowSheetRFQReviewDialog(false)
        // Reset sheet RFQ state
        setSheetRFQUrl('')
        setSheetRFQMatchedParts([])
        setSheetRFQUnmatchedParts([])
        setSheetRFQDetectedColumns(null)
      } else {
        throw new Error(response.data.error || 'Error analyzing RFQ files')
      }
    } catch (error) {
      console.error('Error creating Sheet RFQ:', error)
      showNotification(error.response?.data?.error || 'Error creating RFQ', 'error')
    } finally {
      setCreatingRFQ(false)
    }
  }

  const canImportBOM = user?.role === 'admin' || user?.role === 'engineer'
  const canExportBOM = canImportBOM || user?.role === 'floor_manager' || user?.role === 'floor'
  const canUpdateBOM = user?.role === 'admin' || user?.role === 'engineer'
  const canEditBOMTable = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'floor_manager'
  const canDelete = user?.role === 'admin'
  const canEditInventory = user?.role === 'floor'
  const canCreateStandardRFQ = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'floor_manager'

  return (
    <Box sx={{ width: '100%', height: 'calc(100vh - 44px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, pt: 0.75, pb: 0.25, flexShrink: 0 }}>
        <BOMsAndPartsTabBar />
        <Typography variant="h5" sx={{ fontSize: '0.95rem', fontWeight: 600, mb: 0.25 }}>
          Assembly BOM Management
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage and view your Bill of Materials
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, px: 1.5, pb: 0.75, display: 'flex', flexDirection: 'column', gap: 1, overflow: 'auto' }}>
        {/* Top row: Quick Actions + Select BOM side by side */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1 }}>
          {/* Quick Actions Card */}
          <Card sx={{ flex: { xs: '1 1 auto', md: '0 0 320px' } }}>
            <CardHeader
              title={<Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Quick Actions</Typography>}
              sx={{ py: 0.75, px: 1.5 }}
            />
            <CardContent sx={{ py: 0.75, px: 1.5, '&:last-child': { pb: 1 } }}>
              {/* Import BOM */}
              <Button
                variant="contained"
                fullWidth
                size="small"
                startIcon={<DatabaseIcon sx={{ fontSize: '0.875rem' }} />}
                onClick={handleImportBOM}
                disabled={!canImportBOM}
                sx={{ fontSize: '0.75rem', py: 0.5, mb: 0.75 }}
              >
                Import BOM
              </Button>

              {/* Export */}
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
                Export
              </Typography>
              <Grid container spacing={0.5} sx={{ mb: 0.75 }}>
                <Grid item xs={6}>
                  <Button variant="contained" color="success" fullWidth size="small"
                    startIcon={<TableIcon sx={{ fontSize: '0.875rem' }} />}
                    onClick={handleExportToSheets} disabled={!canExportBOM}
                    sx={{ fontSize: '0.7rem', py: 0.5 }}>
                    Sheets
                  </Button>
                </Grid>
                <Grid item xs={6}>
                  <Button variant="contained" color="info" fullWidth size="small"
                    startIcon={<DownloadIcon sx={{ fontSize: '0.875rem' }} />}
                    onClick={handleExportToExcel} disabled={!canExportBOM}
                    sx={{ fontSize: '0.7rem', py: 0.5 }}>
                    Excel
                  </Button>
                </Grid>
              </Grid>

              {/* RFQ — BOM related */}
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
                RFQ — BOM related
              </Typography>
              <Grid container spacing={0.5} sx={{ mb: 0.75 }}>
                <Grid item xs={6}>
                  <Button variant="contained" color="warning" fullWidth size="small"
                    startIcon={<InvoiceIcon sx={{ fontSize: '0.875rem' }} />}
                    onClick={handleMechanicalRFQ} disabled={!canImportBOM || user?.role === 'floor_manager'}
                    sx={{ fontSize: '0.7rem', py: 0.5 }}>
                    Mechanical
                  </Button>
                </Grid>
                <Grid item xs={6}>
                  <Button variant="contained" color="secondary" fullWidth size="small"
                    startIcon={<DescriptionIcon sx={{ fontSize: '0.875rem' }} />}
                    onClick={handleStandardPartsRFQ} disabled={!canCreateStandardRFQ}
                    sx={{ fontSize: '0.7rem', py: 0.5 }}>
                    Standard Parts
                  </Button>
                </Grid>
              </Grid>

              {/* RFQ — Not BOM related */}
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', display: 'block', mb: 0.5 }}>
                RFQ — Not BOM related
              </Typography>
              <Grid container spacing={0.5}>
                <Grid item xs={6}>
                  <Button variant="contained" color="primary" fullWidth size="small"
                    startIcon={<DescriptionIcon sx={{ fontSize: '0.875rem' }} />}
                    onClick={handleGeneralRFQ} disabled={!canCreateStandardRFQ}
                    sx={{ fontSize: '0.7rem', py: 0.5 }}>
                    General RFQ
                  </Button>
                </Grid>
                <Grid item xs={6}>
                  <Button variant="contained" color="info" fullWidth size="small"
                    startIcon={<LinkIcon sx={{ fontSize: '0.875rem' }} />}
                    onClick={() => setShowSheetRFQURLDialog(true)} disabled={!canCreateStandardRFQ}
                    sx={{ fontSize: '0.7rem', py: 0.5 }}>
                    Sheet RFQ
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Select BOM Card */}
          <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 200, maxHeight: { xs: 400, md: 'calc(100vh - 170px)' } }}>
            <CardHeader
              title={<Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Select BOM</Typography>}
              action={
                selectedBOMId && (
                  <Tooltip title="Unload BOM">
                    <IconButton size="small" onClick={handleUnloadBOM}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )
              }
              sx={{ py: 0.75, px: 1.5 }}
            />
            <CardContent sx={{ p: 1.5, pt: 0, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, '&:last-child': { pb: 1 } }}>
              {/* Badge Filter */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                <Chip label="All" size="small" onClick={() => setSelectedBadgeId(null)}
                  sx={{
                    fontWeight: 600, fontSize: '0.7rem', height: 22,
                    bgcolor: !selectedBadgeId ? 'primary.main' : 'action.selected',
                    color: !selectedBadgeId ? 'white' : 'text.primary',
                    '&:hover': { bgcolor: !selectedBadgeId ? 'primary.dark' : 'action.hover' },
                  }}
                />
                {projectBadges.map((badge) => (
                  <Chip key={badge.id} label={badge.name} size="small"
                    onClick={() => setSelectedBadgeId(badge.id)}
                    sx={{
                      fontWeight: 500, fontSize: '0.7rem', height: 22,
                      bgcolor: selectedBadgeId === badge.id ? (badge.color || '#6c757d') : 'action.selected',
                      color: selectedBadgeId === badge.id ? 'white' : 'text.primary',
                      '&:hover': {
                        bgcolor: selectedBadgeId === badge.id ? (badge.color || '#6c757d') : 'action.hover',
                        opacity: selectedBadgeId === badge.id ? 0.85 : 1,
                      },
                    }}
                  />
                ))}
              </Box>
              <Paper sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                {boms.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 3 }}>
                    <DatabaseIcon sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
                    <Typography variant="body2" color="text.secondary">No BOMs loaded yet</Typography>
                    <Typography variant="caption" color="text.secondary">Import a BOM to get started</Typography>
                  </Box>
                ) : (
                  <List dense>
                    {boms.map((bom) => (
                      <ListItem key={bom.id} disablePadding
                        sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                      >
                        <ListItemButton
                          onClick={() => setSelectedBOMId(bom.id)}
                          selected={selectedBOMId === bom.id}
                          sx={{ py: 0.75, px: 1.5 }}
                        >
                          <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                              <Typography variant="body2" fontWeight="medium" sx={{ fontSize: '0.8rem' }}>
                                {bom.name}
                              </Typography>
                              {bom.badge && (
                                <Chip label={bom.badge.name} size="small"
                                  sx={{
                                    height: 16, fontSize: '0.6rem',
                                    bgcolor: bom.badge.color || '#6c757d', color: 'white',
                                    '& .MuiChip-label': { px: 0.5 },
                                  }}
                                />
                              )}
                              {bom.pdm_stale && (
                                <Tooltip title={
                                  <>
                                    <div>PDM has newer revisions:</div>
                                    {(bom.pdm_stale_details || []).slice(0, 5).map((d, i) => (
                                      <div key={i}>{d.part_number} {d.bom_revision}→{d.pdm_revision}</div>
                                    ))}
                                    {(bom.pdm_stale_details || []).length > 5 && (
                                      <div>and {(bom.pdm_stale_details || []).length - 5} more…</div>
                                    )}
                                  </>
                                }>
                                  <Chip label="PDM stale" size="small" color="warning"
                                    icon={<WarningAmberIcon sx={{ fontSize: '0.7rem !important' }} />}
                                    sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                                  />
                                </Tooltip>
                              )}
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                              {bom.assembly_part_number || 'N/A'}
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
                            {canUpdateBOM && (
                              <Button size="small" variant="outlined" color="warning"
                                startIcon={<UploadIcon sx={{ fontSize: '0.75rem !important' }} />}
                                onClick={(e) => { e.stopPropagation(); handleUpdateBOM(bom) }}
                                sx={{ textTransform: 'none', fontSize: '0.65rem', py: 0, px: 0.75, minHeight: 0, lineHeight: 1.6 }}>
                                Update
                              </Button>
                            )}
                            {canDelete && (
                              <Button size="small" variant="outlined" color="error"
                                startIcon={<DeleteIcon sx={{ fontSize: '0.75rem !important' }} />}
                                onClick={(e) => { e.stopPropagation(); handleDeleteBOM(bom) }}
                                sx={{ textTransform: 'none', fontSize: '0.65rem', py: 0, px: 0.75, minHeight: 0, lineHeight: 1.6 }}>
                                Delete
                              </Button>
                            )}
                          </Box>
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                )}
              </Paper>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* Fullscreen BOM Table Dialog */}
      <Dialog open={!!selectedBOMId && (!!bomData || loading)} fullScreen onKeyDown={(e) => { if (e.key === 'Escape') handleUnloadBOM() }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          {/* Toolbar */}
          <Box sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider', flexShrink: 0,
            bgcolor: 'background.paper',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontSize: '0.85rem', fontWeight: 600 }}>
                BOM Structure {bomData?.bom_name ? `— ${bomData.bom_name}` : ''}
              </Typography>
              {/* Version Control Selector */}
              {loadingVersions ? (
                <CircularProgress size={18} />
              ) : revisions.length > 0 ? (
                <>
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <Select
                      value={currentVersion?.id ?? ''}
                      onChange={(e) => {
                        const ver = revisions.find(v => v.id === e.target.value)
                        if (ver) handleSwitchVersion(ver.id, ver.version)
                      }}
                      renderValue={(selectedId) => {
                        const ver = revisions.find(v => v.id === selectedId)
                        if (!ver) return ''
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography variant="body2" fontWeight="bold">{ver.version}</Typography>
                            {ver.is_latest && (
                              <Chip label="LATEST" size="small" color="warning"
                                sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                              />
                            )}
                          </Box>
                        )
                      }}
                      sx={{ '& .MuiSelect-select': { py: 0.5 } }}
                    >
                      {[...revisions].reverse().map((ver) => {
                        const isCurrent = currentVersion && ver.id === currentVersion.id
                        const dateStr = ver.created_at
                          ? new Date(ver.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                          : ''
                        return (
                          <MenuItem key={ver.id} value={ver.id}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', minWidth: 200 }}>
                              <Typography variant="body2" fontWeight={isCurrent ? 'bold' : 'regular'} sx={{ minWidth: 28 }}>
                                {ver.version}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                                {dateStr}
                              </Typography>
                              {ver.is_latest && (
                                <Chip label="LATEST" size="small" color="warning"
                                  sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                                />
                              )}
                            </Box>
                          </MenuItem>
                        )
                      })}
                    </Select>
                  </FormControl>
                  <Tooltip title="Version info">
                    <IconButton size="small"
                      onClick={() => { setSelectedVersionInfo(currentVersion); setShowVersionInfoModal(true) }}
                      sx={{ p: 0.5 }}>
                      <InfoIcon fontSize="small" color="action" />
                    </IconButton>
                  </Tooltip>
                </>
              ) : null}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {canUpdateBOM && (
                <Button size="small" variant="outlined" color="warning" startIcon={<UploadIcon />}
                  onClick={() => {
                    const bom = boms.find(b => b.id === selectedBOMId)
                    if (bom) handleUpdateBOM(bom)
                  }}
                  sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
                  Update from PDM
                </Button>
              )}
              {canDelete && (
                <Button size="small" variant="outlined" color="error" startIcon={<DeleteIcon />}
                  onClick={() => {
                    const bom = boms.find(b => b.id === selectedBOMId)
                    if (bom) handleDeleteBOM(bom)
                  }}
                  sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
                  Delete
                </Button>
              )}
              <Tooltip title="Close BOM">
                <IconButton size="small" onClick={handleUnloadBOM}>
                  <CloseIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* PDM staleness warning banner */}
          {(() => {
            const staleBom = boms.find(b => b.id === selectedBOMId)
            if (!staleBom?.pdm_stale) return null
            const details = staleBom.pdm_stale_details || []
            const hasEco = details.some(d => d.eco_number)
            return (
              <Alert severity="warning" icon={<WarningAmberIcon />}
                sx={{ mx: 1, mt: 1, flexShrink: 0 }}
                action={canUpdateBOM ? (
                  <Button color="inherit" size="small" startIcon={<UploadIcon />}
                    onClick={() => handleUpdateBOM(staleBom)}>
                    Update from PDM
                  </Button>
                ) : null}
              >
                <strong>Out of date with PDM</strong> — newer revisions exist for {details.length} part{details.length === 1 ? '' : 's'}
                {' '}({details.slice(0, 5).map(d => `${d.part_number} ${d.bom_revision}→${d.pdm_revision}`).join(', ')}
                {details.length > 5 ? `, and ${details.length - 5} more` : ''})
                {staleBom.last_pdm_check ? ` — checked ${new Date(staleBom.last_pdm_check + 'Z').toLocaleString()}` : ''}.
                {hasEco ? ' An ECO is already recorded for some parts — re-importing may be all that is needed.' : ''}
              </Alert>
            )
          })()}

          {/* BOM Table content */}
          <Box sx={{ flex: 1, minHeight: 0, p: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                <CircularProgress />
                <Typography sx={{ ml: 2, fontSize: '0.85rem' }}>Loading BOM data...</Typography>
              </Box>
            ) : bomData ? (
              <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <BOMTable
                  data={bomData}
                  canEdit={canEditBOMTable}
                  canEditInventory={canEditInventory}
                  onRefresh={() => loadBOMData(selectedBOMId)}
                  selectedParts={selectedBOMParts}
                  onSelectionChange={setSelectedBOMParts}
                />
              </Box>
            ) : (
              <Box sx={{ textAlign: 'center', py: 5, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography color="text.secondary">No BOM data available</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Dialog>

        {/* BOM Name Edit Dialog removed - BOM name is now derived from assembly description and not editable */}

        {/* PDM Import Modal */}
        {showImportModal && (
          <PDMImportModal
            onClose={() => setShowImportModal(false)}
            onSuccess={handleImportSuccess}
          />
        )}

        {/* Update BOM Modal */}
        <ResizableDialog id="updateBOM" open={showUpdateModal} onClose={() => !updating && setShowUpdateModal(false)}>
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <UploadIcon />
              Update BOM from PDM
            </Box>
          </DialogTitle>
          <DialogContent>
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                <strong>What this will do:</strong>
              </Typography>
              <Box component="ul" sx={{ pl: 2, mb: 0 }}>
                <Typography component="li" variant="body2" color="text.secondary">
                  Re-run the C# exporter with the same parameters
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  Create a new version of the BOM
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  Detect and track any changes
                </Typography>
                <Typography component="li" variant="body2" color="text.secondary">
                  Update the BOM data with latest information
                </Typography>
              </Box>
            </Box>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Are you sure you want to update <strong>{updatingBOM?.name}</strong> from PDM?
            </Typography>
            <TextField
              fullWidth
              label="Configuration"
              value={updateConfiguration}
              onChange={(e) => setUpdateConfiguration(e.target.value)}
              disabled={updating}
              placeholder="Default"
              helperText="Keeps this BOM's last configuration. Change it to update from a different configuration."
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowUpdateModal(false)} disabled={updating}>
              Cancel
            </Button>
            <Button
              onClick={confirmUpdateBOM}
              variant="contained"
              color="warning"
              disabled={updating}
              startIcon={updating ? <CircularProgress size={16} /> : <UploadIcon />}
            >
              {updating ? 'Updating...' : 'Update BOM'}
            </Button>
          </DialogActions>
        </ResizableDialog>


        {/* Standard Parts RFQ Modal */}
        <ResizableDialog id="standardPartsRFQ" open={showStandardPartsRFQModal} onClose={() => !creatingRFQ && setShowStandardPartsRFQModal(false)} maxWidth="md" fullWidth>
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
              setShowStandardPartsRFQModal(false)
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
          id="standardPartsQuantity"
          open={showStandardPartsQuantityModal} 
          onClose={() => !creatingRFQ && setShowStandardPartsQuantityModal(false)} 
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
                      const hasThumb = hasThumbnail(part.thumbnail)
                      return (
                        <tr key={index} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px' }}>
                            <Tooltip
                              title={
                                hasThumb ? (
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
                              <span style={{ cursor: hasThumb ? 'pointer' : 'default' }}>
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
              setShowStandardPartsQuantityModal(false)
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

        {/* General RFQ Modal */}
        <ResizableDialog 
          id="generalRFQ"
          open={showGeneralRFQModal}
          onClose={() => { if (!creatingRFQ) { setShowGeneralRFQModal(false); setGeneralRFQName('') } }}
          maxWidth="lg" 
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <DescriptionIcon />
              Create General RFQ
              {generalRFQStep > 0 && (
                <IconButton
                  onClick={() => {
                    if (generalRFQStep === 2) {
                      setGeneralRFQStep(1)
                    } else {
                      setGeneralRFQStep(0)
                      setGeneralRFQSearchTerm('')
                      setFilteredGeneralRFQParts([])
                    }
                  }}
                  sx={{ position: 'absolute', right: 8, top: 8 }}
                  size="small"
                  title="Back"
                >
                  <CloseIcon />
                </IconButton>
              )}
            </Box>
          </DialogTitle>
          <DialogContent>
            {generalRFQStep === 0 && (
              <Box>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Select one or more part types to create RFQs. Mechanical parts will use Mechanical RFQ process, others will use Standard Parts RFQ process.
                </Alert>
                <Typography gutterBottom>Select Part Type:</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  {generalRFQTypes.map(type => (
                    <Chip
                      key={type}
                      label={type}
                      onClick={() => handleGeneralRFQTypeSelect(type)}
                      clickable
                      color={selectedGeneralRFQTypes.includes(type) ? 'primary' : 'default'}
                      variant={selectedGeneralRFQTypes.includes(type) ? 'filled' : 'outlined'}
                    />
                  ))}
                </Box>
                {selectedGeneralRFQTypes.length > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    {selectedGeneralRFQTypes.length} type(s) selected
                  </Typography>
                )}
              </Box>
            )}

            {generalRFQStep === 1 && (
              <Box>
                <Box sx={{ display: 'flex', gap: 2, mb: 2, mt: 1.25 }}>
                  <TextField
                    label="Search Parts"
                    value={generalRFQSearchTerm}
                    onChange={(e) => setGeneralRFQSearchTerm(e.target.value)}
                    placeholder="Search by part number or description"
                    disabled={creatingRFQ}
                    sx={{ flex: 1 }}
                    InputProps={{
                      startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                    }}
                  />
                  {generalRFQAvailableVendors.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                      <InputLabel>Vendor</InputLabel>
                      <Select
                        value={generalRFQVendorFilter}
                        label="Vendor"
                        onChange={(e) => setGeneralRFQVendorFilter(e.target.value)}
                      >
                        <MenuItem value="">All Vendors</MenuItem>
                        {generalRFQAvailableVendors.map(v => (
                          <MenuItem key={v} value={v}>{v}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </Box>
                {loadingGeneralRFQParts ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                    <CircularProgress />
                  </Box>
                ) : (
                  <Paper sx={{ maxHeight: '60vh', minHeight: 200, overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: tc.tableHeaderBg, position: 'sticky', top: 0 }}>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>
                            <Checkbox
                              checked={filteredGeneralRFQParts.length > 0 && filteredGeneralRFQParts.every(p => selectedGeneralRFQParts.has(p.id))}
                              indeterminate={filteredGeneralRFQParts.some(p => selectedGeneralRFQParts.has(p.id)) && !filteredGeneralRFQParts.every(p => selectedGeneralRFQParts.has(p.id))}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const newSelected = new Set(selectedGeneralRFQParts)
                                  filteredGeneralRFQParts.forEach(part => newSelected.add(part.id))
                                  setSelectedGeneralRFQParts(newSelected)
                                } else {
                                  const newSelected = new Set(selectedGeneralRFQParts)
                                  filteredGeneralRFQParts.forEach(part => newSelected.delete(part.id))
                                  setSelectedGeneralRFQParts(newSelected)
                                }
                              }}
                            />
                          </th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Part Number</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Rev</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Description</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Type</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Vendor</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Current Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredGeneralRFQParts.map(part => {
                          const hasThumb = hasThumbnail(part.thumbnail)
                          return (
                            <tr key={part.id} style={{ borderBottom: '1px solid #eee' }}>
                              <td style={{ padding: '8px' }}>
                                <Checkbox
                                  checked={selectedGeneralRFQParts.has(part.id)}
                                  onChange={() => handleGeneralRFQPartToggle(part.id)}
                                />
                              </td>
                              <td style={{ padding: '8px' }}>
                                <Tooltip
                                  title={
                                    hasThumb ? (
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
                                  <span style={{ cursor: hasThumb ? 'pointer' : 'default' }}>
                                    {part.part_number || 'N/A'}
                                  </span>
                                </Tooltip>
                              </td>
                              <td style={{ padding: '8px' }}>{part.revision || '-'}</td>
                              <td style={{ padding: '8px' }}>{part.description || 'N/A'}</td>
                              <td style={{ padding: '8px' }}>{part.part_type || 'Unknown'}</td>
                              <td style={{ padding: '8px' }}>{part.vendor || '-'}</td>
                              <td style={{ padding: '8px' }}>${formatPrice(part.unit_cost || 0)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {filteredGeneralRFQParts.length === 0 && (
                      <Box sx={{ textAlign: 'center', py: 4 }}>
                        <Typography variant="body2" color="text.secondary">
                          No parts found
                        </Typography>
                      </Box>
                    )}
                  </Paper>
                )}
                {selectedGeneralRFQParts.size > 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                    {selectedGeneralRFQParts.size} part(s) selected
                  </Typography>
                )}
              </Box>
            )}

            {generalRFQStep === 2 && (
              <Box>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Select BOMs to calculate per-BOM quantities for your {selectedGeneralRFQParts.size} selected part(s). You can edit order quantities before creating the RFQ.
                </Alert>

                {/* BOM Selection */}
                <Typography variant="subtitle2" gutterBottom>Select BOMs:</Typography>

                {/* Badge filter chips */}
                {projectBadges.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                    <Chip
                      label="All"
                      size="small"
                      onClick={() => setGeneralRFQBomBadgeFilter(null)}
                      sx={{
                        fontWeight: 600, fontSize: '0.7rem', height: 24,
                        bgcolor: !generalRFQBomBadgeFilter ? 'primary.main' : 'action.selected',
                        color: !generalRFQBomBadgeFilter ? 'white' : 'text.primary',
                        '&:hover': { bgcolor: !generalRFQBomBadgeFilter ? 'primary.dark' : 'action.hover' },
                      }}
                    />
                    {projectBadges.map(badge => (
                      <Chip
                        key={badge.id}
                        label={badge.name}
                        size="small"
                        onClick={() => setGeneralRFQBomBadgeFilter(badge.id)}
                        sx={{
                          fontWeight: 500, fontSize: '0.7rem', height: 24,
                          bgcolor: generalRFQBomBadgeFilter === badge.id ? (badge.color || '#6c757d') : 'action.selected',
                          color: generalRFQBomBadgeFilter === badge.id ? 'white' : 'text.primary',
                          '&:hover': {
                            bgcolor: generalRFQBomBadgeFilter === badge.id ? (badge.color || '#6c757d') : 'action.hover',
                            opacity: generalRFQBomBadgeFilter === badge.id ? 0.85 : 1,
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
                  value={generalRFQBomSearchTerm}
                  onChange={(e) => setGeneralRFQBomSearchTerm(e.target.value)}
                  sx={{ mb: 1 }}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  }}
                />
                <Paper sx={{ maxHeight: 200, overflow: 'auto', mb: 2 }}>
                  {generalRFQBomList
                    .filter(bom => {
                      if (generalRFQBomBadgeFilter && bom.badge_id !== generalRFQBomBadgeFilter) return false
                      if (!generalRFQBomSearchTerm.trim()) return true
                      const search = generalRFQBomSearchTerm.toLowerCase()
                      const name = (bom.assembly_part_number || bom.name || '').toLowerCase()
                      const desc = (bom.name || '').toLowerCase()
                      return name.includes(search) || desc.includes(search)
                    })
                    .map(bom => (
                      <Box key={bom.id} sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5, borderBottom: '1px solid #eee' }}>
                        <Checkbox
                          size="small"
                          checked={selectedGeneralRFQBoms.has(bom.id)}
                          onChange={() => {
                            const newSet = new Set(selectedGeneralRFQBoms)
                            if (newSet.has(bom.id)) newSet.delete(bom.id)
                            else newSet.add(bom.id)
                            setSelectedGeneralRFQBoms(newSet)
                          }}
                        />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {bom.assembly_part_number || bom.name} {bom.assembly_revision ? `(${bom.assembly_revision})` : ''}
                          </Typography>
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

                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleGeneralRFQCalculateBreakdown}
                  disabled={selectedGeneralRFQBoms.size === 0 || loadingBreakdown}
                  startIcon={loadingBreakdown ? <CircularProgress size={16} /> : null}
                  sx={{ mb: 2 }}
                >
                  {loadingBreakdown ? 'Calculating...' : 'Calculate Quantities'}
                </Button>

                {/* Breakdown Table */}
                {generalRFQBreakdown.length > 0 && (
                  <Paper sx={{ maxHeight: '40vh', overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: tc.tableHeaderBg, position: 'sticky', top: 0, zIndex: 1 }}>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Part Number</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Description</th>
                          {generalRFQBomsUsed.map(bom => (
                            <th key={bom.id} style={{ padding: '8px', textAlign: 'center', borderBottom: '2px solid #ddd', color: tc.tableHeaderText, fontSize: '0.75rem' }}>
                              {bom.name}
                            </th>
                          ))}
                          <th style={{ padding: '8px', textAlign: 'center', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Total</th>
                          <th style={{ padding: '8px', textAlign: 'center', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Order Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {generalRFQBreakdown.map(part => (
                          <tr key={part.part_id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '8px' }}>{part.part_number}</td>
                            <td style={{ padding: '8px', fontSize: '0.85rem' }}>{part.description}</td>
                            {generalRFQBomsUsed.map(bom => {
                              const entry = part.bom_breakdown.find(b => b.bom_id === bom.id)
                              return (
                                <td key={bom.id} style={{ padding: '8px', textAlign: 'center' }}>
                                  {entry ? entry.qty : '-'}
                                </td>
                              )
                            })}
                            <td style={{ padding: '8px', textAlign: 'center', fontWeight: 600 }}>{part.total_qty}</td>
                            <td style={{ padding: '8px', textAlign: 'center' }}>
                              <TextField
                                size="small"
                                type="number"
                                value={generalRFQOrderQtys[part.part_id] ?? part.total_qty}
                                onChange={(e) => setGeneralRFQOrderQtys(prev => ({
                                  ...prev,
                                  [part.part_id]: parseInt(e.target.value) || 0
                                }))}
                                sx={{ width: 80 }}
                                inputProps={{ min: 0, style: { textAlign: 'center' } }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Paper>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setShowGeneralRFQModal(false)
                setGeneralRFQStep(0)
                setSelectedGeneralRFQTypes([])
                setSelectedGeneralRFQParts(new Set())
                setGeneralRFQSearchTerm('')
                setGeneralRFQName('')
                setGeneralRFQPartsList([])
                setFilteredGeneralRFQParts([])
              }} 
              disabled={creatingRFQ}
            >
              Cancel
            </Button>
            {generalRFQStep === 0 && (
              <Button
                onClick={handleGeneralRFQContinueToParts}
                variant="contained"
                disabled={creatingRFQ || selectedGeneralRFQTypes.length === 0 || loadingGeneralRFQParts}
                startIcon={loadingGeneralRFQParts ? <CircularProgress size={16} /> : <DescriptionIcon />}
              >
                {loadingGeneralRFQParts ? 'Loading...' : 'Select Parts →'}
              </Button>
            )}
            {generalRFQStep === 1 && (
              <>
                <Button
                  onClick={handleGeneralRFQContinueToBoms}
                  variant="outlined"
                  disabled={creatingRFQ || selectedGeneralRFQParts.size === 0}
                >
                  BOM Qty Breakdown
                </Button>
                <Button
                  onClick={handleGeneralRFQCreate}
                  variant="contained"
                  disabled={creatingRFQ || selectedGeneralRFQParts.size === 0}
                  startIcon={creatingRFQ ? <CircularProgress size={16} /> : <DescriptionIcon />}
                >
                  {creatingRFQ ? 'Analyzing...' : 'Analyze Files →'}
                </Button>
              </>
            )}
            {generalRFQStep === 2 && (
              <Button
                onClick={handleGeneralRFQCreate}
                variant="contained"
                disabled={creatingRFQ || selectedGeneralRFQParts.size === 0}
                startIcon={creatingRFQ ? <CircularProgress size={16} /> : <DescriptionIcon />}
              >
                {creatingRFQ ? 'Analyzing...' : 'Analyze Files →'}
              </Button>
            )}
          </DialogActions>
        </ResizableDialog>

        {/* ECO Modal */}
        <ResizableDialog id="ecoModal" open={showECOModal} onClose={() => !submittingECO && setShowECOModal(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Alert severity="warning" sx={{ mr: 1 }} />
              ECO Required - Revision Changes Detected
            </Box>
          </DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              <strong>Revision changes detected!</strong> The following parts have been updated in PDM.
              Please provide ECO information for each changed part.
            </Alert>
            {revisionChanges.map((change, index) => (
              <Card key={index} sx={{ mb: 1.5 }}>
                <CardHeader
                  title={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PartThumbnailHover
                        partNumber={change.part_number}
                        thumbnail={change.thumbnail}
                        variant="h6"
                      />
                      <Chip
                        label={`${change.old_revision} → ${change.new_revision}`}
                        color="warning"
                        size="small"
                      />
                    </Box>
                  }
                />
                <CardContent>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* ECO Number */}
                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        ECO Number <span style={{ color: 'red' }}>*</span>
                      </Typography>
                      <TextField
                        fullWidth
                        placeholder="Auto-filled ECO number"
                        required
                        value={ecoData[`eco_number_${index}`] || ''}
                        disabled={true}
                        variant="outlined"
                        helperText="ECO number is automatically assigned"
                      />
                    </Box>

                    {/* Backward Compatible */}
                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        Backward Compatible <span style={{ color: 'red' }}>*</span>
                      </Typography>
                      <ToggleButtonGroup
                        value={ecoData[`backward_compatible_${index}`] ?? ''}
                        exclusive
                        onChange={(e, newValue) => {
                          if (newValue !== null) {
                            setEcoData({ ...ecoData, [`backward_compatible_${index}`]: newValue })
                          }
                        }}
                        disabled={submittingECO}
                        fullWidth
                        size="small"
                      >
                        <ToggleButton value="true" sx={{ flex: 1, '&.Mui-selected': { bgcolor: 'success.main', color: 'white', '&:hover': { bgcolor: 'success.dark' } } }}>
                          Yes
                        </ToggleButton>
                        <ToggleButton value="false" sx={{ flex: 1, '&.Mui-selected': { bgcolor: 'warning.main', color: 'white', '&:hover': { bgcolor: 'warning.dark' } } }}>
                          No
                        </ToggleButton>
                      </ToggleButtonGroup>
                    </Box>

                    {/* ECO Description */}
                    <Box>
                      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                        ECO Description <span style={{ color: 'red' }}>*</span>
                      </Typography>
                      <TextField
                        fullWidth
                        placeholder="Enter ECO description"
                        required
                        multiline
                        rows={4}
                        value={ecoData[`eco_description_${index}`] || ''}
                        onChange={(e) => setEcoData({ ...ecoData, [`eco_description_${index}`]: e.target.value })}
                        disabled={submittingECO}
                        variant="outlined"
                      />
                    </Box>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowECOModal(false)} disabled={submittingECO}>
              Cancel Update
            </Button>
            <Button
              onClick={handleSubmitECO}
              variant="contained"
              color="primary"
              disabled={submittingECO}
              startIcon={submittingECO ? <CircularProgress size={16} /> : <UploadIcon />}
            >
              {submittingECO ? 'Submitting...' : 'Submit ECO & Update BOM'}
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* Sheet RFQ - URL Input Dialog */}
        <ResizableDialog
          id="sheetRFQUrl"
          open={showSheetRFQURLDialog}
          onClose={() => !parsingSheet && setShowSheetRFQURLDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <LinkIcon />
              Sheet RFQ - Paste Google Sheets URL
            </Box>
          </DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
              Paste a link to a Google Sheet containing Part Numbers and Quantities.
              The sheet must be shared with the service account.
            </Alert>
            <TextField
              fullWidth
              label="Google Sheets URL"
              value={sheetRFQUrl}
              onChange={(e) => setSheetRFQUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              disabled={parsingSheet}
              sx={{ mt: 1 }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => {
              setShowSheetRFQURLDialog(false)
              setSheetRFQUrl('')
            }} disabled={parsingSheet}>
              Cancel
            </Button>
            <Button
              onClick={handleSheetRFQParse}
              variant="contained"
              color="primary"
              disabled={parsingSheet || !sheetRFQUrl.trim()}
              startIcon={parsingSheet ? <CircularProgress size={16} /> : <SearchIcon />}
            >
              {parsingSheet ? 'Reading Sheet...' : 'Parse Sheet'}
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* Sheet RFQ - Review/Matching Dialog */}
        <ResizableDialog
          id="sheetRFQReview"
          open={showSheetRFQReviewDialog}
          onClose={() => !creatingRFQ && setShowSheetRFQReviewDialog(false)}
          maxWidth="lg"
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <DescriptionIcon />
              Sheet RFQ - Review Parts
            </Box>
          </DialogTitle>
          <DialogContent>
            {sheetRFQDetectedColumns && (
              <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
                Detected columns: Part Number = "{sheetRFQDetectedColumns.part_number || 'N/A'}"
                {sheetRFQDetectedColumns.qty && `, QTY = "${sheetRFQDetectedColumns.qty}"`}
                {sheetRFQDetectedColumns.revision && `, Revision = "${sheetRFQDetectedColumns.revision}"`}
              </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Typography variant="body2">
                <strong>Matched:</strong> {sheetRFQMatchedParts.length}
              </Typography>
              <Typography variant="body2" color="error">
                <strong>Unmatched:</strong> {sheetRFQUnmatchedParts.length}
              </Typography>
            </Box>

            {sheetRFQUnmatchedParts.length > 0 && (
              <Box sx={{ mb: 1.5 }}>
                <Alert severity="error" sx={{ mb: 1 }}>
                  The following parts were not found in the database. Remove them all to proceed.
                </Alert>
                <Paper sx={{ maxHeight: '35vh', overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, backgroundColor: tc.errorHeaderBg, zIndex: 1 }}>
                      <tr>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Part Number</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Sheet Revision</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>QTY</th>
                        <th style={{ padding: '8px', textAlign: 'center', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheetRFQUnmatchedParts.map((part, idx) => (
                        <tr key={idx} style={{ backgroundColor: tc.errorRowBg, borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px' }}>{part.part_number}</td>
                          <td style={{ padding: '8px' }}>{part.revision || '-'}</td>
                          <td style={{ padding: '8px' }}>{part.qty}</td>
                          <td style={{ padding: '8px', textAlign: 'center' }}>
                            <IconButton size="small" color="error" onClick={() => handleSheetRFQRemoveUnmatched(idx)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Paper>
              </Box>
            )}

            <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
              Matched Parts ({sheetRFQMatchedParts.length})
            </Typography>
            <Paper sx={{ maxHeight: '50vh', overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, backgroundColor: tc.tableHeaderBg, zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Part Number</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Revision</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Description</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>State</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Type</th>
                    <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>QTY</th>
                    <th style={{ padding: '8px', textAlign: 'center', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Remove</th>
                  </tr>
                </thead>
                <tbody>
                  {sheetRFQMatchedParts.map((part, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px' }}>{part.part_number}</td>
                      <td style={{ padding: '8px' }}>{part.revision}</td>
                      <td style={{ padding: '8px' }}>{part.description}</td>
                      <td style={{ padding: '8px' }}>{part.state}</td>
                      <td style={{ padding: '8px' }}>{part.part_type}</td>
                      <td style={{ padding: '8px' }}>
                        <TextField
                          type="number"
                          size="small"
                          value={part.qty}
                          onChange={(e) => handleSheetRFQUpdateQty(idx, e.target.value)}
                          inputProps={{ min: 1, style: { width: 60, textAlign: 'center' } }}
                          sx={{ '& .MuiInputBase-input': { py: 0.5 } }}
                        />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <IconButton size="small" onClick={() => handleSheetRFQRemoveMatched(idx)}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Paper>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => {
              setShowSheetRFQReviewDialog(false)
              setSheetRFQMatchedParts([])
              setSheetRFQUnmatchedParts([])
              setSheetRFQDetectedColumns(null)
            }} disabled={creatingRFQ}>
              Cancel
            </Button>
            <Button
              onClick={handleSheetRFQCreate}
              variant="contained"
              color="success"
              disabled={creatingRFQ || sheetRFQUnmatchedParts.length > 0 || sheetRFQMatchedParts.length === 0}
              startIcon={creatingRFQ ? <CircularProgress size={16} /> : <UploadIcon />}
            >
              {creatingRFQ ? 'Analyzing...' : `Create RFQ (${sheetRFQMatchedParts.length} parts)`}
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* RFQ File Status Modal */}
        <ResizableDialog
          id="rfqFileStatus"
          open={showRFQFileStatusModal}
          onClose={() => {
            if (!creatingRFQ && !refreshingRFQStatus) {
              setShowRFQFileStatusModal(false)
              // Don't clear removedRFQParts or customRFQName when closing - preserve state for reopening
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
                <Grid container spacing={2} sx={{ mb: 1.5, flexShrink: 0 }}>
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

                <Box sx={{ mb: 1.5, flexShrink: 0 }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={handleOpenAddPartsToRFQ}
                    disabled={creatingRFQ}
                  >
                    + Add Extra Parts
                  </Button>
                </Box>

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

                <Alert severity="info" sx={{ mb: 2, flexShrink: 0 }}>
                  <strong>Note:</strong> Select parts from the BOM table above before creating RFQ. Only parts with "Complete" status can be exported.
                </Alert>
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
                          part.state === 'Editing' ? 'warning' :
                          part.state === 'Manual Add' ? 'info' : 'default'
                        const hasThumb = hasThumbnail(part.thumbnail)
                        // Calculate total qty: original * multiplier + custom
                        const originalQty = parseFloat(part.qty) || 0
                        const exportGlobalMultiplier = rfqFileStatus?.metadata?.global_multiplier || globalMultiplier
                        // Use customQuantities state (always up-to-date) over metadata (stale from 2nd modal)
                        const metadataCustomQtys = rfqFileStatus?.metadata?.custom_quantities
                        const exportCustomQuantities = (metadataCustomQtys && Object.keys(metadataCustomQtys).length > 0)
                          ? metadataCustomQtys
                          : customQuantities
                        const customQty = exportCustomQuantities[partKey] || 0

                        // Check if multiplier was already applied during consolidation
                        // If multiplier_mode is 'general' and global_multiplier exists in metadata,
                        // the quantities in part.qty already have the multiplier applied from consolidateBOMsWithMultipliers
                        const multiplierMode = rfqFileStatus?.metadata?.multiplier_mode
                        const isMultiBOM = rfqFileStatus?.metadata?.is_multi_bom
                        const multiplierAlreadyApplied = isMultiBOM && multiplierMode === 'general' && rfqFileStatus?.metadata?.global_multiplier

                        // If multiplier was already applied, don't multiply again (only add custom qty)
                        // Otherwise, multiply by the current global multiplier
                        const totalQty = multiplierAlreadyApplied
                          ? originalQty + customQty
                          : (originalQty * exportGlobalMultiplier) + customQty

                        return (
                          <tr key={partKey} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '8px' }}>
                              <Tooltip
                                title={
                                  hasThumb ? (
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
                                <span style={{ cursor: hasThumb ? 'pointer' : 'default' }}>
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
                                label={part.x_t_status || 'N/A'}
                                color={part.x_t_status === 'Complete' ? 'success' : part.x_t_status === 'N/A' || !part.x_t_status ? 'default' : 'error'}
                                size="small"
                              />
                            </td>
                            <td style={{ padding: '8px' }}>
                              <Chip
                                label={part.pdf_status || 'N/A'}
                                color={part.pdf_status === 'Complete' ? 'success' : part.pdf_status === 'N/A' || !part.pdf_status ? 'default' : 'error'}
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
              Continue to Export →
              {selectedRFQParts.size > 0 && ` (${selectedRFQParts.size} selected)`}
            </Button>
            <Button
              onClick={() => {
                setShowRFQFileStatusModal(false)
                // Don't clear removedRFQParts or customRFQName when closing - preserve state for reopening
              }}
              disabled={creatingRFQ || refreshingRFQStatus}
            >
              Close
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* Quantity Multiplication Modal */}
        <ResizableDialog
          id="quantityModal"
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
            {/* Multiplier Mode Selection - Only show for multi-BOM flow (when pendingBOMData exists) */}
            {pendingBOMData && (
              <Box sx={{ mb: 1.5 }}>
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
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
                  BOM Multipliers
                </Typography>
                <Paper sx={{ p: 2, maxHeight: '30vh', minHeight: 100, overflow: 'auto' }}>
                  {pendingBOMData.bomIds.map((bomId, index) => {
                    const bom = boms.find(b => b.id === bomId)
                    return (
                      <Box key={bomId} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Typography variant="body2" sx={{ minWidth: 200 }}>
                          {bom?.name || `BOM ${bomId}`}
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
              // Show global multiplier input only in second modal (when pendingBOMData exists)
              <Grid container spacing={2} sx={{ mb: 1.5 }}>
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
              <Box sx={{ mb: 1.5 }}>
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

                        // Check if multiplier was already applied during consolidation
                        const multiplierMode = rfqFileStatus?.metadata?.multiplier_mode
                        const isMultiBOM = rfqFileStatus?.metadata?.is_multi_bom
                        const multiplierAlreadyApplied = isMultiBOM && multiplierMode === 'general' && rfqFileStatus?.metadata?.global_multiplier
                        const originalMultiplier = rfqFileStatus?.metadata?.global_multiplier || 1
                        const originalCustomQty = (rfqFileStatus?.metadata?.custom_quantities || {})[partKey] || 0
                        
                        // If multiplier was already applied, extract base quantity
                        // Otherwise, use part.qty as base
                        const qtyFromBackend = parseFloat(part.qty) || 0
                        const baseQty = multiplierAlreadyApplied && originalMultiplier > 0
                          ? (qtyFromBackend - originalCustomQty) / originalMultiplier
                          : qtyFromBackend
                        
                        const originalQty = baseQty
                        const multipliedQty = originalQty * globalMultiplier
                        const customQtyAdd = customQuantities[partKey] || 0
                        const totalQty = multipliedQty + customQtyAdd

                        const hasThumb = hasThumbnail(part.thumbnail)

                        return (
                          <tr key={partKey} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '8px' }}>
                              <Tooltip
                                title={
                                  hasThumb ? (
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
                                <span style={{ cursor: hasThumb ? 'pointer' : 'default' }}>
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
                                  // Allow negative values (to decrease qty) but cap so total >= 0
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
                                    // Calculate the custom qty needed to reach this total
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
                  // Multi-BOM flow: process with multipliers and show RFQ file status
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

                  // Proceed with export (handleExportRFQ will show name modal if name not set)
                  setShowQuantityModal(false)
                  handleExportRFQ()
                }
              }}
              variant="contained"
              color="success"
              disabled={creatingRFQ}
              startIcon={creatingRFQ ? <CircularProgress size={16} /> : <UploadIcon />}
            >
              {pendingBOMData
                ? (creatingRFQ ? 'Analyzing...' : 'Analyze Files →')
                : (creatingRFQ ? 'Processing...' : 'Enter Name & Export →')
              }
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* Multi-BOM Selection Modal */}
        <ResizableDialog id="multiBOMModal" open={showMultiBOMModal} onClose={() => { setShowMultiBOMModal(false); window.standardRFQMultiBOM = false }} maxWidth="md" fullWidth>
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <InvoiceIcon />
              Select BOMs for Multi-BOM RFQ
            </Box>
          </DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>
              Select one or more BOMs to create a combined RFQ. You can choose specific parts from each BOM after analysis.
            </Alert>
            <Paper sx={{ maxHeight: '55vh', overflow: 'auto' }}>
              <List>
                {boms.map((bom) => {
                  const isSelected = selectedBOMIds.has(bom.id)
                  return (
                    <ListItem key={bom.id} disablePadding>
                      <ListItemButton
                        onClick={() => {
                          const newSelected = new Set(selectedBOMIds)
                          if (isSelected) {
                            newSelected.delete(bom.id)
                          } else {
                            newSelected.add(bom.id)
                          }
                          setSelectedBOMIds(newSelected)
                        }}
                      >
                        <Checkbox checked={isSelected} />
                        <ListItemText
                          primary={bom.name}
                          secondary={`Version: ${bom.version || 'N/A'}`}
                        />
                      </ListItemButton>
                    </ListItem>
                  )
                })}
              </List>
            </Paper>
            {selectedBOMIds.size > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {selectedBOMIds.size} BOM(s) selected
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => {
              setShowMultiBOMModal(false)
              setSelectedBOMIds(new Set())
              window.standardRFQMultiBOM = false // Stale flag would misroute the next Mechanical RFQ
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleProcessMultiBOMRFQ}
              variant="contained"
              disabled={selectedBOMIds.size === 0}
            >
              Set Quantities →
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* Export Dialog */}
        <ResizableDialog id="exportDialog" open={showExportDialog} onClose={() => !exporting && setShowExportDialog(false)} maxWidth="md" fullWidth>
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <DownloadIcon />
              {exportDialogType === 'excel' ? 'Export to Excel' : 'Export to Google Sheets'}
            </Box>
          </DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>
              Select one or more BOMs to export. Parts with the same part number and revision will be consolidated.
            </Alert>
            
            <TextField
              fullWidth
              label="Export Name"
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              placeholder="Enter name for exported BOM"
              sx={{ mb: 2 }}
              disabled={exporting}
            />

            <FormControl component="fieldset" sx={{ mb: 2 }}>
              <FormLabel component="legend">Export Type</FormLabel>
              <RadioGroup
                row
                value={exportDialogType}
                onChange={(e) => setExportDialogType(e.target.value)}
                disabled={exporting}
              >
                <FormControlLabel value="excel" control={<Radio />} label="Excel (with thumbnails)" />
                <FormControlLabel value="sheets" control={<Radio />} label="Google Sheets (no thumbnails)" />
              </RadioGroup>
            </FormControl>

            <FormControlLabel
              control={
                <Checkbox
                  checked={dissolveAssemblies}
                  onChange={(e) => setDissolveAssemblies(e.target.checked)}
                  disabled={exporting}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">Dissolve assemblies</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Expand assemblies with BOM IDs (no children) into their parts
                  </Typography>
                </Box>
              }
              sx={{ mb: 2 }}
            />

            <Typography variant="subtitle2" gutterBottom>
              Select BOMs to Export:
            </Typography>
            <Paper sx={{ maxHeight: '55vh', overflow: 'auto' }}>
              <List>
                {boms.map((bom) => {
                  const isSelected = exportSelectedBOMIds.has(bom.id)
                  const multiplier = exportBomMultipliers[bom.id] ?? 1
                  return (
                    <ListItem key={bom.id} disablePadding secondaryAction={
                      user?.role === 'admin' && isSelected ? (
                        <TextField
                          type="number"
                          size="small"
                          label="×"
                          value={multiplier}
                          onChange={(e) => {
                            const val = Math.max(1, parseInt(e.target.value, 10) || 1)
                            setExportBomMultipliers(prev => ({ ...prev, [bom.id]: val }))
                          }}
                          onClick={(e) => e.stopPropagation()}
                          inputProps={{ min: 1, style: { width: 50 } }}
                          disabled={exporting}
                          sx={{ mr: 1 }}
                        />
                      ) : null
                    }>
                      <ListItemButton
                        onClick={() => {
                          if (exporting) return
                          const newSelected = new Set(exportSelectedBOMIds)
                          if (isSelected) {
                            newSelected.delete(bom.id)
                          } else {
                            newSelected.add(bom.id)
                          }
                          setExportSelectedBOMIds(newSelected)
                        }}
                        disabled={exporting}
                      >
                        <Checkbox checked={isSelected} disabled={exporting} />
                        <ListItemText
                          primary={bom.name}
                          secondary={`Version: ${bom.version || 'N/A'}`}
                        />
                      </ListItemButton>
                    </ListItem>
                  )
                })}
              </List>
            </Paper>
            {exportSelectedBOMIds.size > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {exportSelectedBOMIds.size} BOM(s) selected
                {user?.role === 'admin' && ' — set × to multiply quantities per BOM'}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => {
              if (!exporting) {
                setShowExportDialog(false)
                setExportSelectedBOMIds(new Set())
                setExportName('')
                setDissolveAssemblies(false)
                setExportBomMultipliers({})
              }
            }} disabled={exporting}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (exportSelectedBOMIds.size === 0) {
                  showNotification('Please select at least one BOM', 'warning')
                  return
                }
                
                setExporting(true)
                try {
                  const bomIds = Array.from(exportSelectedBOMIds)
                  const multipliers = Object.fromEntries(
                    bomIds.map(id => [id, exportBomMultipliers[id] ?? 1])
                  )

                  if (exportDialogType === 'excel') {
                    const response = await bomService.exportMultipleBOMsToExcel(bomIds, exportName, dissolveAssemblies, multipliers)
                    const blob = new Blob([response.data], {
                      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    })
                    const url = window.URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url
                    const sanitizeName = (name) => {
                      const safe = (name || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_') || 'consolidated_bom'
                      return safe.toLowerCase().endsWith('.xlsx') ? safe : `${safe}.xlsx`
                    }
                    link.download = sanitizeName(exportName || 'consolidated_bom')
                    document.body.appendChild(link)
                    link.click()
                    document.body.removeChild(link)
                    window.URL.revokeObjectURL(url)
                    showNotification('BOM exported to Excel', 'success')
                  } else {
                    const response = await bomService.exportMultipleBOMsToSheets(bomIds, exportName, dissolveAssemblies, multipliers)
                    if (response.data.success) {
                      showNotification('BOM exported to Google Sheets', 'success')
                      if (response.data.spreadsheet_url) {
                        window.open(response.data.spreadsheet_url, '_blank', 'noopener,noreferrer')
                      }
                    } else {
                      throw new Error(response.data.error || 'Export failed')
                    }
                  }

                  setShowExportDialog(false)
                  setExportSelectedBOMIds(new Set())
                  setExportName('')
                  setDissolveAssemblies(false)
                  setExportBomMultipliers({})
                } catch (error) {
                  let message = exportDialogType === 'excel' ? 'Error exporting to Excel' : 'Error exporting to Google Sheets'
                  if (error.response?.data?.error) {
                    message = error.response.data.error
                  } else if (error.message) {
                    message = error.message
                  }
                  showNotification(message, 'error')
                } finally {
                  setExporting(false)
                }
              }}
              variant="contained"
              disabled={exportSelectedBOMIds.size === 0 || exporting}
            >
              {exporting ? 'Exporting...' : 'Export'}
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* Add Extra Parts to RFQ Dialog */}
        <ResizableDialog
          id="addPartsToRFQ"
          open={showAddPartsToRFQModal}
          onClose={() => setShowAddPartsToRFQModal(false)}
          maxWidth="lg"
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              Add Extra Parts to RFQ
            </Box>
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select part types to browse, then pick individual parts to add. Added parts default to qty 1 (adjustable in the Quantity modal).
            </Typography>
            {/* Type chips */}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              {addPartsRFQTypes.map(type => (
                <Chip
                  key={type}
                  label={type}
                  clickable
                  color={addPartsRFQSelectedTypes.includes(type) ? 'primary' : 'default'}
                  onClick={() => handleAddPartsRFQTypeToggle(type)}
                />
              ))}
            </Box>
            {/* Search */}
            {addPartsRFQList.length > 0 && (
              <TextField
                label="Search Parts"
                value={addPartsRFQSearchTerm}
                onChange={(e) => handleAddPartsRFQSearch(e.target.value)}
                placeholder="Search by part number or description"
                fullWidth
                sx={{ mb: 2 }}
                InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }}
              />
            )}
            {loadingAddPartsRFQ ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <Paper sx={{ maxHeight: '50vh', overflow: 'auto' }}>
                {filteredAddPartsRFQList.length > 0 ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: tc.tableHeaderBg, position: 'sticky', top: 0 }}>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>
                          <Checkbox
                            checked={filteredAddPartsRFQList.length > 0 && filteredAddPartsRFQList.every(p => selectedAddParts.has(p.id))}
                            indeterminate={filteredAddPartsRFQList.some(p => selectedAddParts.has(p.id)) && !filteredAddPartsRFQList.every(p => selectedAddParts.has(p.id))}
                            onChange={(e) => {
                              const newSel = new Set(selectedAddParts)
                              filteredAddPartsRFQList.forEach(p => e.target.checked ? newSel.add(p.id) : newSel.delete(p.id))
                              setSelectedAddParts(newSel)
                            }}
                          />
                        </th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Part Number</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Rev</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Description</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Type</th>
                        <th style={{ padding: '8px', textAlign: 'left', borderBottom: '2px solid #ddd', color: tc.tableHeaderText }}>Vendor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAddPartsRFQList.map(part => (
                        <tr key={part.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '8px' }}>
                            <Checkbox
                              checked={selectedAddParts.has(part.id)}
                              onChange={() => {
                                const newSel = new Set(selectedAddParts)
                                selectedAddParts.has(part.id) ? newSel.delete(part.id) : newSel.add(part.id)
                                setSelectedAddParts(newSel)
                              }}
                            />
                          </td>
                          <td style={{ padding: '8px' }}>{part.part_number || 'N/A'}</td>
                          <td style={{ padding: '8px' }}>{part.revision || '-'}</td>
                          <td style={{ padding: '8px' }}>{part.description || 'N/A'}</td>
                          <td style={{ padding: '8px' }}>{part.part_type || 'Unknown'}</td>
                          <td style={{ padding: '8px' }}>{part.vendor || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : addPartsRFQSelectedTypes.length > 0 ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">No parts found</Typography>
                  </Box>
                ) : (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography variant="body2" color="text.secondary">Select a part type above to browse parts</Typography>
                  </Box>
                )}
              </Paper>
            )}
            {selectedAddParts.size > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {selectedAddParts.size} part(s) selected
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowAddPartsToRFQModal(false)} disabled={loadingAddPartsRFQ}>Cancel</Button>
            <Button
              onClick={handleConfirmAddPartsToRFQ}
              variant="contained"
              disabled={selectedAddParts.size === 0 || loadingAddPartsRFQ}
              startIcon={loadingAddPartsRFQ ? <CircularProgress size={16} /> : null}
            >
              {loadingAddPartsRFQ
                ? 'Checking PDM Status...'
                : `Add ${selectedAddParts.size > 0 ? `${selectedAddParts.size} Part(s)` : 'Parts'} to RFQ`}
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* RFQ Name Modal */}
        <ResizableDialog id="rfqNameModal" open={showRFQNameModal} onClose={() => !creatingRFQ && setShowRFQNameModal(false)} maxWidth="sm" fullWidth>
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
              placeholder="e.g. Driver Jigs Q2 2026"
              disabled={creatingRFQ}
              autoFocus
              inputProps={{ maxLength: 50 }}
              helperText={`${customRFQName.length}/50 characters — keep it short and descriptive`}
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
                // Auto-proceed to export after entering name
                setShowRFQNameModal(false)
                // If we have rfqFileStatus, proceed directly to export
                if (rfqFileStatus) {
                  await handleExportRFQ()
                } else {
                  // Otherwise show quantity modal
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

        {/* Version Info Modal */}
        <ResizableDialog
          open={showVersionInfoModal}
          onClose={() => setShowVersionInfoModal(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <InfoIcon />
              BOM Version Information
            </Box>
          </DialogTitle>
          <DialogContent>
            {selectedVersionInfo && (
              <Box sx={{ mt: 2 }}>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary">Version</Typography>
                    <Typography variant="body1" fontWeight="medium">{selectedVersionInfo.version || selectedVersionInfo.version_number}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary">Import/Update Date</Typography>
                    <Typography variant="body1">
                      {selectedVersionInfo.created_at 
                        ? new Date(new Date(selectedVersionInfo.created_at).getTime() + 2 * 60 * 60 * 1000).toLocaleString() 
                        : 'N/A'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="subtitle2" color="text.secondary">Created By</Typography>
                    <Typography variant="body1">{selectedVersionInfo.created_by_name || 'Unknown'}</Typography>
                  </Grid>
                  {selectedVersionInfo.assembly_path && (
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" color="text.secondary">Assembly Path</Typography>
                      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{selectedVersionInfo.assembly_path}</Typography>
                    </Grid>
                  )}
                  {selectedVersionInfo.bom_layout && (
                    <Grid item xs={6}>
                      <Typography variant="subtitle2" color="text.secondary">BOM Layout</Typography>
                      <Typography variant="body1">{selectedVersionInfo.bom_layout}</Typography>
                    </Grid>
                  )}
                  {selectedVersionInfo.configuration && (
                    <Grid item xs={6}>
                      <Typography variant="subtitle2" color="text.secondary">Configuration</Typography>
                      <Typography variant="body1">{selectedVersionInfo.configuration}</Typography>
                    </Grid>
                  )}
                  {selectedVersionInfo.change_description && (
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" color="text.secondary">Change Description</Typography>
                      <Typography variant="body1">{selectedVersionInfo.change_description}</Typography>
                    </Grid>
                  )}
                  {selectedVersionInfo.change_type && (
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" color="text.secondary">Change Type</Typography>
                      <Typography variant="body1">{selectedVersionInfo.change_type}</Typography>
                    </Grid>
                  )}
                  {selectedVersionInfo.total_changes !== undefined && (
                    <Grid item xs={12}>
                      <Typography variant="subtitle2" color="text.secondary">Total Changes</Typography>
                      <Typography variant="body1">{selectedVersionInfo.total_changes}</Typography>
                    </Grid>
                  )}
                </Grid>
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowVersionInfoModal(false)}>Close</Button>
          </DialogActions>
        </ResizableDialog>

        {/* Export Success Modal */}
        <ResizableDialog
          id="exportSuccessModal"
          open={showExportSuccessModal}
          onClose={() => setShowExportSuccessModal(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle sx={{ bgcolor: 'success.main', color: 'white' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CheckCircleIcon />
              Export Complete
            </Box>
          </DialogTitle>
          <DialogContent sx={{ mt: 2 }}>
            <Alert severity="success" sx={{ mb: 1.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Export Successful!
              </Typography>
              <Typography>
                RFQ files have been exported successfully.
              </Typography>
            </Alert>

            {exportResult && (
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                    Files Created:
                  </Typography>
                  {exportResult.files_created && exportResult.files_created.length > 0 ? (
                    <List>
                      {exportResult.files_created.map((file, index) => (
                        <ListItem key={index} sx={{ px: 0 }}>
                          <FileIcon sx={{ mr: 1, color: 'text.secondary' }} />
                          <Typography variant="body2">{file}</Typography>
                        </ListItem>
                      ))}
                    </List>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No files listed
                    </Typography>
                  )}
                </Grid>

                <Grid item xs={12} md={6}>
                  <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                    Output Location:
                  </Typography>
                  {exportResult.output_path && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', bgcolor: 'grey.100', p: 1, borderRadius: 1, mb: 1 }}>
                        {exportResult.output_path}
                      </Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<FolderOpenIcon />}
                        onClick={() => {
                          // Copy path to clipboard
                          navigator.clipboard.writeText(exportResult.output_path)
                          showNotification('Folder path copied to clipboard', 'info')
                        }}
                      >
                        Copy Path
                      </Button>
                    </Box>
                  )}

                  {exportResult.google_drive && exportResult.google_drive.folder_url && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                        Google Drive Folder:
                      </Typography>
                      <Button
                        variant="contained"
                        color="primary"
                        startIcon={<LinkIcon />}
                        href={exportResult.google_drive.folder_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Folder in Google Drive
                      </Button>
                    </Box>
                  )}

                  {exportResult.google_drive && exportResult.google_drive.links && (
                    <Box>
                      <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                        Individual Files:
                      </Typography>
                      <List>
                        {Object.entries(exportResult.google_drive.links).map(([fileName, fileUrl]) => (
                          <ListItem key={fileName} sx={{ px: 0 }}>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={fileName.toLowerCase().endsWith('.zip') ? <ArchiveIcon /> : <FileIcon />}
                              href={fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              sx={{ textTransform: 'none' }}
                            >
                              {fileName}
                            </Button>
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  )}

                  {/* Direct file links for Excel and ZIP */}
                  {exportResult.files_created && exportResult.output_path && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                        Download Files:
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {exportResult.files_created
                          .filter(file => file.toLowerCase().endsWith('.xlsx') || file.toLowerCase().endsWith('.zip'))
                          .map((fileName, index) => {
                            // Construct file path for download
                            const filePath = `${exportResult.output_path}/${fileName}`

                            return (
                              <Button
                                key={index}
                                variant="contained"
                                color="primary"
                                startIcon={fileName.toLowerCase().endsWith('.zip') ? <ArchiveIcon /> : <FileIcon />}
                                onClick={() => {
                                  // Download file via API endpoint
                                  const downloadUrl = `/api/download-file?path=${encodeURIComponent(filePath)}`
                                  window.open(downloadUrl, '_blank')
                                }}
                                sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                              >
                                {fileName}
                              </Button>
                            )
                          })}
                      </Box>
                    </Box>
                  )}
                </Grid>
              </Grid>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowExportSuccessModal(false)} variant="contained" color="primary">
              Close
            </Button>
          </DialogActions>
        </ResizableDialog>
    </Box>
  )
}

export default AssemblyBOM
