import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  Box,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Grid,
  Checkbox,
  FormControlLabel,
  Tooltip,
  TablePagination,
  TableSortLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Collapse,
  Popover,
  Tab,
  Tabs,
  useTheme,
} from '@mui/material'
import {
  Visibility as ViewIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Receipt as POIcon,
  CheckCircle as CheckCircleIcon,
  Undo as UndoIcon,
  Upload as UploadIcon,
  FolderOpen as FolderOpenIcon,
  Link as LinkIcon,
  Archive as ArchiveIcon,
  InsertDriveFile as FileIcon,
  AttachMoney as MoneyIcon,
  Info as InfoIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Add as AddIcon,
  Search as SearchIcon,
  PictureAsPdf as PdfIcon,
  Article as ArticleIcon,
  CloudUpload as UploadDatasheetIcon,
  WarningAmber as WarningIcon,
  Email as EmailIcon,
  CompareArrows as CompareIcon,
  ContentCopy as DuplicateIcon,
} from '@mui/icons-material'
import { useNotification } from '../context/NotificationContext'
import DeliveryPerformanceDialog from '../components/DeliveryPerformanceDialog'
import { useAuth } from '../context/AuthContext'
import { rfqService } from '../services/rfqService'
import { bomCostService } from '../services/bomCostService'
import { bomService } from '../services/bomService'
import { adminService } from '../services/adminService'
import ResizableDialog from '../components/ResizableDialog'
import { formatPrice, formatPriceWithCurrency } from '../utils/priceFormatter'
import { getSemanticColors } from '../utils/themeColors'
import { hasThumbnail, getThumbnailSrc } from '../utils/thumbnail'

// Parse a quotation lead-time string into calendar days.
// Handles "30", "30 days", "4 weeks", "2 months", "10 business/working days"
// (5 working days ≈ 7 calendar days) and Hebrew units (ימים/שבועות/חודשים).
// Returns an integer number of days, or null when it can't be parsed.
export const parseLeadTimeToDays = (text) => {
  if (text == null) return null
  const s = String(text).trim().toLowerCase()
  if (!s) return null
  const m = s.match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n) || n <= 0) return null

  const isWeeks = /week|wk|שבוע/.test(s)
  const isMonths = /month|חודש/.test(s)
  const isBusinessDays = /(business|working|work)\s*days?|ימי\s*עסקים/.test(s)

  let days
  if (isWeeks) days = n * 7
  else if (isMonths) days = n * 30
  else if (isBusinessDays) days = (n / 5) * 7
  else days = n // plain number or "days"
  return Math.max(1, Math.round(days))
}

// Format (today + N days) as DD/MM/YYYY for the delivery-date suggestion
export const leadTimeToDateString = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const Purchases = () => {
  const theme = useTheme()
  const tc = getSemanticColors(theme)
  const { showNotification, liveVersions } = useNotification()
  const { user } = useAuth()
  const FINANCE_EMAIL = 'finance@menteebot.com'
  const [rfqs, setRfqs] = useState([])
  const [pos, setPos] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingPOs, setLoadingPOs] = useState(false)
  
  // RFQ Table Filters and Tabs
  const [rfqFilters, setRfqFilters] = useState({ user: '' })
  const [activeRFQTab, setActiveRFQTab] = useState('active')
  const [showAllRFQs, setShowAllRFQs] = useState(false)
  
  // PO Table Filters and Tabs
  const [poFilters, setPoFilters] = useState({ user: '', vendor: '' })
  const [activePOTab, setActivePOTab] = useState('pending')
  const [showAllPOs, setShowAllPOs] = useState(false)

  // PO Creation Modal State
  const [showPOCreationModal, setShowPOCreationModal] = useState(false)
  const [currentRFQId, setCurrentRFQId] = useState(null)
  const [poNumber, setPONumber] = useState('')
  const [vendor, setVendor] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [poLeadTime, setPOLeadTime] = useState('')
  const [quotationFiles, setQuotationFiles] = useState([])
  const [creatingPO, setCreatingPO] = useState(false)
  const [vendors, setVendors] = useState([])
  const [loadingVendors, setLoadingVendors] = useState(false)
  const [showVendorModal, setShowVendorModal] = useState(false)
  const [showDeliveryPerformance, setShowDeliveryPerformance] = useState(false)
  const [latePOCount, setLatePOCount] = useState(0)
  const [showVendorFormModal, setShowVendorFormModal] = useState(false)
  const [editingVendor, setEditingVendor] = useState(null)
  const [vendorForm, setVendorForm] = useState({ name: '', contact_name: '' })
  const [showReconcileModal, setShowReconcileModal] = useState(false)
  const [unmatchedVendors, setUnmatchedVendors] = useState([])
  const [canonicalVendors, setCanonicalVendors] = useState([])
  const [loadingUnmatched, setLoadingUnmatched] = useState(false)
  const [reconcileMappings, setReconcileMappings] = useState({})
  const [applyingRemap, setApplyingRemap] = useState(false)

  // PO Approvers
  const [poApprovers, setPoApprovers] = useState([])

  // Price Validation Modal State
  const [showPriceValidationModal, setShowPriceValidationModal] = useState(false)
  const [validationData, setValidationData] = useState(null)
  const [partsData, setPartsData] = useState([])
  const [excludedParts, setExcludedParts] = useState([])
  const [uploadingQuotations, setUploadingQuotations] = useState(false)
  const [additionalQuotationFiles, setAdditionalQuotationFiles] = useState([])
  const [dontUpdatePartCosts, setDontUpdatePartCosts] = useState(false)
  const [manualPOTotalCost, setManualPOTotalCost] = useState(null) // For discount/override
  const [poDiscountPercent, setPODiscountPercent] = useState('') // Discount % for PO from RFQ
  const [quotationMetadata, setQuotationMetadata] = useState(null)
  const [additionalCosts, setAdditionalCosts] = useState([]) // Mold/tooling/setup costs

  // Price comparison modal (DB price vs quotation price) inside Price Validation Modal
  const [showPriceComparisonModal, setShowPriceComparisonModal] = useState(false)
  const [exportingPriceComparison, setExportingPriceComparison] = useState(false)

  // "Add extra part from DB" inside Price Validation Modal
  const [addExtraOpen, setAddExtraOpen] = useState(false)
  const [addExtraSearch, setAddExtraSearch] = useState('')
  const [addExtraResults, setAddExtraResults] = useState([])
  const [addExtraLoading, setAddExtraLoading] = useState(false)

  // Parts DB revisions dialog (opened from the revision warning marks in Price Validation)
  const [dbRevDialogOpen, setDbRevDialogOpen] = useState(false)
  const [dbRevPartNumber, setDbRevPartNumber] = useState(null)
  const [dbRevLoading, setDbRevLoading] = useState(false)
  const [dbRevisions, setDbRevisions] = useState([])
  const [dbRevDeletingId, setDbRevDeletingId] = useState(null)

  // Edit PO modal state
  const [editPOOpen, setEditPOOpen] = useState(false)
  const [editPOLoading, setEditPOLoading] = useState(false)
  const [editPOSaving, setEditPOSaving] = useState(false)
  const [editPOData, setEditPOData] = useState(null)  // { id, po_number, vendor, currency, lead_time }
  const [editPOItems, setEditPOItems] = useState([])  // [{ part_number, revision, quantity, unit_cost, ... }]
  const [editPOAddSearchOpen, setEditPOAddSearchOpen] = useState(false)
  const [editPOAddSearch, setEditPOAddSearch] = useState('')
  const [editPOAddResults, setEditPOAddResults] = useState([])

  // PO Document Modal State
  const [showPODocumentModal, setShowPODocumentModal] = useState(false)
  const [generatePODocument, setGeneratePODocument] = useState(true)
  const [poDocumentSource, setPoDocumentSource] = useState('rfq') // 'rfq' or 'direct' - which flow opened the modal
  const [poTemplateVars, setPoTemplateVars] = useState({
    contact_name: '', quotation_number: '', quotation_date: '',
    delivery_date: '', payment_terms: '',
    orderer_name: '', orderer_email: '', orderer_phone: '',
    approver_name: '', approver_title: ''
  })

  // PO Success Modal State
  const [showPOSuccessModal, setShowPOSuccessModal] = useState(false)
  const [poSuccessData, setPOSuccessData] = useState(null)

  // Delete Confirmation Modal State
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false)
  const [deleteType, setDeleteType] = useState(null) // 'rfq' or 'po'
  const [deleteId, setDeleteId] = useState(null)
  const [deleteName, setDeleteName] = useState('')
  const [deleting, setDeleting] = useState(false)

  // RFQ Fix/Re-export Modal State
  const [showReexportModal, setShowReexportModal] = useState(false)
  const [reexportRFQId, setReexportRFQId] = useState(null)
  const [reexportRFQName, setReexportRFQName] = useState('')
  const [reexportItems, setReexportItems] = useState([])
  const [loadingReexportItems, setLoadingReexportItems] = useState(false)
  const [reexporting, setReexporting] = useState(false)
  const [newRfqPartNumber, setNewRfqPartNumber] = useState('')
  const [newRfqRevision, setNewRfqRevision] = useState('')
  const [newRfqQuantity, setNewRfqQuantity] = useState('')
  const [newRfqLookupStatus, setNewRfqLookupStatus] = useState(null) // null | 'found' | 'not_found' | 'checking'
  const [newRfqLookupInfo, setNewRfqLookupInfo] = useState(null) // part details if found
  const [removedRfqItems, setRemovedRfqItems] = useState([]) // [{ part_number, revision }] queued for deletion on save
  const [rfqAddSearchOpen, setRfqAddSearchOpen] = useState(false)
  const [rfqAddSearch, setRfqAddSearch] = useState('')
  const [rfqAddResults, setRfqAddResults] = useState([])
  const [rfqAddLoading, setRfqAddLoading] = useState(false)

  // RFQ Duplicate Modal State
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [duplicateSourceRFQ, setDuplicateSourceRFQ] = useState(null) // { id, rfq_name }
  const [duplicateItems, setDuplicateItems] = useState([]) // [{ part_number, revision, quantity, newQuantity }]
  const [duplicateRfqName, setDuplicateRfqName] = useState('')
  const [duplicateMultiplier, setDuplicateMultiplier] = useState('1')
  const [duplicateFactorMode, setDuplicateFactorMode] = useState('multiply') // 'multiply' | 'divide'
  const [loadingDuplicateItems, setLoadingDuplicateItems] = useState(false)

  // RFQ Refresh State (update metadata from Parts DB + regenerate files)
  const [refreshingRFQ, setRefreshingRFQ] = useState(null) // RFQ ID being refreshed
  const [showRFQRefreshModal, setShowRFQRefreshModal] = useState(false)
  const [rfqRefreshData, setRfqRefreshData] = useState(null) // detect-phase response
  const [refreshTargetRFQ, setRefreshTargetRFQ] = useState(null) // { id, rfq_name }
  const [duplicating, setDuplicating] = useState(false)

  // Price Update Modal State
  const [showPriceUpdateModal, setShowPriceUpdateModal] = useState(false)
  const [priceUpdateStep, setPriceUpdateStep] = useState(0) // 0: Select Type, 1: Select Parts, 2: Upload & Review
  const [priceUpdateTypes, setPriceUpdateTypes] = useState([])
  const [selectedUpdateTypes, setSelectedUpdateTypes] = useState([])
  const [updatePartsList, setUpdatePartsList] = useState([])
  const [selectedUpdateParts, setSelectedUpdateParts] = useState([])
  const [updateQuotationFiles, setUpdateQuotationFiles] = useState([])
  const [processingUpdate, setProcessingUpdate] = useState(false)
  const [priceUpdateCurrency, setPriceUpdateCurrency] = useState('USD')
  const [priceUpdateVendor, setPriceUpdateVendor] = useState('')
  const [priceUpdatePONumber, setPriceUpdatePONumber] = useState('')
  const [updateSearchTerm, setUpdateSearchTerm] = useState('')
  const [uploadingDatasheetForPart, setUploadingDatasheetForPart] = useState(null) // part_number being uploaded
  const [priceUpdateVendorFilter, setPriceUpdateVendorFilter] = useState('')

  // Existing PO Modal State (Create PO without RFQ)
  const [showExistingPOModal, setShowExistingPOModal] = useState(false)
  const [existingPOStep, setExistingPOStep] = useState(0) // 0: Select Type, 1: Select Parts, 2: Enter Details & Prices
  const [existingPOTypes, setExistingPOTypes] = useState([])
  const [selectedExistingPOTypes, setSelectedExistingPOTypes] = useState([])
  const [existingPOPartsList, setExistingPOPartsList] = useState([])
  const [selectedExistingPOParts, setSelectedExistingPOParts] = useState([])
  const [existingPOQuotationFiles, setExistingPOQuotationFiles] = useState([])
  const [existingPOPartsData, setExistingPOPartsData] = useState([])
  const [existingPONumber, setExistingPONumber] = useState('')
  const [existingPOVendor, setExistingPOVendor] = useState('')
  const [existingPOCurrency, setExistingPOCurrency] = useState('USD')
  const [existingPOLeadTime, setExistingPOLeadTime] = useState('')
  const [creatingExistingPO, setCreatingExistingPO] = useState(false)
  const [existingPOSearchTerm, setExistingPOSearchTerm] = useState('')
  const [existingPOVendorFilter, setExistingPOVendorFilter] = useState('')
  const [existingPODiscountPercent, setExistingPODiscountPercent] = useState('') // Discount % for Create PO
  const [existingPOManualTotal, setExistingPOManualTotal] = useState(null) // Discounted total override

  // Warehouse Box Number Validation State
  const [warehouseBoxErrors, setWarehouseBoxErrors] = useState({}) // Map of item index to error message
  const [checkingDuplicates, setCheckingDuplicates] = useState({}) // Map of item index to checking state
  const [duplicateConfirmations, setDuplicateConfirmations] = useState({}) // Map of item key to confirmation status

  // PO Received Modal State
  const [showPOReceivedModal, setShowPOReceivedModal] = useState(false)
  const [currentPOForReceiving, setCurrentPOForReceiving] = useState(null)
  const [qcData, setQcData] = useState([])
  const [markingReceived, setMarkingReceived] = useState(false)
  const [refreshingPart, setRefreshingPart] = useState(null)
  const [poReceivedThumbnailAnchor, setPoReceivedThumbnailAnchor] = useState(null)
  const [poReceivedHoveredPart, setPoReceivedHoveredPart] = useState(null)
  const [poReceivedPartThumbnails, setPoReceivedPartThumbnails] = useState({}) // part_number_revision -> thumbnail
  const [poReceivedSearchTerm, setPoReceivedSearchTerm] = useState('')

  // Email Notification State
  const [emailNotifyDialog, setEmailNotifyDialog] = useState({ open: false, poId: null, poNumber: '' })

  // Store QC data per PO ID to preserve state when modal is closed/reopened
  // Load from localStorage on mount to persist across page refreshes
  const [qcDataByPO, setQcDataByPO] = useState(() => {
    try {
      const saved = localStorage.getItem('qcDataByPO')
      return saved ? JSON.parse(saved) : {}
    } catch (error) {
      console.warn('Error loading saved QC data from localStorage:', error)
      return {}
    }
  }) // poId -> qcData array

  // Revision Mismatch State
  const [revisionMismatches, setRevisionMismatches] = useState({}) // key -> mismatch info
  const [revisionDecisions, setRevisionDecisions] = useState({}) // key -> { action, target_revision }
  const [showRevisionMismatchDialog, setShowRevisionMismatchDialog] = useState(false)

  // View QC Data Modal State
  const [showViewQCModal, setShowViewQCModal] = useState(false)
  const [viewQCData, setViewQCData] = useState([])
  const [currentPOForViewing, setCurrentPOForViewing] = useState(null)
  const [editingQCData, setEditingQCData] = useState(false)
  const [editingQCDataState, setEditingQCDataState] = useState([])
  const [updatingQCData, setUpdatingQCData] = useState(false)

  // Sort state for modal part lists (null = unsorted, 'asc' = A-Z, 'desc' = Z-A)
  const [priceValidationSort, setPriceValidationSort] = useState(null)
  const [priceUpdateSort, setPriceUpdateSort] = useState(null)
  const [existingPOSort, setExistingPOSort] = useState(null)
  const [poReceivedSort, setPoReceivedSort] = useState(null)
  const [viewQCSort, setViewQCSort] = useState(null)

  // Multi-Delivery PO State
  const [expandedPOs, setExpandedPOs] = useState(new Set())
  const [addingDeliveryForPO, setAddingDeliveryForPO] = useState(null) // PO ID for which we're adding delivery
  const [newDeliveryData, setNewDeliveryData] = useState({
    total_cost: '',
    delivery_date: '',
    waybill: '',
    invoice_number: ''
  })
  const [addingDelivery, setAddingDelivery] = useState(false)
  const [editingDeliveryId, setEditingDeliveryId] = useState(null) // Delivery PO ID being edited
  const [editingDeliveryData, setEditingDeliveryData] = useState({
    total_cost: '',
    delivery_date: '',
    waybill: '',
    invoice_number: ''
  })
  const [savingDelivery, setSavingDelivery] = useState(false)

  // Lead Time Date Editing State
  const [editingLeadTimeDate, setEditingLeadTimeDate] = useState(null) // PO ID being edited
  const [leadTimeDateValue, setLeadTimeDateValue] = useState('')

  // PO Date Editing State
  const [editingPODate, setEditingPODate] = useState(null) // PO ID being edited
  const [editingPODateValue, setEditingPODateValue] = useState('')

  // PO Regenerate State
  const [regeneratingPO, setRegeneratingPO] = useState(null) // PO ID being regenerated
  const [showRegenerateConfirmModal, setShowRegenerateConfirmModal] = useState(false)
  const [showRevisionUpdatesModal, setShowRevisionUpdatesModal] = useState(false)
  const [revisionUpdatesData, setRevisionUpdatesData] = useState(null) // Contains revision_updates, price_updates, summary
  const [currentRegeneratingPOId, setCurrentRegeneratingPOId] = useState(null)

  // Warehouse box number validation helper (no pattern restriction — any value is accepted)
  const validateWarehouseBoxNumber = () => {
    return { isValid: true, error: null }
  }

  // Check for duplicate warehouse box number
  const checkWarehouseBoxDuplicate = async (boxNumber, excludePartId = null) => {
    if (!boxNumber || boxNumber.trim() === '') {
      return { exists: false, partInfo: null }
    }
    
    try {
      const response = await rfqService.checkWarehouseBoxDuplicate(boxNumber, excludePartId)
      if (response.data.success) {
        return {
          exists: response.data.exists,
          partInfo: response.data.part_info
        }
      }
      return { exists: false, partInfo: null }
    } catch (error) {
      console.error('Error checking duplicate warehouse box number:', error)
      return { exists: false, partInfo: null }
    }
  }

  useEffect(() => {
    loadRFQs()
    loadPOs()
    loadVendors()
    loadApprovers()
    // Light-weight late-PO count for the header badge
    rfqService.getDeliveryPerformance()
      .then(res => {
        if (res.data?.success) setLatePOCount((res.data.late_pos || []).length)
      })
      .catch(() => {})
  }, [])

  // Live update: silently re-fetch RFQ/PO tables when another user changes them
  // (server bumps the 'purchases' poll channel — see NotificationContext)
  const liveInitRef = useRef(true)
  useEffect(() => {
    if (liveInitRef.current) {
      liveInitRef.current = false
      return
    }
    loadRFQs(true)
    loadPOs(true)
  }, [liveVersions.purchases])

  // Reload vendors when vendor modal opens
  useEffect(() => {
    if (showVendorModal) {
      loadVendors()
    }
  }, [showVendorModal])

  // Save QC data state whenever it changes (preserves state when modal is closed/reopened)
  // Also persist to localStorage to survive page refreshes
  useEffect(() => {
    if (showPOReceivedModal && currentPOForReceiving && qcData.length > 0) {
      const updated = {
        ...qcDataByPO,
        [currentPOForReceiving.id]: qcData
      }
      setQcDataByPO(updated)
      // Persist to localStorage
      try {
        localStorage.setItem('qcDataByPO', JSON.stringify(updated))
      } catch (error) {
        console.warn('Error saving QC data to localStorage:', error)
      }
    }
  }, [qcData, showPOReceivedModal, currentPOForReceiving])


  const loadVendors = async () => {
    setLoadingVendors(true)
    try {
      const response = await adminService.getVendors()
      setVendors(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      console.error('Error loading vendors:', error)
      // Don't show error notification, just log it
    } finally {
      setLoadingVendors(false)
    }
  }

  // Vendor management functions
  const handleCreateVendor = () => {
    setEditingVendor(null)
    setVendorForm({ name: '', contact_name: '' })
    setShowVendorFormModal(true)
  }

  const handleEditVendor = (vendor) => {
    setEditingVendor(vendor)
    setVendorForm({ name: vendor.name, contact_name: vendor.contact_name || '' })
    setShowVendorFormModal(true)
  }

  const handleSaveVendor = async () => {
    try {
      if (editingVendor) {
        await adminService.updateVendor(editingVendor.id, vendorForm)
        showNotification('Vendor updated successfully', 'success')
      } else {
        await adminService.createVendor(vendorForm)
        showNotification('Vendor created successfully', 'success')
      }
      setShowVendorFormModal(false)
      setEditingVendor(null)
      setVendorForm({ name: '', contact_name: '' })
      loadVendors()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error saving vendor', 'error')
    }
  }

  const handleDeleteVendor = async (vendorId) => {
    if (!window.confirm('Are you sure you want to delete this vendor?')) return
    try {
      await adminService.deleteVendor(vendorId)
      showNotification('Vendor deleted successfully', 'success')
      loadVendors()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error deleting vendor', 'error')
    }
  }

  const handleOpenReconcile = async () => {
    setLoadingUnmatched(true)
    setShowReconcileModal(true)
    try {
      const response = await adminService.getUnmatchedVendors()
      const { unmatched, canonical } = response.data
      setUnmatchedVendors(unmatched)
      setCanonicalVendors(canonical)
      // Pre-fill mappings with the top fuzzy suggestion (if any)
      const initial = {}
      unmatched.forEach(item => {
        initial[item.vendor_string] = item.suggestions.length > 0 ? item.suggestions[0] : ''
      })
      setReconcileMappings(initial)
    } catch (error) {
      showNotification('Error loading unmatched vendors', 'error')
      setShowReconcileModal(false)
    } finally {
      setLoadingUnmatched(false)
    }
  }

  const handleApplyRemap = async () => {
    const mappings = Object.entries(reconcileMappings)
      .filter(([, newName]) => newName)
      .map(([old_string, new_name]) => ({ old_string, new_name }))
    if (mappings.length === 0) {
      showNotification('No mappings selected', 'warning')
      return
    }
    setApplyingRemap(true)
    try {
      const response = await adminService.bulkRemapVendors(mappings)
      const { total_parts_updated } = response.data
      showNotification(`Done — ${total_parts_updated} part(s) updated`, 'success')
      setShowReconcileModal(false)
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error applying remapping', 'error')
    } finally {
      setApplyingRemap(false)
    }
  }

  // Load PO Approvers
  const loadApprovers = async () => {
    try {
      const response = await rfqService.getActivePOApprovers()
      setPoApprovers(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      console.error('Error loading approvers:', error)
    }
  }

  const loadRFQs = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await rfqService.getRFQs()
      if (response.data.success) {
        setRfqs(response.data.rfqs || [])
      } else if (!silent) {
        showNotification('Failed to load RFQs', 'error')
      }
    } catch (error) {
      console.error('Error loading RFQs:', error)
      if (!silent) showNotification('Error loading RFQs', 'error')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const loadPOs = async (silent = false) => {
    if (!silent) setLoadingPOs(true)
    try {
      const response = await rfqService.getPOs()
      if (response.data.success) {
        setPos(response.data.pos || [])
      } else if (!silent) {
        showNotification('Failed to load POs', 'error')
      }
    } catch (error) {
      console.error('Error loading POs:', error)
      if (!silent) showNotification('Error loading POs', 'error')
    } finally {
      if (!silent) setLoadingPOs(false)
    }
  }

  const handleOpenPOCreation = (rfqId) => {
    setCurrentRFQId(rfqId)
    setPONumber('')
    setVendor('')
    setCurrency('USD')
    setQuotationFiles([])
    setShowPOCreationModal(true)
  }

  const handleFileChange = (e) => {
    setQuotationFiles(Array.from(e.target.files))
  }

  const handleAdditionalFileChange = (e) => {
    setAdditionalQuotationFiles(Array.from(e.target.files))
  }

  const handleSubmitPOCreation = async () => {
    if (!poNumber.trim() || !vendor.trim()) {
      showNotification('PO number and vendor are required', 'warning')
      return
    }

    setCreatingPO(true)
    try {
      const formData = new FormData()
      formData.append('po_number', poNumber.trim())
      formData.append('vendor', vendor.trim())
      formData.append('currency', currency)

      // Only append quotation files if they were uploaded
      quotationFiles.forEach(file => {
        formData.append('quotation', file)
      })

      const response = await rfqService.validatePrices(currentRFQId, formData)

      if (response.data.success) {
        setValidationData(response.data)
        setPartsData(response.data.parts || [])
        setExcludedParts([])
        setAdditionalCosts(response.data.additional_costs || [])
        setQuotationMetadata(response.data.quotation_metadata || null)
        // Auto-fill lead time from the quotation (unless the user already set one)
        const quotedLeadDays = parseLeadTimeToDays(response.data.quotation_metadata?.lead_time)
        if (quotedLeadDays && !poLeadTime) {
          setPOLeadTime(String(quotedLeadDays))
          showNotification(`Lead time auto-filled from quotation: ${quotedLeadDays} days ("${response.data.quotation_metadata.lead_time}")`, 'info')
        }
        setManualPOTotalCost(null)
        setPODiscountPercent('')
        setShowPOCreationModal(false)
        setShowPriceValidationModal(true)
      } else {
        showNotification(response.data.error || 'Failed to process quotations', 'error')
      }
    } catch (error) {
      console.error('Error creating PO:', error)
      showNotification(error.response?.data?.error || 'Error processing quotations', 'error')
    } finally {
      setCreatingPO(false)
    }
  }

  const handleUpdatePartPrice = (partNumber, price) => {
    const updatedParts = partsData.map(part => {
      if (part.part_number === partNumber) {
        const unitCost = parseFloat(price) || 0
        return {
          ...part,
          unit_cost: unitCost,
          total_cost: unitCost * part.quantity,
          has_price: unitCost > 0
        }
      }
      return part
    })
    setPartsData(updatedParts)
    updateValidationDataSummary(updatedParts)
  }

  const handleUpdatePartInventory = (partNumber, qty) => {
    const updatedParts = partsData.map(part => {
      if (part.part_number === partNumber) {
        return {
          ...part,
          add_inventory: parseInt(qty) || 0
        }
      }
      return part
    })
    setPartsData(updatedParts)
  }

  const handleUpdatePartField = (partNumber, field, value) => {
    setPartsData(prev => prev.map(part =>
      part.part_number === partNumber ? { ...part, [field]: value } : part
    ))
  }

  const handleToggleKeepExistingPrice = (partNumber, checked) => {
    setPartsData(prev => prev.map(part =>
      part.part_number === partNumber ? { ...part, keep_existing_price: checked } : part
    ))
  }

  const handleUploadDatasheetInModal = async (partNumber, file) => {
    if (!file) return
    const partRow = partsData.find(p => p.part_number === partNumber)
    if (!partRow?.part_id) {
      showNotification('Cannot upload: part ID not found', 'warning')
      return
    }
    setUploadingDatasheetForPart(partNumber)
    try {
      const formData = new FormData()
      formData.append('datasheet', file)
      const res = await bomService.uploadPartDatasheet(partRow.part_id, formData)
      if (res.data.success) {
        handleUpdatePartField(partNumber, 'datasheet_drive_url', res.data.url)
        showNotification('Datasheet uploaded', 'success')
      } else {
        showNotification('Failed to upload datasheet', 'error')
      }
    } catch {
      showNotification('Error uploading datasheet', 'error')
    } finally {
      setUploadingDatasheetForPart(null)
    }
  }

  const handleSelectPriceOption = (partNumber, optionIndex) => {
    const updatedParts = partsData.map(part => {
      if (part.part_number === partNumber && part.price_options && part.price_options[optionIndex]) {
        const selectedOption = part.price_options[optionIndex]
        const unitCost = selectedOption.unit_cost || 0
        return {
          ...part,
          unit_cost: unitCost,
          total_cost: unitCost * part.quantity,
          has_price: true
        }
      }
      return part
    })
    setPartsData(updatedParts)
    updateValidationDataSummary(updatedParts)
  }

  const handleUpdatePartQuantity = (partNumber, quantity) => {
    // Remove any decimal part and parse as integer
    const cleanValue = String(quantity).replace(/\./g, '')
    const qty = parseInt(cleanValue, 10)
    // Validate: must be positive integer, minimum 1
    if (isNaN(qty) || qty < 1) {
      return // Don't update if invalid
    }
    
    const updatedParts = partsData.map(part => {
      if (part.part_number === partNumber) {
        const unitCost = part.unit_cost || 0
        return {
          ...part,
          quantity: qty,
          total_cost: unitCost * qty
        }
      }
      return part
    })
    setPartsData(updatedParts)
    updateValidationDataSummary(updatedParts)
  }

  // Discount handlers for PO from RFQ
  const handlePODiscountPercentChange = (value) => {
    setPODiscountPercent(value)
    if (value === '' || isNaN(parseFloat(value))) {
      setManualPOTotalCost(null)
      return
    }
    const pct = parseFloat(value)
    if (pct < 0 || pct > 100) return
    const originalTotal = partsData.reduce((sum, part) => sum + ((part._original_unit_cost || part.unit_cost || 0) * part.quantity), 0)
    const discountedTotal = originalTotal * (1 - pct / 100)
    setManualPOTotalCost(Math.round(discountedTotal * 100) / 100)
  }

  const handlePODiscountTotalChange = (value) => {
    if (value === '') {
      setManualPOTotalCost(null)
      setPODiscountPercent('')
      return
    }
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) return
    setManualPOTotalCost(num)
    const originalTotal = partsData.reduce((sum, part) => sum + ((part._original_unit_cost || part.unit_cost || 0) * part.quantity), 0)
    if (originalTotal > 0) {
      const pct = ((originalTotal - num) / originalTotal) * 100
      setPODiscountPercent(Math.round(pct * 100) / 100)
    }
  }

  const handleApplyPODiscount = () => {
    if (manualPOTotalCost === null) return
    const originalTotal = partsData.reduce((sum, part) => sum + ((part._original_unit_cost || part.unit_cost || 0) * part.quantity), 0)
    if (originalTotal <= 0) return
    const ratio = manualPOTotalCost / originalTotal
    const updatedParts = partsData.map(part => {
      const origUnitCost = part._original_unit_cost || part.unit_cost || 0
      const newUnitCost = Math.round(origUnitCost * ratio * 100) / 100
      return {
        ...part,
        _original_unit_cost: origUnitCost,
        unit_cost: newUnitCost,
        total_cost: Math.round(newUnitCost * part.quantity * 100) / 100,
        has_price: newUnitCost > 0
      }
    })
    // Adjust last part to absorb rounding difference
    const roundedSum = updatedParts.reduce((sum, p) => sum + p.total_cost, 0)
    const diff = Math.round((manualPOTotalCost - roundedSum) * 100) / 100
    if (diff !== 0 && updatedParts.length > 0) {
      const last = updatedParts[updatedParts.length - 1]
      last.total_cost = Math.round((last.total_cost + diff) * 100) / 100
      if (last.quantity > 0) {
        last.unit_cost = Math.round((last.total_cost / last.quantity) * 100) / 100
      }
    }
    setPartsData(updatedParts)
    updateValidationDataSummary(updatedParts)
    // Keep discount visible — don't reset
  }

  const handleClearPODiscount = () => {
    // Restore original prices
    const updatedParts = partsData.map(part => {
      if (part._original_unit_cost != null) {
        const origCost = part._original_unit_cost
        return {
          ...part,
          unit_cost: origCost,
          total_cost: Math.round(origCost * part.quantity * 100) / 100,
          _original_unit_cost: undefined,
          has_price: origCost > 0
        }
      }
      return part
    })
    setPartsData(updatedParts)
    updateValidationDataSummary(updatedParts)
    setManualPOTotalCost(null)
    setPODiscountPercent('')
  }

  // Discount handlers for Create PO without RFQ
  const handleExistingPODiscountPercentChange = (value) => {
    setExistingPODiscountPercent(value)
    if (value === '' || isNaN(parseFloat(value))) {
      setExistingPOManualTotal(null)
      return
    }
    const pct = parseFloat(value)
    if (pct < 0 || pct > 100) return
    const originalTotal = existingPOPartsData.reduce((sum, part) => sum + ((part._original_unit_cost || part.unit_cost || 0) * part.quantity), 0)
    const discountedTotal = originalTotal * (1 - pct / 100)
    setExistingPOManualTotal(Math.round(discountedTotal * 100) / 100)
  }

  const handleExistingPODiscountTotalChange = (value) => {
    if (value === '') {
      setExistingPOManualTotal(null)
      setExistingPODiscountPercent('')
      return
    }
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) return
    setExistingPOManualTotal(num)
    const originalTotal = existingPOPartsData.reduce((sum, part) => sum + ((part._original_unit_cost || part.unit_cost || 0) * part.quantity), 0)
    if (originalTotal > 0) {
      const pct = ((originalTotal - num) / originalTotal) * 100
      setExistingPODiscountPercent(Math.round(pct * 100) / 100)
    }
  }

  const handleApplyExistingPODiscount = () => {
    if (existingPOManualTotal === null) return
    const originalTotal = existingPOPartsData.reduce((sum, part) => sum + ((part._original_unit_cost || part.unit_cost || 0) * part.quantity), 0)
    if (originalTotal <= 0) return
    const ratio = existingPOManualTotal / originalTotal
    const updatedParts = existingPOPartsData.map(part => {
      const origUnitCost = part._original_unit_cost || part.unit_cost || 0
      const newUnitCost = Math.round(origUnitCost * ratio * 100) / 100
      return {
        ...part,
        _original_unit_cost: origUnitCost,
        unit_cost: newUnitCost,
        total_cost: Math.round(newUnitCost * part.quantity * 100) / 100,
        has_price: newUnitCost > 0
      }
    })
    // Adjust last part to absorb rounding difference
    const roundedSum = updatedParts.reduce((sum, p) => sum + p.total_cost, 0)
    const diff = Math.round((existingPOManualTotal - roundedSum) * 100) / 100
    if (diff !== 0 && updatedParts.length > 0) {
      const last = updatedParts[updatedParts.length - 1]
      last.total_cost = Math.round((last.total_cost + diff) * 100) / 100
      if (last.quantity > 0) {
        last.unit_cost = Math.round((last.total_cost / last.quantity) * 100) / 100
      }
    }
    setExistingPOPartsData(updatedParts)
    // Keep discount visible — don't reset
  }

  const handleClearExistingPODiscount = () => {
    const updatedParts = existingPOPartsData.map(part => {
      if (part._original_unit_cost != null) {
        const origCost = part._original_unit_cost
        return {
          ...part,
          unit_cost: origCost,
          total_cost: Math.round(origCost * part.quantity * 100) / 100,
          _original_unit_cost: undefined,
          has_price: origCost > 0
        }
      }
      return part
    })
    setExistingPOPartsData(updatedParts)
    setExistingPOManualTotal(null)
    setExistingPODiscountPercent('')
  }

  const handleRemovePart = (partNumber) => {
    const partToRemove = partsData.find(p => p.part_number === partNumber)
    if (partToRemove) {
      setExcludedParts([...excludedParts, {
        part_number: partToRemove.part_number,
        revision: partToRemove.revision,
        quantity: partToRemove.quantity
      }])
      const updatedParts = partsData.filter(p => p.part_number !== partNumber)
      setPartsData(updatedParts)
      updateValidationDataSummary(updatedParts)
      showNotification(`Part ${partNumber} removed from PO`, 'info')
    }
  }

  // Open the Parts DB revisions dialog for a part (from the revision warning marks)
  const openDbRevisionsDialog = async (partNumber) => {
    setDbRevPartNumber(partNumber)
    setDbRevDialogOpen(true)
    setDbRevLoading(true)
    setDbRevisions([])
    try {
      const response = await rfqService.getPartDbRevisions(partNumber)
      setDbRevisions(response.data.revisions || [])
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to load DB revisions', 'error')
    } finally {
      setDbRevLoading(false)
    }
  }

  const handleDeleteDbRevision = async (rev) => {
    const usage = []
    if (rev.bom_count > 0) usage.push(`${rev.bom_count} BOM line(s) — they will be REMOVED from those BOMs`)
    if (rev.rfq_count > 0) usage.push(`${rev.rfq_count} RFQ item(s) — they keep the part number/revision but get unlinked`)
    if (rev.po_count > 0) usage.push(`${rev.po_count} PO item(s) — they keep the part number/revision but get unlinked`)
    const message = `Delete ${dbRevPartNumber} REV${rev.revision} from the parts database?` +
      (usage.length ? `\n\nThis revision is referenced by:\n- ${usage.join('\n- ')}` : '\n\nIt is not referenced by any BOM, RFQ or PO.') +
      '\n\nThis cannot be undone.'
    if (!window.confirm(message)) return

    setDbRevDeletingId(rev.id)
    try {
      const response = await rfqService.deletePartDbRevision(rev.id)
      const latest = response.data.latest
      setDbRevisions(prev => prev.filter(r => r.id !== rev.id))
      // Auto-update the validation table row to the new latest DB revision
      if (latest) {
        setPartsData(prev => prev.map(p => {
          if (p.part_number !== dbRevPartNumber) return p
          const originalRev = p.old_revision || p.revision
          const revisionUpdated = latest.revision !== originalRev
          return {
            ...p,
            revision: latest.revision,
            revision_updated: revisionUpdated,
            old_revision: revisionUpdated ? originalRev : null,
            pdf_missing: !latest.has_pdf,
            xt_missing: !latest.has_xt,
            files_missing: !latest.has_pdf,
          }
        }))
      }
      showNotification(`Deleted ${response.data.deleted}${latest ? ` — latest in DB is now REV${latest.revision}` : ''}`, 'success')
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to delete revision', 'error')
    } finally {
      setDbRevDeletingId(null)
    }
  }

  const handleSearchExtraParts = async (term) => {
    setAddExtraSearch(term)
    if (!term || term.trim().length < 2) {
      setAddExtraResults([])
      return
    }
    setAddExtraLoading(true)
    try {
      const res = await bomService.searchParts(term.trim(), 25)
      if (res.data.success) {
        setAddExtraResults(res.data.parts || [])
      } else {
        setAddExtraResults([])
      }
    } catch (err) {
      setAddExtraResults([])
    } finally {
      setAddExtraLoading(false)
    }
  }

  const handleAddExtraPartToPO = async (part) => {
    if (!part || !part.part_number) return
    const alreadyIn = partsData.some(p => p.part_number === part.part_number)
    if (alreadyIn) {
      showNotification(`${part.part_number} is already in this PO`, 'warning')
      return
    }

    let filesMissing = false
    let pdfMissing = false
    let xtMissing = false
    const partType = part.part_type || ''
    const isMech = ['Mechanical part', 'Assembly', '3D Printing part'].includes(partType)
    if (isMech) {
      try {
        const res = await bomService.checkFileAvailability([{
          part_number: part.part_number,
          revision: (part.revision || '').replace('REV', '').replace('rev', ''),
          part_type: partType,
        }])
        const key = `${part.part_number}_${(part.revision || '').replace('REV', '').replace('rev', '')}`
        const flags = (res.data && res.data.results && res.data.results[key]) || {}
        pdfMissing = !flags.has_pdf
        xtMissing = !flags.has_xt
        filesMissing = !flags.has_pdf
      } catch (e) { /* non-fatal */ }
    }

    const newPart = {
      part_number: part.part_number,
      revision: part.revision || 'REV01',
      old_revision: null,
      revision_updated: false,
      files_missing: filesMissing,
      pdf_missing: pdfMissing,
      xt_missing: xtMissing,
      quantity: 1,
      material: part.material || '',
      finish1: part.finish1 || '',
      finish2: part.finish2 || '',
      description: part.description || '',
      unit_cost: 0,
      total_cost: 0,
      db_unit_cost: currency === 'USD' && part.unit_cost != null ? part.unit_cost : null,
      has_price: false,
      price_options: [],
      keep_existing_price: false,
      is_extra_from_db: true,
      part_type: partType,
    }

    setPartsData(prev => {
      const next = [...prev, newPart]
      updateValidationDataSummary(next)
      return next
    })

    setExcludedParts(prev => prev.filter(p => p.part_number !== part.part_number))

    showNotification(`${part.part_number} added — enter unit price`, 'success')
  }

  const handleUploadAdditionalQuotations = async () => {
    if (additionalQuotationFiles.length === 0) {
      showNotification('Please select at least one quotation file', 'warning')
      return
    }

    setUploadingQuotations(true)
    try {
      const formData = new FormData()
      formData.append('rfq_id', currentRFQId)
      formData.append('vendor', vendor)
      formData.append('currency', currency)

      additionalQuotationFiles.forEach(file => {
        formData.append('quotation', file)
      })

      const response = await rfqService.processAdditionalQuotations(formData)

      if (response.data.success) {
        setPartsData(response.data.parts || [])
        setValidationData(response.data)
        updateValidationDataSummary(response.data.parts || [])
        setAdditionalQuotationFiles([])
        showNotification(`Processed ${additionalQuotationFiles.length} quotation file(s)`, 'success')
      } else {
        showNotification(response.data.error || 'Failed to process quotations', 'error')
      }
    } catch (error) {
      console.error('Error uploading quotations:', error)
      showNotification(error.response?.data?.error || 'Error processing quotations', 'error')
    } finally {
      setUploadingQuotations(false)
    }
  }

  const updateValidationDataSummary = (parts) => {
    if (!validationData) return

    const totalParts = parts.length
    const partsWithPrices = parts.filter(p => p.has_price).length
    const missingPrices = totalParts - partsWithPrices
    const totalCost = parts.reduce((sum, part) => sum + (part.total_cost || 0), 0)

    setValidationData({
      ...validationData,
      summary: {
        total_parts: totalParts,
        parts_with_prices: partsWithPrices,
        missing_prices_count: missingPrices,
        duplicate_prices_count: validationData.summary?.duplicate_prices_count || 0
      },
      parts: parts
    })
  }

  // ---- Price comparison (DB price vs quotation price) ----
  // Positive diff = new price is worse (higher) than the database price
  const getPriceDiff = (part) => {
    if (part.db_unit_cost == null || part.unit_cost == null || !part.has_price) return null
    const diff = part.unit_cost - part.db_unit_cost
    if (Math.abs(diff) < 0.005) return { diff: 0, pct: 0 }
    const pct = part.db_unit_cost ? (diff / part.db_unit_cost) * 100 : null
    return { diff, pct }
  }

  // Light pastel green = better (cheaper) than DB, light pastel red = worse
  const priceDiffCellSx = (part) => {
    const info = getPriceDiff(part)
    if (!info || info.diff === 0) return {}
    return { bgcolor: info.diff < 0 ? 'rgba(76, 175, 80, 0.18)' : 'rgba(244, 67, 54, 0.16)' }
  }

  const handleExportPriceComparison = async () => {
    setExportingPriceComparison(true)
    try {
      const response = await rfqService.exportPriceValidation({
        po_number: poNumber,
        vendor,
        currency,
        parts: partsData.map(p => ({
          part_number: p.part_number,
          revision: p.revision,
          quantity: p.quantity,
          db_unit_cost: p.db_unit_cost != null ? p.db_unit_cost : null,
          unit_cost: p.has_price && p.unit_cost != null ? p.unit_cost : null,
        })),
      })
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `PO_${poNumber || 'draft'}_price_validation.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showNotification('Price validation exported to Excel', 'success')
    } catch (error) {
      console.error('Error exporting price validation:', error)
      showNotification('Error exporting price validation', 'error')
    } finally {
      setExportingPriceComparison(false)
    }
  }

  const handleExportPO = () => {
    const partsWithPrices = partsData.filter(p => p.has_price)
    const missingPrices = partsData.filter(p => !p.has_price)

    if (partsWithPrices.length === 0) {
      showNotification('No parts selected for PO', 'warning')
      return
    }

    if (missingPrices.length > 0) {
      showNotification(`Cannot export PO: ${missingPrices.length} parts are missing prices`, 'error')
      return
    }

    // Pre-fill PO Document modal with defaults from quotation metadata, vendor contact, and user profile
    const selectedVendorObj = vendors.find(v => v.name === vendor)
    // Suggest a concrete delivery date: quotation lead time (parsed) or the
    // manually entered lead-time days, projected from today
    const suggestedLeadDays = parseLeadTimeToDays(quotationMetadata?.lead_time)
      ?? (poLeadTime ? parseInt(poLeadTime) : null)
    setPoTemplateVars({
      contact_name: quotationMetadata?.contact_name || selectedVendorObj?.contact_name || '',
      quotation_number: quotationMetadata?.quotation_number || '',
      quotation_date: quotationMetadata?.quotation_date || '',
      delivery_date: suggestedLeadDays ? leadTimeToDateString(suggestedLeadDays) : (quotationMetadata?.lead_time || ''),
      payment_terms: quotationMetadata?.payment_terms || '',
      orderer_name: user?.username || '',
      orderer_email: user?.email || '',
      orderer_phone: user?.phone || '',
      approver_name: '',
      approver_title: ''
    })
    setGeneratePODocument(true)
    setPoDocumentSource('rfq')
    setShowPODocumentModal(true)
  }

  const handleConfirmPODocument = async () => {
    setShowPODocumentModal(false)
    setCreatingPO(true)
    try {
      const partsWithPrices = partsData.filter(p => p.has_price)
      const requestData = {
        po_number: poNumber,
        vendor: vendor,
        currency: currency,
        lead_time: poLeadTime ? parseInt(poLeadTime) : null,
        dont_update_part_costs: dontUpdatePartCosts,
        manual_total_cost: manualPOTotalCost !== null ? manualPOTotalCost : null,
        discount_percent: poDiscountApplied ? parseFloat(poDiscountPercent) || null : null,
        original_total_cost: poDiscountApplied ? originalPOTotalCost : null,
        parts_with_prices: [
          ...partsWithPrices.map(part => ({
            part_number: part.part_number,
            revision: part.revision,
            quantity: part.quantity,
            unit_cost: part.unit_cost,
            total_cost: part.total_cost,
            original_unit_cost: part._original_unit_cost || null,
            material: part.material || '',
            finish1: part.finish1 || '',
            finish2: part.finish2 || '',
            revision_updated: part.revision_updated || false,
            old_revision: part.old_revision || null,
            keep_existing_price: part.keep_existing_price || false
          })),
          ...additionalCosts.map(cost => ({
            part_number: cost.base_part_number,
            revision: '',
            quantity: cost.quantity || 1,
            unit_cost: cost.unit_cost,
            total_cost: cost.total_cost,
            description: cost.cost_type,
            material: '',
            finish1: '',
            finish2: '',
            is_additional_cost: true,
            cost_type: cost.cost_type
          }))
        ],
        excluded_parts: excludedParts,
        template_vars: generatePODocument ? poTemplateVars : null
      }

      const response = await rfqService.createPOFinal(currentRFQId, requestData)

      if (response.data.success) {
        setPOSuccessData(response.data)
        setShowPriceValidationModal(false)
        setShowPOSuccessModal(true)
        setPartsData([])
        setExcludedParts([])
        setPONumber('')
        setVendor('')
        setPOLeadTime('')
        setQuotationFiles([])
        setDontUpdatePartCosts(false)
        setQuotationMetadata(null)
        loadRFQs()
        loadPOs()
      } else {
        showNotification(response.data.error || 'Failed to create PO', 'error')
      }
    } catch (error) {
      console.error('Error creating PO:', error)
      showNotification(error.response?.data?.error || 'Error creating PO', 'error')
    } finally {
      setCreatingPO(false)
    }
  }

  const handleDeleteRFQ = (rfqId, rfqName) => {
    setDeleteType('rfq')
    setDeleteId(rfqId)
    setDeleteName(rfqName)
    setShowDeleteConfirmModal(true)
  }

  const handleDeletePO = (poId, poNumber) => {
    setDeleteType('po')
    setDeleteId(poId)
    setDeleteName(poNumber)
    setShowDeleteConfirmModal(true)
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      if (deleteType === 'rfq') {
        const response = await rfqService.deleteRFQ(deleteId)
        if (response.data.success) {
          showNotification('RFQ deleted successfully', 'success')
          loadRFQs()
        } else {
          showNotification(response.data.error || 'Failed to delete RFQ', 'error')
        }
      } else if (deleteType === 'po') {
        const response = await rfqService.deletePO(deleteId)
        if (response.data.success) {
          showNotification('PO deleted successfully', 'success')
          loadPOs()
        } else {
          showNotification(response.data.error || 'Failed to delete PO', 'error')
        }
      }
      setShowDeleteConfirmModal(false)
    } catch (error) {
      console.error('Error deleting:', error)
      showNotification(error.response?.data?.error || 'Error deleting', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const handleReopenRFQ = async (rfqId, rfqName) => {
    if (!window.confirm(`Reopen RFQ "${rfqName}"?\n\nIt will move back to the Active tab and become editable again. This will FAIL if a linked PO still exists — delete or cancel the PO first.`)) return
    try {
      const response = await rfqService.reopenRFQ(rfqId)
      if (response.data.success) {
        showNotification(response.data.message || 'RFQ reopened', 'success')
        loadRFQs()
      } else {
        showNotification(response.data.error || 'Failed to reopen RFQ', 'error')
      }
    } catch (error) {
      const apiErr = error.response?.data
      if (apiErr?.linked_pos && apiErr.linked_pos.length > 0) {
        const list = apiErr.linked_pos.map(p => `${p.po_number} (${p.status})`).join(', ')
        showNotification(`Linked PO(s) exist — delete/cancel first: ${list}`, 'error')
      } else {
        showNotification(apiErr?.error || 'Failed to reopen RFQ', 'error')
      }
    }
  }

  // RFQ Duplicate handlers
  const handleOpenDuplicate = async (rfq) => {
    setDuplicateSourceRFQ({ id: rfq.id, rfq_name: rfq.rfq_name })
    // Strip the trailing "- RFQ - YYYY-MM-DD" so the backend can append today's date
    const baseName = rfq.rfq_name.replace(/\s*-?\s*RFQ\s*-\s*\d{4}-\d{2}-\d{2}/g, '').replace(/[\s-]+$/, '').trim()
    setDuplicateRfqName(baseName)
    setDuplicateMultiplier('1')
    setDuplicateFactorMode('multiply')
    setDuplicateItems([])
    setLoadingDuplicateItems(true)
    setShowDuplicateModal(true)
    try {
      const response = await rfqService.getRFQ(rfq.id)
      if (response.data.success) {
        setDuplicateItems((response.data.items || []).map(item => ({
          part_number: item.part_number,
          revision: item.revision,
          quantity: item.quantity,
          newQuantity: item.quantity,
        })))
      } else {
        showNotification('Failed to load RFQ items', 'error')
        setShowDuplicateModal(false)
      }
    } catch (error) {
      console.error('Error loading RFQ items:', error)
      showNotification('Error loading RFQ items', 'error')
      setShowDuplicateModal(false)
    } finally {
      setLoadingDuplicateItems(false)
    }
  }

  const recomputeDuplicateQuantities = (value, mode) => {
    const factor = parseFloat(value)
    if (!isNaN(factor) && factor > 0) {
      setDuplicateItems(items => items.map(item => ({
        ...item,
        newQuantity: Math.round(mode === 'divide' ? item.quantity / factor : item.quantity * factor)
      })))
    }
  }

  const handleDuplicateMultiplierChange = (value) => {
    setDuplicateMultiplier(value)
    recomputeDuplicateQuantities(value, duplicateFactorMode)
  }

  const handleDuplicateFactorModeChange = (mode) => {
    setDuplicateFactorMode(mode)
    recomputeDuplicateQuantities(duplicateMultiplier, mode)
  }

  const handleDuplicateQuantityChange = (index, value) => {
    setDuplicateItems(items => items.map((item, i) => (
      i === index ? { ...item, newQuantity: value } : item
    )))
  }

  const handleRemoveDuplicateItem = (index) => {
    setDuplicateItems(items => items.filter((_, i) => i !== index))
  }

  const handleConfirmDuplicate = async () => {
    const itemsPayload = duplicateItems
      .map(item => ({
        part_number: item.part_number,
        revision: item.revision,
        quantity: parseFloat(item.newQuantity)
      }))
      .filter(item => !isNaN(item.quantity) && item.quantity > 0)

    if (itemsPayload.length === 0) {
      showNotification('At least one part with quantity > 0 is required', 'warning')
      return
    }

    setDuplicating(true)
    try {
      const response = await rfqService.duplicateRFQ(duplicateSourceRFQ.id, {
        custom_rfq_name: duplicateRfqName.trim(),
        items: itemsPayload,
      })
      if (response.data.success) {
        showNotification(response.data.message || 'RFQ duplicated successfully', 'success')
        setShowDuplicateModal(false)
        loadRFQs()
      } else {
        showNotification(response.data.error || 'Failed to duplicate RFQ', 'error')
      }
    } catch (error) {
      console.error('Error duplicating RFQ:', error)
      const apiErr = error.response?.data
      let msg = apiErr?.error || 'Error duplicating RFQ'
      const missingParts = apiErr?.missing_files?.missing_parts
      if (missingParts && missingParts.length > 0) {
        msg += ` — missing files: ${missingParts.map(p => p.part).join(', ')}`
      }
      showNotification(msg, 'error')
    } finally {
      setDuplicating(false)
    }
  }

  // RFQ Refresh handlers (like Regenerate PO, but for RFQ metadata/files)
  const handleRefreshRFQ = async (rfq) => {
    setRefreshTargetRFQ({ id: rfq.id, rfq_name: rfq.rfq_name })
    try {
      // Phase 1: detect what changed in the Parts DB since the RFQ was created
      const detectResponse = await rfqService.detectRFQRefresh(rfq.id)
      if (!detectResponse.data.success) {
        showNotification(detectResponse.data.error || 'Failed to check for changes', 'error')
        setRefreshTargetRFQ(null)
        return
      }
      const data = detectResponse.data
      const totalChanges = (data.summary?.revision_changes || 0) + (data.summary?.metadata_changes || 0)
      if (totalChanges === 0) {
        if (!window.confirm('No changes detected — the RFQ already matches the parts database. Regenerate the RFQ files anyway? This refreshes the Excel, ZIP and PDF/X_T files in the Drive folder.')) {
          setRefreshTargetRFQ(null)
          return
        }
        await executeRFQRefresh(rfq.id)
        return
      }
      setRfqRefreshData(data)
      setShowRFQRefreshModal(true)
    } catch (error) {
      console.error('Error detecting RFQ changes:', error)
      showNotification(error.response?.data?.error || 'Error checking for changes', 'error')
      setRefreshTargetRFQ(null)
    }
  }

  const executeRFQRefresh = async (rfqId) => {
    setRefreshingRFQ(rfqId)
    try {
      // Phase 2: refresh metadata + regenerate files in the existing Drive folder
      const response = await rfqService.refreshRFQ(rfqId)
      if (response.data.success) {
        const summary = response.data.summary || {}
        showNotification(
          `RFQ refreshed: ${summary.revision_changes || 0} revision changes, ${summary.metadata_changes || 0} metadata changes. Updated files uploaded to the Drive folder.`,
          'success'
        )
        setShowRFQRefreshModal(false)
        setRfqRefreshData(null)
        setRefreshTargetRFQ(null)
        loadRFQs()
      } else {
        showNotification(response.data.error || 'Failed to refresh RFQ', 'error')
      }
    } catch (error) {
      console.error('Error refreshing RFQ:', error)
      showNotification(error.response?.data?.error || 'Error refreshing RFQ', 'error')
    } finally {
      setRefreshingRFQ(null)
    }
  }

  const handleCancelRFQRefresh = () => {
    if (refreshingRFQ !== null) return
    setShowRFQRefreshModal(false)
    setRfqRefreshData(null)
    setRefreshTargetRFQ(null)
  }

  // RFQ Fix/Re-export handlers
  const handleOpenReexport = async (rfqId, rfqName) => {
    setReexportRFQId(rfqId)
    setReexportRFQName(rfqName)
    setShowReexportModal(true)
    setLoadingReexportItems(true)
    setRemovedRfqItems([])
    try {
      const response = await rfqService.getRFQ(rfqId)
      if (response.data.success) {
        setReexportItems(response.data.items.map(item => ({
          ...item,
          newQuantity: item.quantity
        })))
      } else {
        showNotification('Failed to load RFQ items', 'error')
        setShowReexportModal(false)
      }
    } catch (error) {
      console.error('Error loading RFQ items:', error)
      showNotification('Error loading RFQ items', 'error')
      setShowReexportModal(false)
    } finally {
      setLoadingReexportItems(false)
    }
  }

  const handleReexportQuantityChange = (index, newValue) => {
    const updated = [...reexportItems]
    updated[index] = { ...updated[index], newQuantity: parseFloat(newValue) || 0 }
    setReexportItems(updated)
  }

  const handleLookupNewRfqPart = async () => {
    const pn = newRfqPartNumber.trim().toUpperCase()
    const rev = newRfqRevision.trim().toUpperCase()
    if (!pn || !rev) return
    setNewRfqLookupStatus('checking')
    setNewRfqLookupInfo(null)
    try {
      const res = await bomService.lookupPart(pn, rev)
      const parts = res.data?.parts || []
      if (parts.length > 0) {
        setNewRfqLookupStatus('found')
        setNewRfqLookupInfo(parts[0])
      } else {
        setNewRfqLookupStatus('not_found')
      }
    } catch {
      setNewRfqLookupStatus('not_found')
    }
  }

  const handleAddNewRfqItem = () => {
    const pn = newRfqPartNumber.trim().toUpperCase()
    const rev = newRfqRevision.trim().toUpperCase()
    const qty = parseFloat(newRfqQuantity)
    if (!pn || !rev || !qty || qty <= 0) {
      showNotification('Part number, revision, and quantity (> 0) are required', 'warning')
      return
    }
    if (reexportItems.some(item => item.part_number === pn && item.revision === rev)) {
      showNotification('This part/revision is already in the RFQ list', 'warning')
      return
    }
    setReexportItems(prev => [...prev, {
      part_number: pn,
      revision: rev,
      quantity: qty,
      newQuantity: qty,
      is_new: true,
      db_linked: newRfqLookupStatus === 'found',
      part_name: newRfqLookupInfo?.part_name || null
    }])
    setNewRfqPartNumber('')
    setNewRfqRevision('')
    setNewRfqQuantity('')
    setNewRfqLookupStatus(null)
    setNewRfqLookupInfo(null)
  }

  const handleRemoveRfqItem = (index) => {
    setReexportItems(prev => {
      const it = prev[index]
      if (!it) return prev
      // Only queue server-side deletion for items that actually exist in the
      // DB. New items just added in this session are dropped client-side.
      if (!it.is_new) {
        setRemovedRfqItems(rem => {
          if (rem.some(r => r.part_number === it.part_number && r.revision === it.revision)) return rem
          return [...rem, { part_number: it.part_number, revision: it.revision }]
        })
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleSearchRfqAddParts = async (term) => {
    setRfqAddSearch(term)
    if (!term || term.trim().length < 2) {
      setRfqAddResults([])
      return
    }
    setRfqAddLoading(true)
    try {
      const res = await bomService.searchParts(term.trim(), 25)
      setRfqAddResults(res.data.success ? (res.data.parts || []) : [])
    } catch {
      setRfqAddResults([])
    } finally {
      setRfqAddLoading(false)
    }
  }

  const handleAddRfqPartFromSearch = (part) => {
    const pn = (part.part_number || '').toUpperCase()
    const rev = (part.revision || '').toUpperCase()
    if (reexportItems.some(item => item.part_number === pn && item.revision === rev)) {
      showNotification(`${pn} ${rev} is already in this RFQ`, 'warning')
      return
    }
    setReexportItems(prev => [...prev, {
      part_number: pn,
      revision: rev,
      quantity: 1,
      newQuantity: 1,
      is_new: true,
      db_linked: true,
      part_name: part.part_name || null,
    }])
    // If this part was previously queued for removal (e.g. user removed then re-added), unqueue it
    setRemovedRfqItems(prev => prev.filter(r => !(r.part_number === pn && r.revision === rev)))
    showNotification(`${pn} added`, 'success')
  }

  const handleConfirmReexport = async () => {
    const hasInvalidQty = reexportItems.some(item => !item.newQuantity || item.newQuantity <= 0)
    if (hasInvalidQty) {
      showNotification('All quantities must be greater than 0', 'warning')
      return
    }

    setReexporting(true)
    try {
      const itemsPayload = reexportItems.map(item => ({
        part_number: item.part_number,
        revision: item.revision,
        quantity: item.newQuantity,
        is_new: item.is_new || false
      }))

      const response = await rfqService.updateRFQQuantities(reexportRFQId, itemsPayload, removedRfqItems)
      if (response.data.success) {
        showNotification(response.data.message || 'RFQ quantities updated successfully!', 'success')
        setShowReexportModal(false)
        loadRFQs()
      } else {
        showNotification(response.data.error || 'Update failed', 'error')
      }
    } catch (error) {
      console.error('Error updating RFQ quantities:', error)
      showNotification(error.response?.data?.error || 'Error updating RFQ quantities', 'error')
    } finally {
      setReexporting(false)
    }
  }

  const handleTogglePOReceived = async (poId, isReceived) => {
    if (!isReceived) {
      // Unchecking - this should probably undo received status (admin only)
      return
    }

    // Get PO details to show in modal
    try {
      const response = await rfqService.getPODetails(poId)
      if (response.data.success) {
        const po = response.data.po
        const items = response.data.items || []

        // Ensure parent_po_id is set — fallback to pos state if getPODetails didn't include it
        if (!po.parent_po_id) {
          const poFromList = pos.find(p => p.id === poId)
          if (poFromList?.parent_po_id) {
            po.parent_po_id = poFromList.parent_po_id
          }
        }

        // Initialize QC data from PO items
        let initialQcData = items.map((item) => {
          const warehouseBox = item.warehouse_box_number || ''

          return {
            part_number: item.part_number,
            revision: item.revision,
            quantity_in_po: item.quantity,
            qty_arrived: item.quantity,
            qty_approved: item.quantity,
            checked: false,
            received: false,
            warehouse_box_number: warehouseBox,
            notes: '',
            part_exists: true,
            has_compatible_fallback: false
          }
        })

        // Load existing QC data from database (all QC items, not just approved ones)
        try {
          const qcResponse = await rfqService.getPOQCDetails(poId)
          if (qcResponse.data.success && qcResponse.data.qc_data) {
            const existingQcItems = qcResponse.data.qc_data || []
            initialQcData.forEach((qcItem, index) => {
              const existingQc = existingQcItems.find(
                eq => eq.part_number === qcItem.part_number && eq.revision === qcItem.revision
              )
              if (existingQc) {
                initialQcData[index].qty_arrived = existingQc.qty_arrived ?? qcItem.qty_arrived
                initialQcData[index].qty_approved = existingQc.qty_approved ?? qcItem.qty_approved
                initialQcData[index].warehouse_box_number = existingQc.warehouse_box_number || qcItem.warehouse_box_number
                initialQcData[index].notes = existingQc.notes ?? qcItem.notes
                initialQcData[index].part_exists = existingQc.part_exists
                initialQcData[index].has_compatible_fallback = existingQc.has_compatible_fallback
                if (existingQc.qc_approved === true) {
                  initialQcData[index].received = true
                  initialQcData[index].checked = true
                }
              }
            })
          }
        } catch (error) {
          console.warn('Could not fetch existing QC data:', error)
        }

        // If this is a child PO (delivery), calculate remaining qty from server
        console.log('DEBUG handleTogglePOReceived: po.parent_po_id =', po.parent_po_id, 'poId =', poId)
        if (po.parent_po_id) {
          try {
            console.log('DEBUG: Fetching remaining quantities for parent PO:', po.parent_po_id)
            const remainingResponse = await rfqService.getRemainingQuantities(po.parent_po_id)
            console.log('DEBUG: Remaining quantities response:', JSON.stringify(remainingResponse.data))
            if (remainingResponse.data.success) {
              const remainingData = remainingResponse.data.remaining || []

              items.forEach((item, index) => {
                const remainingItem = remainingData.find(
                  r => r.part_number === item.part_number && r.revision === item.revision
                )

                if (remainingItem) {
                  // Always set remaining qty display data for all items
                  initialQcData[index].qty_remaining = remainingItem.qty_remaining
                  initialQcData[index].total_ordered = remainingItem.total_ordered
                  initialQcData[index].total_received = remainingItem.total_received

                  // Only update arrival/approved values for non-received items
                  if (!initialQcData[index].received) {
                    initialQcData[index].qty_arrived = remainingItem.qty_remaining
                    initialQcData[index].qty_approved = remainingItem.qty_remaining
                  }
                  console.log(`DEBUG: ${item.part_number} REV${item.revision}: remaining=${remainingItem.qty_remaining}, received_in_db=${initialQcData[index].received}`)
                }
              })
            }
          } catch (error) {
            console.warn('Could not fetch remaining quantities:', error)
          }
        } else {
          console.log('DEBUG: No parent_po_id, skipping remaining quantities fetch')
        }
        
        // Fetch warehouse box numbers and thumbnails from parts database
        const thumbnailMap = {}
        try {
          // Fetch part details including thumbnails for each item
          const partPromises = items.map(async (item) => {
            try {
              const partKey = `${item.part_number}_${item.revision}`
              const partResponse = await fetch(`/api/parts/lookup?part_number=${encodeURIComponent(item.part_number)}&revision=${encodeURIComponent(item.revision)}`, {
                headers: {
                  'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
              })
              if (partResponse.ok) {
                const partData = await partResponse.json()
                if (partData.success && partData.parts && partData.parts.length > 0) {
                  const part = partData.parts[0]
                  if (part.thumbnail) {
                    let thumbnail = {}
                    if (typeof part.thumbnail === 'string') {
                      try {
                        thumbnail = JSON.parse(part.thumbnail)
                      } catch {
                        thumbnail = {}
                      }
                    } else if (typeof part.thumbnail === 'object') {
                      thumbnail = part.thumbnail
                    }
                    thumbnailMap[partKey] = thumbnail
                  }
                }
              }
            } catch (error) {
              console.warn(`Could not fetch thumbnail for ${item.part_number} REV${item.revision}:`, error)
            }
          })
          await Promise.all(partPromises)
        } catch (error) {
          console.warn('Could not fetch additional part details:', error)
        }
        
        // Prioritize database data over localStorage
        // Merge saved localStorage data with database data, but database takes precedence for received items
        // IMPORTANT: Always preserve server-computed remaining quantities over stale localStorage values
        const savedQcData = qcDataByPO[poId]
        let qcDataToUse = initialQcData.map(dbItem => {
          // Start with database data (most authoritative)
          if (savedQcData) {
            // Find corresponding item in localStorage
            const savedItem = savedQcData.find(
              item => item.part_number === dbItem.part_number && item.revision === dbItem.revision
            )
            if (savedItem) {
              // If item is received in database, use database data (authoritative)
              if (dbItem.received) {
                return dbItem
              }
              // Otherwise, merge saved data with database data (preserve unsaved changes)
              // But ALWAYS keep server-computed remaining quantities and arrival/approved values
              return {
                ...savedItem,
                // The database is authoritative for received status — a stale
                // localStorage `received: true` would make the row permanently
                // un-receivable on this browser after an undo elsewhere
                received: dbItem.received,
                checked: dbItem.received ? true : savedItem.checked,
                // Always use fresh server-computed remaining quantities
                qty_remaining: dbItem.qty_remaining,
                total_ordered: dbItem.total_ordered,
                total_received: dbItem.total_received,
                // Use server remaining for arrival/approved (these reflect cross-delivery state)
                qty_arrived: dbItem.qty_arrived,
                qty_approved: dbItem.qty_approved
              }
            }
          }
          return dbItem
        })
        
        // Fetch revision mismatches for this PO
        let mismatchMap = {}
        try {
          const mismatchRes = await rfqService.getRevisionMismatches(poId)
          if (mismatchRes.data?.success && mismatchRes.data.mismatches?.length > 0) {
            mismatchRes.data.mismatches.forEach(m => {
              mismatchMap[`${m.part_number}_${m.po_revision}`] = m
            })
          }
        } catch (err) {
          console.warn('Could not fetch revision mismatches:', err)
        }
        setRevisionMismatches(mismatchMap)
        setRevisionDecisions({})

        setCurrentPOForReceiving(po)
        setQcData(qcDataToUse)
        setPoReceivedPartThumbnails(thumbnailMap)
        setPoReceivedHoveredPart(null)
        setPoReceivedThumbnailAnchor(null)
        setPoReceivedSearchTerm('')
        setShowPOReceivedModal(true)
      } else {
        showNotification('Failed to load PO details', 'error')
      }
    } catch (error) {
      console.error('Error loading PO details:', error)
      showNotification(error.response?.data?.error || 'Error loading PO details', 'error')
    }
  }

  const handlePartialReceive = async () => {
    if (!currentPOForReceiving) return

    // Get only checked items that are not already received
    const checkedItems = qcData.filter(item => item.checked && !item.received)

    if (checkedItems.length === 0) {
      showNotification('Please select at least one unchecked part to receive', 'warning')
      return
    }

    // Check for unresolved revision mismatches among checked items
    const unresolvedMismatches = checkedItems.filter(item => {
      const key = `${item.part_number}_${item.revision}`
      return revisionMismatches[key] && !revisionDecisions[key]
    })
    if (unresolvedMismatches.length > 0) {
      setShowRevisionMismatchDialog(true)
      return
    }

    // Validate warehouse box numbers before submitting
    const validationErrors = []
    const duplicateChecks = []
    
    for (let i = 0; i < qcData.length; i++) {
      const item = qcData[i]
      const boxNumber = (item.warehouse_box_number || '').trim()
      
      // Skip validation for unchecked or already received items
      if (!item.checked || item.received) continue
      
      // Validate pattern
      if (boxNumber) {
        const validation = validateWarehouseBoxNumber(boxNumber)
        if (!validation.isValid) {
          validationErrors.push({
            index: i,
            partNumber: item.part_number,
            revision: item.revision,
            error: validation.error
          })
        } else {
          // Check for duplicates
          const key = `${item.part_number}_${item.revision}`
          const alreadyConfirmed = duplicateConfirmations[key]
          
          if (!alreadyConfirmed) {
            duplicateChecks.push({
              index: i,
              partNumber: item.part_number,
              revision: item.revision,
              boxNumber: boxNumber
            })
          }
        }
      }
    }
    
    // Show errors for invalid patterns
    if (validationErrors.length > 0) {
      const firstError = validationErrors[0]
      showNotification(`Invalid warehouse box number for ${firstError.partNumber} REV${firstError.revision}: ${firstError.error}`, 'error')
      return
    }
    
    // Check for duplicates and ask for confirmation
    for (const duplicateCheck of duplicateChecks) {
      try {
        const duplicateResult = await checkWarehouseBoxDuplicate(duplicateCheck.boxNumber)
        if (duplicateResult.exists) {
          const partInfo = duplicateResult.partInfo
          const message = `Warehouse box number ${duplicateCheck.boxNumber} already exists for part ${partInfo.part_number} REV${partInfo.revision}. Are you sure you want to use it again?`
          const confirmed = window.confirm(message)
          
          if (!confirmed) {
            showNotification('Submission cancelled. Please update warehouse box numbers.', 'info')
            return
          }
          
          // Store confirmation
          const key = `${duplicateCheck.partNumber}_${duplicateCheck.revision}`
          setDuplicateConfirmations(prev => ({
            ...prev,
            [key]: true
          }))
        }
      } catch (error) {
        console.error('Error checking duplicate:', error)
      }
    }

    setMarkingReceived(true)
    try {
      // First, save ALL QC data to database (so it persists across users/computers)
      const qcDataForSave = qcData.map(item => ({
        part_number: item.part_number,
        revision: item.revision,
        quantity_in_po: item.quantity_in_po,
        qty_arrived: item.qty_arrived,
        qty_approved: item.qty_approved,
        qc_approved: item.received || item.checked, // Preserve approval for already-received items, approve newly checked items
        warehouse_box_number: item.warehouse_box_number,
        notes: item.notes
      }))
      
      // Save all QC data to database first
      await rfqService.savePOQCDetails(currentPOForReceiving.id, qcDataForSave)
      
      // Then, convert to format expected by partial receive endpoint
      const qcDataForBackend = qcData.map(item => ({
        part_number: item.part_number,
        revision: item.revision,
        quantity_in_po: item.quantity_in_po,
        checked: item.checked && !item.received, // Only send checked items that aren't already received
        qty_arrived: item.qty_arrived,
        qty_approved: item.qty_approved,
        warehouse_box_number: item.warehouse_box_number,
        notes: item.notes
      }))

      // Build revision decisions for backend (only for checked items with mismatches)
      const decisionsForBackend = {}
      checkedItems.forEach(item => {
        const key = `${item.part_number}_${item.revision}`
        if (revisionDecisions[key]) {
          decisionsForBackend[key] = revisionDecisions[key]
        }
      })
      const hasDecisions = Object.keys(decisionsForBackend).length > 0

      const response = await rfqService.partialReceivePO(
        currentPOForReceiving.id,
        qcDataForBackend,
        hasDecisions ? decisionsForBackend : null
      )

      if (response.data.success) {
        showNotification(response.data.message || `${checkedItems.length} part(s) received and inventory updated`, 'success')
        
        // Mark the received parts as received in the UI (keep them checked and preserve their values)
        const updatedQcData = qcData.map(item => {
          if (item.checked && !item.received) {
            return { ...item, received: true, checked: true } // Keep checked state for received parts
          }
          return item
        })
        setQcData(updatedQcData)
        
        // Save updated QC data to preserve state when modal is closed/reopened
        // Also persist to localStorage to survive page refreshes
        if (currentPOForReceiving) {
          // If all items are now received, clean up localStorage for this PO
          const allNowReceived = updatedQcData.every(item => item.received)
          if (allNowReceived) {
            setQcDataByPO(prev => {
              const cleaned = { ...prev }
              delete cleaned[currentPOForReceiving.id]
              try {
                localStorage.setItem('qcDataByPO', JSON.stringify(cleaned))
              } catch (error) {
                console.warn('Error updating localStorage:', error)
              }
              return cleaned
            })
          } else {
            const updated = {
              ...qcDataByPO,
              [currentPOForReceiving.id]: updatedQcData
            }
            setQcDataByPO(updated)
            try {
              localStorage.setItem('qcDataByPO', JSON.stringify(updated))
            } catch (error) {
              console.warn('Error saving QC data to localStorage:', error)
            }
          }
        }

        // Notify about parts that couldn't be found in the database
        if (response.data.parts_not_found && response.data.parts_not_found.length > 0) {
          const partsList = response.data.parts_not_found.join(', ')
          showNotification(
            `Warning: The following parts could not be updated because they were not found in the database: ${partsList}. Contact an admin to refresh the part revision.`,
            'warning'
          )
        }

        // Notify about parts resolved via backward-compatible fallback
        if (response.data.parts_resolved && response.data.parts_resolved.length > 0) {
          const resolvedList = response.data.parts_resolved.join(', ')
          showNotification(
            `Note: The following parts were updated to a newer backward-compatible revision: ${resolvedList}`,
            'info'
          )
        }

        // Check if parent PO was auto-received
        if (response.data.parent_auto_received) {
          showNotification('All parts received across all deliveries! Parent PO has been automatically marked as received.', 'success')
        }

        // Check if this PO was auto-marked as fully received
        if (response.data.po_auto_received) {
          showNotification('All items received! PO has been marked as complete.', 'success')
          // Show email notification dialog only for admin/engineer roles
          if (user?.role !== 'floor' && user?.role !== 'floor_manager') {
            setEmailNotifyDialog({ open: true, poId: currentPOForReceiving.id, poNumber: currentPOForReceiving.po_number })
          }
          // Close the modal and switch to received tab
          setShowPOReceivedModal(false)
          setCurrentPOForReceiving(null)
          setQcData([])
          setPoReceivedPartThumbnails({})
          setPoReceivedHoveredPart(null)
          setPoReceivedThumbnailAnchor(null)
          setPoReceivedSearchTerm('')
          setActivePOTab('received')
        }

        // Refresh remaining quantities for delivery POs so the column updates
        if (currentPOForReceiving?.parent_po_id) {
          try {
            const remainingResponse = await rfqService.getRemainingQuantities(currentPOForReceiving.parent_po_id)
            if (remainingResponse.data.success) {
              const remainingData = remainingResponse.data.remaining || []
              const refreshedQcData = updatedQcData.map(item => {
                const remainingItem = remainingData.find(
                  r => r.part_number === item.part_number && r.revision === item.revision
                )
                if (remainingItem) {
                  // Update remaining qty display for ALL items (received and non-received)
                  const updated = {
                    ...item,
                    qty_remaining: remainingItem.qty_remaining,
                    total_ordered: remainingItem.total_ordered,
                    total_received: remainingItem.total_received
                  }
                  // For non-received items, also update the arrival/approved fields
                  if (!item.received) {
                    updated.qty_arrived = remainingItem.qty_remaining
                    updated.qty_approved = remainingItem.qty_remaining
                  }
                  return updated
                }
                return item
              })
              setQcData(refreshedQcData)
            }
          } catch (error) {
            console.warn('Could not refresh remaining quantities:', error)
          }
        }

        // Reload POs to reflect any status changes
        loadPOs()
        // Keep modal open - don't close it
      } else {
        showNotification(response.data.error || 'Failed to receive parts', 'error')
      }
    } catch (error) {
      console.error('Error receiving parts:', error)
      showNotification(error.response?.data?.error || 'Error receiving parts', 'error')
    } finally {
      setMarkingReceived(false)
    }
  }

  const handleRefreshPartRevision = async (partNumber, oldRevision) => {
    if (!currentPOForReceiving) return
    if (!window.confirm(`Update ${partNumber} from ${oldRevision} to latest revision from BOM?`)) return

    setRefreshingPart(partNumber)
    try {
      const response = await rfqService.refreshPartRevision(
        currentPOForReceiving.id, partNumber, oldRevision
      )
      if (response.data.success) {
        showNotification(`Updated ${partNumber} to ${response.data.new_revision}`, 'success')
        // Update qcData with new revision
        setQcData(prev => prev.map(item =>
          item.part_number === partNumber && item.revision === oldRevision
            ? { ...item, revision: response.data.new_revision, part_exists: true, has_compatible_fallback: false }
            : item
        ))
      } else {
        showNotification(response.data.error || 'Failed to refresh revision', 'error')
      }
    } catch (error) {
      console.error('Error refreshing part revision:', error)
      showNotification(error.response?.data?.error || 'Error refreshing revision', 'error')
    } finally {
      setRefreshingPart(null)
    }
  }

  const handleUndoPartReceived = async (partNumber, revision) => {
    if (!currentPOForReceiving) return
    
    if (!window.confirm(`Are you sure you want to undo the received status for ${partNumber} REV${revision}? This will subtract from inventory.`)) {
      return
    }

    setMarkingReceived(true)
    try {
      const response = await rfqService.undoPartReceived(
        currentPOForReceiving.id,
        partNumber,
        revision
      )
      
      if (response.data.success) {
        showNotification(response.data.message || `Part ${partNumber} REV${revision} received status undone`, 'success')
        
        // Reload QC data from backend to ensure we're in sync
        try {
          const qcResponse = await rfqService.getPOQCDetails(currentPOForReceiving.id)
          if (qcResponse.data.success && qcResponse.data.qc_data) {
            const existingQcItems = qcResponse.data.qc_data || []
            
            // Update the part in qcData based on backend status
            const updatedQcData = qcData.map(item => {
              if (item.part_number === partNumber && item.revision === revision) {
                // Check backend to see if it's still marked as received
                const backendQc = existingQcItems.find(
                  eq => eq.part_number === item.part_number && eq.revision === item.revision && eq.qc_approved === true
                )
                // If backend says it's not received (or not found), mark as not received
                return { 
                  ...item, 
                  received: backendQc ? true : false, 
                  checked: backendQc ? true : false,
                  // Update values from backend if available
                  qty_arrived: backendQc?.qty_arrived ?? item.qty_arrived,
                  qty_approved: backendQc?.qty_approved ?? item.qty_approved,
                  warehouse_box_number: backendQc?.warehouse_box_number ?? item.warehouse_box_number,
                  notes: backendQc?.notes ?? item.notes
                }
              }
              // For other parts, check if backend status changed
              const backendQc = existingQcItems.find(
                eq => eq.part_number === item.part_number && eq.revision === item.revision && eq.qc_approved === true
              )
              if (backendQc && !item.received) {
                // Backend says it's received but our state says it's not - update it
                return {
                  ...item,
                  received: true,
                  checked: true,
                  qty_arrived: backendQc.qty_arrived ?? item.qty_arrived,
                  qty_approved: backendQc.qty_approved ?? item.qty_approved,
                  warehouse_box_number: backendQc.warehouse_box_number ?? item.warehouse_box_number,
                  notes: backendQc.notes ?? item.notes
                }
              }
              return item
            })
            
            setQcData(updatedQcData)
            
            // Save updated QC data to preserve state when modal is closed/reopened
            // Also persist to localStorage to survive page refreshes
            if (currentPOForReceiving) {
              const updated = {
                ...qcDataByPO,
                [currentPOForReceiving.id]: updatedQcData
              }
              setQcDataByPO(updated)
              try {
                localStorage.setItem('qcDataByPO', JSON.stringify(updated))
              } catch (error) {
                console.warn('Error saving QC data to localStorage:', error)
              }
            }
          } else {
            // Fallback: just update the local state if backend reload fails
            const updatedQcData = qcData.map(item => {
              if (item.part_number === partNumber && item.revision === revision) {
                return { ...item, received: false, checked: false }
              }
              return item
            })
            setQcData(updatedQcData)
            
            if (currentPOForReceiving) {
              const updated = {
                ...qcDataByPO,
                [currentPOForReceiving.id]: updatedQcData
              }
              setQcDataByPO(updated)
              try {
                localStorage.setItem('qcDataByPO', JSON.stringify(updated))
              } catch (error) {
                console.warn('Error saving QC data to localStorage:', error)
              }
            }
          }
        } catch (error) {
          console.warn('Error reloading QC data after undo:', error)
          // Fallback: just update the local state
          const updatedQcData = qcData.map(item => {
            if (item.part_number === partNumber && item.revision === revision) {
              return { ...item, received: false, checked: false }
            }
            return item
          })
          setQcData(updatedQcData)
          
          if (currentPOForReceiving) {
            const updated = {
              ...qcDataByPO,
              [currentPOForReceiving.id]: updatedQcData
            }
            setQcDataByPO(updated)
            try {
              localStorage.setItem('qcDataByPO', JSON.stringify(updated))
            } catch (error) {
              console.warn('Error saving QC data to localStorage:', error)
            }
          }
        }
        
        // Refresh remaining quantities for delivery POs
        if (currentPOForReceiving?.parent_po_id) {
          try {
            const remainingResponse = await rfqService.getRemainingQuantities(currentPOForReceiving.parent_po_id)
            if (remainingResponse.data.success) {
              const remainingData = remainingResponse.data.remaining || []
              setQcData(prev => prev.map(item => {
                const remainingItem = remainingData.find(
                  r => r.part_number === item.part_number && r.revision === item.revision
                )
                if (remainingItem) {
                  const updated = {
                    ...item,
                    qty_remaining: remainingItem.qty_remaining,
                    total_ordered: remainingItem.total_ordered,
                    total_received: remainingItem.total_received
                  }
                  if (!item.received) {
                    updated.qty_arrived = remainingItem.qty_remaining
                    updated.qty_approved = remainingItem.qty_remaining
                  }
                  return updated
                }
                return item
              }))
            }
          } catch (error) {
            console.warn('Could not refresh remaining quantities after undo:', error)
          }
        }

        // Reload POs to reflect any status changes
        loadPOs()
      } else {
        showNotification(response.data.error || 'Failed to undo part received status', 'error')
      }
    } catch (error) {
      console.error('Error undoing part received:', error)
      showNotification(error.response?.data?.error || 'Error undoing part received status', 'error')
    } finally {
      setMarkingReceived(false)
    }
  }

  const handleSubmitPOReceived = async () => {
    if (!currentPOForReceiving) return

    // Check if all items are checked (including already received ones)
    const allChecked = qcData.every(item => item.checked)
    if (!allChecked) {
      showNotification('Please check all items before marking as received', 'warning')
      return
    }

    // Check for unresolved revision mismatches among non-received items
    const unresolvedMismatches = qcData.filter(item => {
      if (item.received) return false
      const key = `${item.part_number}_${item.revision}`
      return revisionMismatches[key] && !revisionDecisions[key]
    })
    if (unresolvedMismatches.length > 0) {
      setShowRevisionMismatchDialog(true)
      return
    }

    // Validate warehouse box numbers before submitting
    const validationErrors = []
    const duplicateChecks = []
    
    for (let i = 0; i < qcData.length; i++) {
      const item = qcData[i]
      const boxNumber = (item.warehouse_box_number || '').trim()
      
      // Skip validation for already received items
      if (item.received) continue
      
      // Validate pattern
      if (boxNumber) {
        const validation = validateWarehouseBoxNumber(boxNumber)
        if (!validation.isValid) {
          validationErrors.push({
            index: i,
            partNumber: item.part_number,
            revision: item.revision,
            error: validation.error
          })
        } else {
          // Check for duplicates
          const key = `${item.part_number}_${item.revision}`
          const alreadyConfirmed = duplicateConfirmations[key]
          
          if (!alreadyConfirmed) {
            duplicateChecks.push({
              index: i,
              partNumber: item.part_number,
              revision: item.revision,
              boxNumber: boxNumber
            })
          }
        }
      }
    }
    
    // Show errors for invalid patterns
    if (validationErrors.length > 0) {
      const firstError = validationErrors[0]
      showNotification(`Invalid warehouse box number for ${firstError.partNumber} REV${firstError.revision}: ${firstError.error}`, 'error')
      return
    }
    
    // Check for duplicates and ask for confirmation
    for (const duplicateCheck of duplicateChecks) {
      try {
        const duplicateResult = await checkWarehouseBoxDuplicate(duplicateCheck.boxNumber)
        if (duplicateResult.exists) {
          const partInfo = duplicateResult.partInfo
          const message = `Warehouse box number ${duplicateCheck.boxNumber} already exists for part ${partInfo.part_number} REV${partInfo.revision}. Are you sure you want to use it again?`
          const confirmed = window.confirm(message)
          
          if (!confirmed) {
            showNotification('Submission cancelled. Please update warehouse box numbers.', 'info')
            return
          }
          
          // Store confirmation
          const key = `${duplicateCheck.partNumber}_${duplicateCheck.revision}`
          setDuplicateConfirmations(prev => ({
            ...prev,
            [key]: true
          }))
        }
      } catch (error) {
        console.error('Error checking duplicate:', error)
      }
    }

    setMarkingReceived(true)
    try {
      // Convert to format expected by backend (qc_approved based on checked status)
      // Only send items that are not already received (to avoid double-counting)
      const qcDataForBackend = qcData
        .filter(item => !item.received) // Skip already-received parts
        .map(item => ({
          part_number: item.part_number,
          revision: item.revision,
          quantity_in_po: item.quantity_in_po,
          qc_approved: item.checked, // Use checked status
          qty_arrived: item.qty_arrived,
          qty_approved: item.qty_approved,
          warehouse_box_number: item.warehouse_box_number,
          notes: item.notes
        }))
      
      // Build revision decisions for backend
      const decisionsForFullReceive = {}
      qcData.filter(item => !item.received).forEach(item => {
        const key = `${item.part_number}_${item.revision}`
        if (revisionDecisions[key]) {
          decisionsForFullReceive[key] = revisionDecisions[key]
        }
      })
      const hasFullDecisions = Object.keys(decisionsForFullReceive).length > 0

      const response = await rfqService.markPOReceived(
        currentPOForReceiving.id,
        qcDataForBackend,
        hasFullDecisions ? decisionsForFullReceive : null
      )
      if (response.data.success) {
        showNotification('PO marked as received and inventory updated', 'success')

        // Notify about parts that couldn't be found in the database
        if (response.data.parts_not_found && response.data.parts_not_found.length > 0) {
          const partsList = response.data.parts_not_found.join(', ')
          showNotification(
            `Warning: The following parts could not be updated because they were not found in the database: ${partsList}. Contact an admin to refresh the part revision.`,
            'warning'
          )
        }

        // Notify about parts resolved via backward-compatible fallback
        if (response.data.parts_resolved && response.data.parts_resolved.length > 0) {
          const resolvedList = response.data.parts_resolved.join(', ')
          showNotification(
            `Note: The following parts were updated to a newer backward-compatible revision: ${resolvedList}`,
            'info'
          )
        }

        // Check if parent PO was auto-received
        if (response.data.parent_auto_received) {
          showNotification('All parts received across all deliveries! Parent PO has been automatically marked as received.', 'success')
        }

        // Clear saved QC data for this PO since it's now fully received
        // Also remove from localStorage
        setQcDataByPO(prev => {
          const updated = { ...prev }
          delete updated[currentPOForReceiving.id]
          // Update localStorage
          try {
            localStorage.setItem('qcDataByPO', JSON.stringify(updated))
          } catch (error) {
            console.warn('Error updating localStorage:', error)
          }
          return updated
        })
        // Show email notification dialog only for admin/engineer roles
        if (user?.role !== 'floor' && user?.role !== 'floor_manager') {
          setEmailNotifyDialog({ open: true, poId: currentPOForReceiving.id, poNumber: currentPOForReceiving.po_number })
        }
        setShowPOReceivedModal(false)
        setCurrentPOForReceiving(null)
        setQcData([])
        setPoReceivedPartThumbnails({})
        setPoReceivedHoveredPart(null)
        setPoReceivedThumbnailAnchor(null)
        setPoReceivedSearchTerm('')
        loadPOs()
      } else {
        showNotification(response.data.error || 'Failed to update PO status', 'error')
      }
    } catch (error) {
      console.error('Error updating PO status:', error)
      showNotification(error.response?.data?.error || 'Error updating PO status', 'error')
    } finally {
      setMarkingReceived(false)
    }
  }

  const handleSendReceivedEmail = () => {
    if (!emailNotifyDialog.poId) return

    // Find the PO to get its details
    const po = pos.find(p => p.id === emailNotifyDialog.poId)
    if (!po) {
      showNotification('PO not found', 'error')
      return
    }

    // Sender is always the currently connected user
    const senderName = user?.username || 'MenteeBOM User'

    // Format the email content with professional template
    const subject = `PO ${emailNotifyDialog.poNumber} received notification`
    const body = `Dear Finance Team,

I am writing to formally confirm that we have received the shipment associated with PO ${emailNotifyDialog.poNumber}.

Please find the delivery details summarized below:

Receipt Summary
Order Number: ${emailNotifyDialog.poNumber}
Vendor: ${po.vendor || 'N/A'}
Tracking Number: ${po.waybill || 'N/A'}
Invoice Number: ${po.invoice_number || 'N/A'}
Date Received: ${po.received_date ? new Date(po.received_date).toLocaleDateString() : 'N/A'}
Received By: ${senderName}

We have logged this delivery into our warehouse.
Thank you, you can proceed with payment as in the payment terms.

Best regards,

${senderName}`

    // Send only to the Finance team (no CC), open Gmail compose in a new tab
    const gmailUrl = `https://mail.google.com/mail/u/0/?view=cm&to=${encodeURIComponent(FINANCE_EMAIL)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.open(gmailUrl, '_blank', 'noopener,noreferrer')

    // Close dialog and show notification
    showNotification(`Gmail opened in new tab - review and send`, 'success')
    setEmailNotifyDialog({ open: false, poId: null, poNumber: '' })
  }

  const handleStartEditQC = () => {
    setEditingQCDataState([...viewQCData])
    setEditingQCData(true)
  }

  const handleCancelEditQC = () => {
    setEditingQCData(false)
    setEditingQCDataState([])
  }

  const handleSaveEditQC = async () => {
    if (!currentPOForViewing) return

    // Validate warehouse box numbers before submitting
    const validationErrors = []
    const duplicateChecks = []
    
    for (let i = 0; i < editingQCDataState.length; i++) {
      const item = editingQCDataState[i]
      const boxNumber = (item.warehouse_box_number || '').trim()
      
      // Validate pattern
      if (boxNumber) {
        const validation = validateWarehouseBoxNumber(boxNumber)
        if (!validation.isValid) {
          validationErrors.push({
            index: i,
            partNumber: item.part_number,
            revision: item.revision,
            error: validation.error
          })
        } else {
          // Check for duplicates
          const key = `${item.part_number}_${item.revision}`
          const alreadyConfirmed = duplicateConfirmations[key]
          
          if (!alreadyConfirmed) {
            duplicateChecks.push({
              index: i,
              partNumber: item.part_number,
              revision: item.revision,
              boxNumber: boxNumber
            })
          }
        }
      }
    }
    
    // Show errors for invalid patterns
    if (validationErrors.length > 0) {
      const firstError = validationErrors[0]
      showNotification(`Invalid warehouse box number for ${firstError.partNumber} REV${firstError.revision}: ${firstError.error}`, 'error')
      setUpdatingQCData(false)
      return
    }
    
    // Check for duplicates and ask for confirmation
    for (const duplicateCheck of duplicateChecks) {
      try {
        const duplicateResult = await checkWarehouseBoxDuplicate(duplicateCheck.boxNumber)
        if (duplicateResult.exists) {
          const partInfo = duplicateResult.partInfo
          const message = `Warehouse box number ${duplicateCheck.boxNumber} already exists for part ${partInfo.part_number} REV${partInfo.revision}. Are you sure you want to use it again?`
          const confirmed = window.confirm(message)
          
          if (!confirmed) {
            showNotification('Save cancelled. Please update warehouse box numbers.', 'info')
            setUpdatingQCData(false)
            return
          }
          
          // Store confirmation
          const key = `${duplicateCheck.partNumber}_${duplicateCheck.revision}`
          setDuplicateConfirmations(prev => ({
            ...prev,
            [key]: true
          }))
        }
      } catch (error) {
        console.error('Error checking duplicate:', error)
      }
    }

    setUpdatingQCData(true)
    try {
      // Update QC data
      const response = await rfqService.savePOQCDetails(currentPOForViewing.id, editingQCDataState)
      if (response.data.success) {
        // Also need to update inventory if quantities changed
        // This might require a separate endpoint or we can handle it in save
        showNotification('QC data updated successfully', 'success')
        setViewQCData(editingQCDataState)
        setEditingQCData(false)
        loadPOs() // Refresh PO list
      } else {
        showNotification(response.data.error || 'Failed to update QC data', 'error')
      }
    } catch (error) {
      console.error('Error updating QC data:', error)
      showNotification(error.response?.data?.error || 'Error updating QC data', 'error')
    } finally {
      setUpdatingQCData(false)
    }
  }

  const handleViewQCDetails = async (poId) => {
    try {
      const response = await rfqService.getPOQCDetails(poId)
      if (response.data.success) {
        setViewQCData(response.data.qc_data || [])
        const po = pos.find(p => p.id === poId)
        setCurrentPOForViewing(po)
        setShowViewQCModal(true)
      } else {
        showNotification('Failed to load QC data', 'error')
      }
    } catch (error) {
      console.error('Error loading QC data:', error)
      showNotification(error.response?.data?.error || 'Error loading QC data', 'error')
    }
  }

  const handleExportQCToExcel = async (poId) => {
    try {
      const response = await rfqService.exportPOQCToExcel(poId)
      // Create blob and download
      const blob = new Blob([response.data], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const po = pos.find(p => p.id === poId)
      link.download = `PO_${po?.po_number || poId}_QC_Data.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      showNotification('QC data exported successfully', 'success')
    } catch (error) {
      console.error('Error exporting QC data:', error)
      showNotification(error.response?.data?.error || 'Error exporting QC data', 'error')
    }
  }

  const handleUndoPOReceived = async (poId) => {
    if (!window.confirm('Are you sure you want to undo the received status? This will subtract from inventory and order quantity.')) {
      return
    }

    try {
      const response = await rfqService.undoPOReceived(poId)
      if (response.data.success) {
        showNotification('PO received status undone and inventory/order_qty updated', 'success')
        // Clear localStorage QC data for this PO so modal doesn't show stale received state
        setQcDataByPO(prev => {
          const cleaned = { ...prev }
          delete cleaned[poId]
          try {
            localStorage.setItem('qcDataByPO', JSON.stringify(cleaned))
          } catch (err) {
            console.warn('Error updating localStorage:', err)
          }
          return cleaned
        })
        loadPOs()
      } else {
        showNotification(response.data.error || 'Failed to undo PO received status', 'error')
      }
    } catch (error) {
      console.error('Error undoing PO received:', error)
      showNotification(error.response?.data?.error || 'Error undoing PO received status', 'error')
    }
  }

  const handleOpenEditPO = async (po) => {
    setEditPOOpen(true)
    setEditPOLoading(true)
    setEditPOData({
      id: po.id,
      po_number: po.po_number,
      vendor: po.vendor || '',
      currency: (po.currency || 'USD').toUpperCase(),
      lead_time: po.lead_time || '',
    })
    setEditPOItems([])
    try {
      const res = await rfqService.getPODetails(po.id)
      if (res.data.success) {
        const cur = (res.data.po.currency || 'USD').toUpperCase()
        setEditPOData({
          id: res.data.po.id,
          po_number: res.data.po.po_number,
          vendor: res.data.po.vendor || '',
          currency: cur,
          lead_time: res.data.po.lead_time || '',
          has_doc_vars: !!res.data.po.has_doc_vars,
        })
        const items = (res.data.items || []).map(it => ({
          part_number: it.part_number,
          revision: it.revision,
          quantity: it.quantity,
          unit_cost: it.original_unit_cost != null ? it.original_unit_cost : it.unit_cost,
          material: it.material || '',
          finish1: it.finish1 || '',
          finish2: it.finish2 || '',
        }))
        setEditPOItems(items)
      } else {
        showNotification(res.data.error || 'Failed to load PO', 'error')
        setEditPOOpen(false)
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'Failed to load PO', 'error')
      setEditPOOpen(false)
    } finally {
      setEditPOLoading(false)
    }
  }

  const handleEditPOItemChange = (idx, field, value) => {
    setEditPOItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const handleEditPORemoveItem = (idx) => {
    setEditPOItems(prev => prev.filter((_, i) => i !== idx))
  }

  const handleEditPOSearchAdd = async (term) => {
    setEditPOAddSearch(term)
    if (!term || term.trim().length < 2) {
      setEditPOAddResults([])
      return
    }
    try {
      const res = await bomService.searchParts(term.trim(), 25)
      setEditPOAddResults(res.data.success ? (res.data.parts || []) : [])
    } catch {
      setEditPOAddResults([])
    }
  }

  const handleEditPOAddPart = (part) => {
    if (editPOItems.some(it => it.part_number === part.part_number)) {
      showNotification(`${part.part_number} is already in this PO`, 'warning')
      return
    }
    setEditPOItems(prev => [...prev, {
      part_number: part.part_number,
      revision: part.revision || 'REV01',
      quantity: 1,
      unit_cost: 0,
      material: part.material || '',
      finish1: part.finish1 || '',
      finish2: part.finish2 || '',
    }])
  }

  const handleSaveEditPO = async () => {
    if (!editPOData) return
    if (!editPOData.vendor || !editPOData.vendor.trim()) {
      showNotification('Vendor is required', 'warning')
      return
    }
    if (editPOItems.length === 0) {
      showNotification('PO must have at least one item', 'warning')
      return
    }
    const missing = editPOItems.filter(it => !it.unit_cost || parseFloat(it.unit_cost) <= 0)
    if (missing.length > 0) {
      showNotification(`Missing prices: ${missing.map(m => m.part_number).join(', ')}`, 'warning')
      return
    }

    // If the PO already has stored doc template vars (saved at creation or a
    // previous edit), regenerate the doc silently with them — no re-filling.
    if (editPOData.has_doc_vars) {
      await doSaveEditPO({ regenerate_doc: true })
      return
    }

    // Otherwise (older PO, nothing stored) collect the details once via the
    // PO Document modal — they'll be stored for next time
    const selectedVendorObj = vendors.find(v => v.name === editPOData.vendor)
    const leadDays = editPOData.lead_time === '' ? null : parseInt(editPOData.lead_time)
    setPoTemplateVars({
      contact_name: selectedVendorObj?.contact_name || '',
      quotation_number: '',
      quotation_date: '',
      delivery_date: leadDays ? leadTimeToDateString(leadDays) : '',
      payment_terms: '',
      orderer_name: user?.username || '',
      orderer_email: user?.email || '',
      orderer_phone: user?.phone || '',
      approver_name: '',
      approver_title: ''
    })
    setGeneratePODocument(true)
    setPoDocumentSource('edit')
    setShowPODocumentModal(true)
  }

  const handleConfirmEditPO = async () => {
    setShowPODocumentModal(false)
    await doSaveEditPO({ template_vars: generatePODocument ? poTemplateVars : null })
  }

  const doSaveEditPO = async (docPayload) => {
    if (!editPOData) return
    setEditPOSaving(true)
    try {
      const payload = {
        vendor: editPOData.vendor.trim(),
        currency: editPOData.currency,
        lead_time: editPOData.lead_time === '' ? null : parseInt(editPOData.lead_time),
        parts_with_prices: editPOItems.map(it => ({
          part_number: it.part_number,
          revision: it.revision,
          quantity: parseInt(it.quantity) || 1,
          unit_cost: parseFloat(it.unit_cost) || 0,
          material: it.material || '',
          finish1: it.finish1 || '',
          finish2: it.finish2 || '',
        })),
        ...docPayload,
      }
      const res = await rfqService.editPO(editPOData.id, payload)
      if (res.data.success) {
        const docNote = res.data.po_doc_url ? ' & PO document regenerated' : ''
        showNotification(`PO ${res.data.po_number} updated — files replaced in Drive folder${docNote}`, 'success')
        if (res.data.po_doc_url) {
          window.open(res.data.po_doc_url, '_blank')
        }
        setEditPOOpen(false)
        setEditPOData(null)
        setEditPOItems([])
        loadPOs()
      } else {
        showNotification(res.data.error || 'Failed to update PO', 'error')
      }
    } catch (err) {
      showNotification(err.response?.data?.error || 'Failed to update PO', 'error')
    } finally {
      setEditPOSaving(false)
    }
  }

  const handleRegeneratePO = async (poId) => {
    // Show initial confirmation
    if (!window.confirm('This will regenerate the PO with latest revisions. Continue?')) {
      return
    }

    setCurrentRegeneratingPOId(poId)
    // Don't set regeneratingPO here - only set it when actually executing

    try {
      // Phase 1: Detect changes
      const detectResponse = await rfqService.detectPOChanges(poId)
      
      if (detectResponse.data.success) {
        const data = detectResponse.data
        // No revision changes — still offer to regenerate the files
        // (Excel/ZIP + fresh PDF & XT from PDM at the current revisions)
        if (data.summary.revision_changes === 0) {
          if (!window.confirm('No revision changes detected. Regenerate the PO files anyway? This refreshes the Excel, ZIP and PDF/X_T files in the Drive folder at the current revisions.')) {
            setCurrentRegeneratingPOId(null)
            return
          }
          setRegeneratingPO(poId)
          try {
            const response = await rfqService.regeneratePO(poId)
            if (response.data.success) {
              showNotification('PO files regenerated in the Drive folder.', 'success')
              loadPOs()
            } else {
              showNotification(response.data.error || 'Failed to regenerate PO', 'error')
            }
          } finally {
            setRegeneratingPO(null)
            setCurrentRegeneratingPOId(null)
          }
          return
        }

        // Show revision updates modal
        setRevisionUpdatesData(data)
        setShowRevisionUpdatesModal(true)
      } else {
        showNotification(detectResponse.data.error || 'Failed to detect changes', 'error')
        setCurrentRegeneratingPOId(null)
      }
    } catch (error) {
      console.error('Error detecting PO changes:', error)
      showNotification(error.response?.data?.error || 'Error detecting changes', 'error')
      setCurrentRegeneratingPOId(null)
    }
  }

  const handleConfirmRegenerate = async () => {
    if (!currentRegeneratingPOId) return

    // Set regenerating state to show loading
    setRegeneratingPO(currentRegeneratingPOId)

    try {
      // Phase 2: Execute regeneration
      const response = await rfqService.regeneratePO(currentRegeneratingPOId)
      
      if (response.data.success) {
        const summary = response.data.summary
        const message = `PO regenerated successfully. ${summary.revision_changes} revision changes.`
        showNotification(message, 'success')
        setShowRevisionUpdatesModal(false)
        setRevisionUpdatesData(null)
        setCurrentRegeneratingPOId(null)
        loadPOs() // Refresh PO list
      } else {
        showNotification(response.data.error || 'Failed to regenerate PO', 'error')
      }
    } catch (error) {
      console.error('Error regenerating PO:', error)
      showNotification(error.response?.data?.error || 'Error regenerating PO', 'error')
    } finally {
      setRegeneratingPO(null)
    }
  }

  const handleCancelRegenerate = () => {
    setShowRevisionUpdatesModal(false)
    setRevisionUpdatesData(null)
    setCurrentRegeneratingPOId(null)
    setRegeneratingPO(null)
  }

  // Update a field on a PO in local state, including when it's a child
  // delivery rendered from the parent's nested child_pos array — updating
  // only the flat entry leaves the rendered child row unchanged.
  const updatePOFieldInState = (poId, field, value) => {
    setPos(prevPos => prevPos.map(p => {
      let next = p.id === poId ? { ...p, [field]: value } : p
      if (next.child_pos && next.child_pos.some(c => c.id === poId)) {
        next = {
          ...next,
          child_pos: next.child_pos.map(c => c.id === poId ? { ...c, [field]: value } : c)
        }
      }
      return next
    }))
  }

  const handleUpdateTracking = async (poId, field, value) => {
    try {
      const data = { [field]: value }
      const response = await rfqService.updatePOTracking(poId, data)
      if (response.data.success) {
        // Update local state
        setPos(prevPos => prevPos.map(po => 
          po.id === poId 
            ? { ...po, [field]: response.data[field] }
            : po
        ))
      } else {
        showNotification(response.data.error || 'Failed to update tracking info', 'error')
      }
    } catch (error) {
      console.error('Error updating tracking:', error)
      showNotification(error.response?.data?.error || 'Error updating tracking info', 'error')
    }
  }

  const handleUpdatePOTotalCost = async (poId, totalCost) => {
    try {
      const response = await rfqService.updatePOTotalCost(poId, totalCost)
      if (response.data.success) {
        // Update local state
        setPos(prevPos => prevPos.map(po => 
          po.id === poId 
            ? { ...po, total_cost: response.data.total_cost }
            : po
        ))
        showNotification('PO total cost updated successfully', 'success')
      } else {
        showNotification(response.data.error || 'Failed to update total cost', 'error')
      }
    } catch (error) {
      console.error('Error updating total cost:', error)
      showNotification(error.response?.data?.error || 'Error updating total cost', 'error')
    }
  }

  const getStatusColor = (status) => {
    if (status === 'active' || status === 'received') return 'success'
    if (status === 'converted_to_po' || status === 'sent_to_vendor') return 'info'
    if (status === 'pending') return 'warning'
    return 'default'
  }

  const getStatusText = (status) => {
    const statusMap = {
      'active': 'Active',
      'converted_to_po': 'Converted to PO',
      'cancelled': 'Cancelled',
      'pending': 'Pending',
      'sent_to_vendor': 'Sent to Vendor',
      'received': 'Received'
    }
    return statusMap[status] || status
  }

  // Price Update Handlers
  const handleOpenPriceUpdate = async () => {
    try {
      const response = await bomCostService.getPartTypes()
      if (response.data.success) {
        setPriceUpdateTypes(response.data.types || [])
        setPriceUpdateStep(0)
        setSelectedUpdateTypes([])
        setUpdatePartsList([])
        setSelectedUpdateParts([])
        setUpdateQuotationFiles([])
        setUpdateSearchTerm('')
        setPriceUpdateCurrency('USD')
        setPriceUpdateVendor('')
        setPriceUpdatePONumber('')
        setShowPriceUpdateModal(true)
      }
    } catch (error) {
      showNotification('Error loading part types', 'error')
    }
  }

  // Helper to sort parts by part_number
  const sortPartsByNumber = (parts, direction) => {
    if (!direction) return parts
    return [...parts].sort((a, b) => {
      const aNum = (a.part_number || '').toLowerCase()
      const bNum = (b.part_number || '').toLowerCase()
      return direction === 'asc' ? aNum.localeCompare(bNum) : bNum.localeCompare(aNum)
    })
  }

  // Filter and sort parts for Price Update modal
  const filteredUpdatePartsList = useMemo(() => {
    let list = updatePartsList
    if (updateSearchTerm.trim()) {
      const searchLower = updateSearchTerm.toLowerCase()
      list = list.filter(part => {
        const partNumber = (part.part_number || '').toLowerCase()
        const description = (part.description || '').toLowerCase()
        return partNumber.includes(searchLower) || description.includes(searchLower)
      })
    }
    if (priceUpdateVendorFilter) {
      list = list.filter(part => (part.vendor || '') === priceUpdateVendorFilter)
    }
    return sortPartsByNumber(list, priceUpdateSort)
  }, [updateSearchTerm, updatePartsList, priceUpdateSort, priceUpdateVendorFilter])

  const priceUpdateAvailableVendors = useMemo(() => {
    const vendors = new Set()
    updatePartsList.forEach(part => { if (part.vendor) vendors.add(part.vendor) })
    return Array.from(vendors).sort()
  }, [updatePartsList])

  const handleTypeSelect = (type) => {
    if (selectedUpdateTypes.includes(type)) {
      setSelectedUpdateTypes(selectedUpdateTypes.filter(t => t !== type))
    } else {
      setSelectedUpdateTypes([...selectedUpdateTypes, type])
    }
  }

  const handleTypeSelectContinue = async () => {
    if (selectedUpdateTypes.length === 0) return
    try {
      const response = await bomCostService.getPartsByTypes(selectedUpdateTypes)
      if (response.data.success) {
        setUpdatePartsList(response.data.parts || [])
        setPriceUpdateStep(1)
      }
    } catch (error) {
      showNotification('Error loading parts', 'error')
    }
  }

  const handleUpdatePartSelect = (partId) => {
    if (selectedUpdateParts.includes(partId)) {
      setSelectedUpdateParts(selectedUpdateParts.filter(id => id !== partId))
    } else {
      setSelectedUpdateParts([...selectedUpdateParts, partId])
    }
  }

  const handleUpdateFileChange = (e) => {
    setUpdateQuotationFiles(Array.from(e.target.files))
  }

  const handleProcessPriceUpdate = async () => {
    setProcessingUpdate(true)
    try {
      // Prepare the parts list for the backend
      const partsToProcess = selectedUpdateParts
        .map(id => {
          const part = updatePartsList.find(p => p.id === id)
          if (!part) {
            console.warn(`Part with id ${id} not found in updatePartsList`)
            return null
          }
          return {
            part_number: part.part_number,
            revision: part.revision || ''
          }
        })
        .filter(part => part !== null) // Remove any null entries

      // Create FormData with parts and quotation files (if any)
      const formData = new FormData()
      formData.append('parts', JSON.stringify(partsToProcess))
      formData.append('vendor', 'Unknown') // Can be made configurable later

      if (updateQuotationFiles.length > 0) {
        updateQuotationFiles.forEach(file => {
          formData.append('quotation', file)
        })
      }

      // Call the new endpoint directly
      const response = await bomCostService.processQuotationsForUpdate(formData)

      if (response.data.success) {
        // Display extracted prices for user confirmation, enrich with inventory data
        const enrichedParts = (response.data.parts || []).map(p => {
          const sourcePart = updatePartsList.find(sp => sp.part_number === p.part_number)
          const original = {
            unit_cost: sourcePart?.unit_cost || 0,
            vendor: sourcePart?.vendor || '',
            source_currency: sourcePart?.source_currency || 'USD',
            manufacturer: sourcePart?.manufacturer || '',
            manufacturer_pn: sourcePart?.manufacturer_pn || '',
            datasheet_drive_url: sourcePart?.datasheet_drive_url || '',
          }
          return {
            ...p,
            part_id: sourcePart?.id,
            current_inventory: sourcePart?.inventory || 0,
            add_inventory: 0,
            vendor: p.vendor || original.vendor,
            manufacturer: original.manufacturer,
            manufacturer_pn: original.manufacturer_pn,
            datasheet_drive_url: original.datasheet_drive_url,
            _original: original,
          }
        })
        setPartsData(enrichedParts)
        setPriceUpdateStep(2)
        if (updateQuotationFiles.length > 0) {
          showNotification(`Processed ${updateQuotationFiles.length} quotation file(s)`, 'success')
        } else {
          showNotification('Ready for manual price entry', 'info')
        }
      } else {
        showNotification(response.data.error || 'Failed to process prices', 'error')
      }

    } catch (error) {
      console.error('Error processing price update:', error)
      showNotification(error.response?.data?.error || 'Error processing price update', 'error')
    } finally {
      setProcessingUpdate(false)
    }
  }

  const handleContinueWithoutQuotation = async () => {
    if (selectedUpdateParts.length === 0) {
      showNotification('Please select at least one part', 'warning')
      return
    }

    // Prepare parts data for manual entry
    const partsToProcess = selectedUpdateParts
      .map(id => {
        const part = updatePartsList.find(p => p.id === id)
        if (!part) {
          console.warn(`Part with id ${id} not found in updatePartsList`)
          return null
        }
        const original = {
          unit_cost: part.unit_cost || 0,
          vendor: part.vendor || '',
          source_currency: part.source_currency || 'USD',
          manufacturer: part.manufacturer || '',
          manufacturer_pn: part.manufacturer_pn || '',
          datasheet_drive_url: part.datasheet_drive_url || '',
        }
        return {
          part_id: part.id,
          part_number: part.part_number,
          revision: part.revision || '',
          description: part.description || '',
          current_cost: original.unit_cost,
          unit_cost: original.unit_cost > 0 ? original.unit_cost : null,
          total_cost: null,
          price_options: [],
          has_price: false,
          quantity: 1,
          current_inventory: part.inventory || 0,
          add_inventory: 0,
          vendor: original.vendor,
          manufacturer: original.manufacturer,
          manufacturer_pn: original.manufacturer_pn,
          datasheet_drive_url: original.datasheet_drive_url,
          _original: original,
        }
      })
      .filter(part => part !== null) // Remove any null entries

    if (partsToProcess.length === 0) {
      showNotification('No valid parts found', 'error')
      return
    }

    setPartsData(partsToProcess)
    setPriceUpdateStep(2)
  }

  const handleFinalizePriceUpdate = async () => {
    setProcessingUpdate(true)
    try {
      // Build updates: only include fields that changed from _original snapshot
      const updates = partsData
        .map(p => {
          const orig = p._original || {}
          const update = { part_number: p.part_number, revision: p.revision }

          const newCost = p.unit_cost ? parseFloat(p.unit_cost) : null
          if (newCost && newCost > 0 && newCost !== (orig.unit_cost || 0))
            update.unit_cost = newCost

          const newCurrency = priceUpdateCurrency || 'USD'
          if (newCurrency !== (orig.source_currency || 'USD'))
            update.currency = newCurrency
          else if (update.unit_cost) // always send currency when sending price
            update.currency = newCurrency

          const newVendor = (p.vendor || '').trim()
          if (newVendor !== (orig.vendor || '').trim())
            update.vendor = newVendor || null

          const addInv = p.add_inventory ? parseInt(p.add_inventory) : 0
          if (addInv > 0) update.add_inventory = addInv

          const newMfr = (p.manufacturer || '').trim()
          if (newMfr !== (orig.manufacturer || '').trim())
            update.manufacturer = newMfr

          const newMfrPn = (p.manufacturer_pn || '').trim()
          if (newMfrPn !== (orig.manufacturer_pn || '').trim())
            update.manufacturer_pn = newMfrPn

          const newDatasheet = (p.datasheet_drive_url || '').trim()
          if (newDatasheet !== (orig.datasheet_drive_url || '').trim())
            update.datasheet_drive_url = newDatasheet

          // Only include if there's something beyond part_number + revision
          return Object.keys(update).length > 2 ? update : null
        })
        .filter(Boolean)

      if (updates.length === 0) {
        showNotification('No changes to update. Please enter at least one price or inventory quantity.', 'warning')
        setProcessingUpdate(false)
        return
      }

      const response = await bomCostService.updatePartPrices(updates, priceUpdatePONumber.trim() || null)

      if (response.data.success) {
        const msgs = []
        if (response.data.updated_count > 0) msgs.push(`${response.data.updated_count} prices`)
        if (response.data.inventory_updated_count > 0) msgs.push(`${response.data.inventory_updated_count} inventory quantities`)
        showNotification(`Successfully updated ${msgs.join(' and ')}`, 'success')
        setShowPriceUpdateModal(false)
        setPartsData([])
        
        // Dispatch custom event to notify other pages about price updates
        const affectedAssemblies = response.data.affected_assemblies || []
        if (affectedAssemblies.length > 0) {
          const event = new CustomEvent('priceUpdateComplete', {
            detail: {
              affected_assemblies: affectedAssemblies,
              updated_count: response.data.updated_count
            }
          })
          window.dispatchEvent(event)
        }
      } else {
        showNotification('Failed to update prices', 'error')
      }
    } catch (error) {
      showNotification('Error updating prices', 'error')
    } finally {
      setProcessingUpdate(false)
    }
  }

  // Existing PO Handlers (Create PO without RFQ)
  const handleOpenExistingPO = async () => {
    try {
      const response = await bomCostService.getPartTypes()
      if (response.data.success) {
        setExistingPOTypes(response.data.types || [])
        setExistingPOStep(0)
        setSelectedExistingPOTypes([])
        setExistingPOPartsList([])
        setSelectedExistingPOParts([])
        setExistingPOQuotationFiles([])
        setExistingPOPartsData([])
        setExistingPONumber('')
        setExistingPOVendor('')
        setExistingPOCurrency('USD')
        setExistingPOLeadTime('')
        setExistingPOSearchTerm('')
        setExistingPODiscountPercent('')
        setExistingPOManualTotal(null)
        setShowExistingPOModal(true)
      }
    } catch (error) {
      showNotification('Error loading part types', 'error')
    }
  }

  // Filter and sort parts for Create PO (without RFQ) modal
  const filteredExistingPOPartsList = useMemo(() => {
    let list = existingPOPartsList
    if (existingPOSearchTerm.trim()) {
      const searchLower = existingPOSearchTerm.toLowerCase()
      list = list.filter(part => {
        const partNumber = (part.part_number || '').toLowerCase()
        const description = (part.description || '').toLowerCase()
        return partNumber.includes(searchLower) || description.includes(searchLower)
      })
    }
    if (existingPOVendorFilter) {
      list = list.filter(part => (part.vendor || '') === existingPOVendorFilter)
    }
    return sortPartsByNumber(list, existingPOSort)
  }, [existingPOSearchTerm, existingPOPartsList, existingPOSort, existingPOVendorFilter])

  const existingPOAvailableVendors = useMemo(() => {
    const vendors = new Set()
    existingPOPartsList.forEach(part => { if (part.vendor) vendors.add(part.vendor) })
    return Array.from(vendors).sort()
  }, [existingPOPartsList])

  // Filter and sort parts for PO Received modal
  const filteredQcData = useMemo(() => {
    let list = qcData
    if (poReceivedSearchTerm.trim()) {
      const searchLower = poReceivedSearchTerm.toLowerCase()
      list = list.filter(item => {
        const partNumber = (item.part_number || '').toLowerCase()
        const revision = (item.revision || '').toLowerCase()
        const notes = (item.notes || '').toLowerCase()
        const warehouseBox = (item.warehouse_box_number || '').toLowerCase()
        return partNumber.includes(searchLower) ||
               revision.includes(searchLower) ||
               notes.includes(searchLower) ||
               warehouseBox.includes(searchLower)
      })
    }
    return sortPartsByNumber(list, poReceivedSort)
  }, [poReceivedSearchTerm, qcData, poReceivedSort])

  const handleExistingPOTypeSelect = (type) => {
    if (selectedExistingPOTypes.includes(type)) {
      setSelectedExistingPOTypes(selectedExistingPOTypes.filter(t => t !== type))
    } else {
      setSelectedExistingPOTypes([...selectedExistingPOTypes, type])
    }
  }

  const handleExistingPOTypeSelectContinue = async () => {
    if (selectedExistingPOTypes.length === 0) return
    try {
      const response = await bomCostService.getPartsByTypes(selectedExistingPOTypes)
      if (response.data.success) {
        setExistingPOPartsList(response.data.parts || [])
        setExistingPOStep(1)
      }
    } catch (error) {
      showNotification('Error loading parts', 'error')
    }
  }

  const handleExistingPOPartSelect = (partId) => {
    if (selectedExistingPOParts.includes(partId)) {
      setSelectedExistingPOParts(selectedExistingPOParts.filter(id => id !== partId))
    } else {
      setSelectedExistingPOParts([...selectedExistingPOParts, partId])
    }
  }

  const handleExistingPOFileChange = (e) => {
    setExistingPOQuotationFiles(Array.from(e.target.files))
  }

  const handleProcessExistingPOQuotations = async () => {
    setCreatingExistingPO(true)
    try {
      const partsToProcess = selectedExistingPOParts
        .map(id => {
          const part = existingPOPartsList.find(p => p.id === id)
          if (!part) return null
          return {
            part_number: part.part_number,
            revision: part.revision || ''
          }
        })
        .filter(part => part !== null)

      const formData = new FormData()
      formData.append('parts', JSON.stringify(partsToProcess))
      formData.append('vendor', existingPOVendor || 'Unknown')

      if (existingPOQuotationFiles.length > 0) {
        existingPOQuotationFiles.forEach(file => {
          formData.append('quotation', file)
        })
      }

      const response = await bomCostService.processQuotationsForUpdate(formData)

      if (response.data.success) {
        setExistingPOPartsData(response.data.parts || [])
        setQuotationMetadata(response.data.quotation_metadata || null)
        // Auto-fill lead time from the quotation (unless the user already set one)
        const quotedLeadDays = parseLeadTimeToDays(response.data.quotation_metadata?.lead_time)
        if (quotedLeadDays && !existingPOLeadTime) {
          setExistingPOLeadTime(String(quotedLeadDays))
          showNotification(`Lead time auto-filled from quotation: ${quotedLeadDays} days ("${response.data.quotation_metadata.lead_time}")`, 'info')
        }
        setExistingPOStep(2)
        if (existingPOQuotationFiles.length > 0) {
          showNotification(`Processed ${existingPOQuotationFiles.length} quotation file(s)`, 'success')
        } else {
          showNotification('Ready for manual price entry', 'info')
        }
      } else {
        showNotification(response.data.error || 'Failed to process quotations', 'error')
      }
    } catch (error) {
      console.error('Error processing quotations:', error)
      showNotification(error.response?.data?.error || 'Error processing quotations', 'error')
    } finally {
      setCreatingExistingPO(false)
    }
  }

  const handleContinueExistingPOWithoutQuotation = async () => {
    if (selectedExistingPOParts.length === 0) {
      showNotification('Please select at least one part', 'warning')
      return
    }

    const partsToProcess = selectedExistingPOParts
      .map(id => {
        const part = existingPOPartsList.find(p => p.id === id)
        if (!part) return null
        return {
          part_number: part.part_number,
          revision: part.revision || '',
          description: part.description || '',
          current_cost: part.unit_cost || 0,
          unit_cost: null,
          total_cost: null,
          price_options: [],
          has_price: false,
          quantity: 1
        }
      })
      .filter(part => part !== null)

    if (partsToProcess.length === 0) {
      showNotification('No valid parts found', 'error')
      return
    }

    setExistingPOPartsData(partsToProcess)
    setExistingPOStep(2)
  }

  const handleUpdateExistingPOPartPrice = (partNumber, price) => {
    const updatedParts = existingPOPartsData.map(part => {
      if (part.part_number === partNumber) {
        const unitCost = parseFloat(price) || 0
        return {
          ...part,
          unit_cost: unitCost,
          total_cost: unitCost * (part.quantity || 1),
          has_price: unitCost > 0
        }
      }
      return part
    })
    setExistingPOPartsData(updatedParts)
  }

  const handleUpdateExistingPOPartQuantity = (partNumber, quantity) => {
    // Remove any decimal part and parse as integer
    const cleanValue = String(quantity).replace(/\./g, '')
    const qty = parseInt(cleanValue, 10)
    if (isNaN(qty) || qty < 1) {
      return
    }
    
    const updatedParts = existingPOPartsData.map(part => {
      if (part.part_number === partNumber) {
        const unitCost = part.unit_cost || 0
        return {
          ...part,
          quantity: qty,
          total_cost: unitCost * qty
        }
      }
      return part
    })
    setExistingPOPartsData(updatedParts)
  }

  const handleFinalizeExistingPO = () => {
    if (!existingPONumber.trim() || !existingPOVendor.trim()) {
      showNotification('PO number and vendor are required', 'warning')
      return
    }

    const partsWithPrices = existingPOPartsData.filter(p => p.unit_cost && p.unit_cost > 0)
    if (partsWithPrices.length === 0) {
      showNotification('Please enter prices for at least one part', 'warning')
      return
    }

    // Pre-fill PO Document modal with defaults and quotation metadata.
    // Suggest a concrete delivery date from the quotation lead time (parsed)
    // or the manually entered lead-time days, projected from today
    const suggestedLeadDays = parseLeadTimeToDays(quotationMetadata?.lead_time)
      ?? (existingPOLeadTime ? parseInt(existingPOLeadTime) : null)
    const selectedVendorObj = vendors.find(v => v.name === existingPOVendor.trim())
    setPoTemplateVars({
      contact_name: quotationMetadata?.contact_name || selectedVendorObj?.contact_name || '',
      quotation_number: quotationMetadata?.quotation_number || '',
      quotation_date: quotationMetadata?.quotation_date || '',
      delivery_date: suggestedLeadDays ? leadTimeToDateString(suggestedLeadDays) : (quotationMetadata?.lead_time || ''),
      payment_terms: quotationMetadata?.payment_terms || '',
      orderer_name: user?.username || '',
      orderer_email: user?.email || '',
      orderer_phone: user?.phone || '',
      approver_name: '',
      approver_title: ''
    })
    setGeneratePODocument(true)
    setPoDocumentSource('direct')
    setShowPODocumentModal(true)
  }

  const handleConfirmDirectPO = async () => {
    setShowPODocumentModal(false)
    setCreatingExistingPO(true)
    try {
      const partsWithPrices = existingPOPartsData.filter(p => p.unit_cost && p.unit_cost > 0)
      const requestData = {
        po_number: existingPONumber.trim(),
        vendor: existingPOVendor.trim(),
        currency: existingPOCurrency,
        lead_time: existingPOLeadTime ? parseInt(existingPOLeadTime) : null,
        manual_total_cost: existingPOManualTotal !== null ? existingPOManualTotal : null,
        discount_percent: existingPOPartsData.some(p => p._original_unit_cost != null) ? parseFloat(existingPODiscountPercent) || null : null,
        original_total_cost: existingPOPartsData.some(p => p._original_unit_cost != null) ? existingPOPartsData.reduce((sum, p) => sum + ((p._original_unit_cost || p.unit_cost || 0) * p.quantity), 0) : null,
        parts_with_prices: partsWithPrices.map(part => ({
          part_number: part.part_number,
          revision: part.revision || 'REV01',
          quantity: part.quantity || 1,
          unit_cost: part.unit_cost,
          total_cost: part.total_cost,
          original_unit_cost: part._original_unit_cost || null,
          material: part.material || '',
          finish1: part.finish1 || '',
          finish2: part.finish2 || ''
        })),
        template_vars: generatePODocument ? poTemplateVars : null
      }

      const response = await rfqService.createPOWithoutRFQ(requestData)

      if (response.data.success) {
        setPOSuccessData(response.data)
        setShowExistingPOModal(false)
        setShowPOSuccessModal(true)
        setExistingPOPartsData([])
        setExistingPONumber('')
        setExistingPOVendor('')
        setExistingPOLeadTime('')
        loadPOs()
      } else {
        showNotification(response.data.error || 'Failed to create PO', 'error')
      }
    } catch (error) {
      console.error('Error creating PO:', error)
      showNotification(error.response?.data?.error || 'Error creating PO', 'error')
    } finally {
      setCreatingExistingPO(false)
    }
  }

  // Multi-Delivery PO Handlers
  const handleToggleExpandPO = (poId) => {
    setExpandedPOs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(poId)) {
        newSet.delete(poId)
      } else {
        newSet.add(poId)
      }
      return newSet
    })
  }

  const handleOpenAddDelivery = (po) => {
    setAddingDeliveryForPO(po.id)
    // Use PO date as default delivery date
    const defaultDate = po.po_date ? new Date(po.po_date).toISOString().split('T')[0] : ''
    setNewDeliveryData({
      total_cost: '',
      delivery_date: defaultDate,
      waybill: '',
      invoice_number: ''
    })
    // Expand the PO if not already expanded
    if (!expandedPOs.has(po.id)) {
      setExpandedPOs(new Set([...expandedPOs, po.id]))
    }
  }

  const handleCancelAddDelivery = () => {
    setAddingDeliveryForPO(null)
    setNewDeliveryData({
      total_cost: '',
      delivery_date: '',
      waybill: '',
      invoice_number: ''
    })
  }

  const handleStartEditDelivery = (child, parentPO) => {
    // Use child's po_date if available, otherwise use parent PO date
    let deliveryDate = ''
    if (child.po_date) {
      const date = new Date(child.po_date)
      // Format as YYYY-MM-DD without timezone conversion
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      deliveryDate = `${year}-${month}-${day}`
    } else if (parentPO.po_date) {
      const date = new Date(parentPO.po_date)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      deliveryDate = `${year}-${month}-${day}`
    }
    
    setEditingDeliveryId(child.id)
    setEditingDeliveryData({
      total_cost: child.total_cost || '',
      delivery_date: deliveryDate,
      waybill: child.waybill || '',
      invoice_number: child.invoice_number || ''
    })
  }

  const handleCancelEditDelivery = () => {
    setEditingDeliveryId(null)
    setEditingDeliveryData({
      total_cost: '',
      delivery_date: '',
      waybill: '',
      invoice_number: ''
    })
  }

  const handleSaveEditDelivery = async (childId, parentPOId) => {
    if (!childId) return

    setSavingDelivery(true)
    try {
      // Update delivery using the update_tracking endpoint for all fields
      const updates = {
        total_cost: editingDeliveryData.total_cost ? parseFloat(editingDeliveryData.total_cost) : null,
        waybill: editingDeliveryData.waybill || null,
        invoice_number: editingDeliveryData.invoice_number || null,
        delivery_date: editingDeliveryData.delivery_date || null
      }
      
      // Update total cost separately if provided
      if (updates.total_cost !== null) {
        await rfqService.updatePOTotalCost(childId, updates.total_cost)
      }
      
      // Update other fields via update_tracking
      if (updates.waybill !== null || updates.invoice_number !== null || updates.delivery_date !== null) {
        await rfqService.updatePOTracking(childId, {
          waybill: updates.waybill,
          invoice_number: updates.invoice_number,
          delivery_date: updates.delivery_date
        })
      }
      
      showNotification('Delivery updated successfully', 'success')
      setEditingDeliveryId(null)
      setEditingDeliveryData({
        total_cost: '',
        delivery_date: '',
        waybill: '',
        invoice_number: ''
      })
      loadPOs()
    } catch (error) {
      console.error('Error updating delivery:', error)
      showNotification(error.response?.data?.error || 'Error updating delivery', 'error')
    } finally {
      setSavingDelivery(false)
    }
  }

  const handleAddDelivery = async (poId) => {
    if (!poId) return

    setAddingDelivery(true)
    try {
      const response = await rfqService.addPODelivery(poId, newDeliveryData)
      if (response.data.success) {
        showNotification('Delivery added successfully', 'success')
        setAddingDeliveryForPO(null)
        setNewDeliveryData({
          total_cost: '',
          delivery_date: '',
          waybill: '',
          invoice_number: ''
        })
        loadPOs()
      } else {
        showNotification(response.data.error || 'Failed to add delivery', 'error')
      }
    } catch (error) {
      console.error('Error adding delivery:', error)
      showNotification(error.response?.data?.error || 'Error adding delivery', 'error')
    } finally {
      setAddingDelivery(false)
    }
  }

  // Helper function to format dates as DD/MM/YYYY
  const formatDateDDMMYYYY = (date) => {
    if (!date) return 'N/A'
    const dateObj = date instanceof Date ? date : new Date(date)
    if (isNaN(dateObj.getTime())) return 'N/A'
    const day = String(dateObj.getDate()).padStart(2, '0')
    const month = String(dateObj.getMonth() + 1).padStart(2, '0')
    const year = dateObj.getFullYear()
    return `${day}/${month}/${year}`
  }

  const canCreatePO = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'finance' || user?.role === 'floor_manager' || user?.role === 'system'
  const canDelete = user?.role === 'admin'
  const isAdmin = user?.role === 'admin'
  const canReceivePO = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'finance' || user?.role === 'floor_manager' || user?.role === 'floor' || user?.role === 'system'
  const canSplitDelivery = canCreatePO || user?.role === 'floor'
  const canEditPrices = user?.role === 'admin' || user?.role === 'engineer' || user?.role === 'finance' || user?.role === 'floor_manager' || user?.role === 'system'
  const canRegeneratePO = user?.role === 'admin' || user?.role === 'engineer'

  const summary = validationData?.summary || {}
  const allPricesValid = partsData.length > 0 && partsData.every(p => p.has_price)
  const additionalCostsTotal = additionalCosts.reduce((sum, cost) => sum + (cost.total_cost || 0), 0)
  const calculatedPOTotalCost = partsData.reduce((sum, part) => sum + (part.total_cost || 0), 0) + additionalCostsTotal
  const originalPOTotalCost = partsData.reduce((sum, part) => sum + ((part._original_unit_cost || part.unit_cost || 0) * part.quantity), 0) + additionalCostsTotal
  const poDiscountApplied = partsData.some(p => p._original_unit_cost != null)
  const totalPOCost = manualPOTotalCost !== null ? manualPOTotalCost : calculatedPOTotalCost

  // Filter RFQs
  const filteredRFQs = useMemo(() => {
    let filtered = [...rfqs]
    
    // Apply tab filter
    if (!showAllRFQs) {
      if (activeRFQTab === 'converted') {
        // Show only converted to PO
        filtered = filtered.filter(rfq => {
          return rfq.status === 'converted_to_po' || (rfq.po_id && rfq.po_id > 0)
        })
      } else if (activeRFQTab === 'active') {
        // Show only active RFQs (not converted)
        filtered = filtered.filter(rfq => {
          return rfq.status !== 'converted_to_po' && (!rfq.po_id || rfq.po_id === 0)
        })
      }
    }
    // If showAllRFQs is true, show all RFQs without filtering
    
    // Apply user filter
    if (rfqFilters.user) {
      filtered = filtered.filter(rfq => 
        (rfq.created_by || '').toLowerCase().includes(rfqFilters.user.toLowerCase())
      )
    }
    
    return filtered
  }, [rfqs, activeRFQTab, rfqFilters.user, showAllRFQs])

  // Filter POs
  const filteredPOs = useMemo(() => {
    let filtered = [...pos]
    
    // Apply tab filter
    if (!showAllPOs) {
      if (activePOTab === 'received') {
        // Show only received POs
        filtered = filtered.filter(po => po.po_received === true || po.po_received === 1)
      } else if (activePOTab === 'pending') {
        // Show only pending POs (not received)
        filtered = filtered.filter(po => !po.po_received && po.po_received !== 1)
      }
    }
    // If showAllPOs is true, show all POs without filtering
    
    // Apply user filter
    if (poFilters.user) {
      filtered = filtered.filter(po => 
        (po.created_by || '').toLowerCase().includes(poFilters.user.toLowerCase())
      )
    }
    
    // Apply vendor filter
    if (poFilters.vendor) {
      filtered = filtered.filter(po => 
        (po.vendor || '').toLowerCase().includes(poFilters.vendor.toLowerCase())
      )
    }
    
    return filtered
  }, [pos, activePOTab, poFilters.user, poFilters.vendor, showAllPOs])

  // Get unique values for filter dropdowns
  const uniqueRFQUsers = useMemo(() => {
    return [...new Set(rfqs.map(rfq => rfq.created_by).filter(Boolean))].sort()
  }, [rfqs])


  const uniquePOUsers = useMemo(() => {
    return [...new Set(pos.map(po => po.created_by).filter(Boolean))].sort()
  }, [pos])

  const uniquePOVendors = useMemo(() => {
    return [...new Set(pos.map(po => po.vendor).filter(Boolean))].sort()
  }, [pos])


  return (
    <Box sx={{ width: '100%', height: 'calc(100vh - 44px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, pt: 0.75, pb: 0.25, flexShrink: 0 }}>
        <Typography variant="h5" sx={{ fontSize: '0.95rem', fontWeight: 600, mb: 0.25 }}>
          Purchases Management
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage RFQs and Purchase Orders
        </Typography>
        <Box sx={{ mt: 0.75, display: 'flex', gap: 1 }}>
          <Button
            variant="contained"
            color="secondary"
            size="small"
            startIcon={<MoneyIcon sx={{ fontSize: '1rem' }} />}
            onClick={handleOpenPriceUpdate}
            disabled={!canCreatePO}
          >
            Price Update
          </Button>
          <Button
            variant="contained"
            color="primary"
            size="small"
            startIcon={<POIcon sx={{ fontSize: '1rem' }} />}
            onClick={handleOpenExistingPO}
            disabled={!canCreatePO}
          >
            Create PO
          </Button>
          {canCreatePO && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon sx={{ fontSize: '1rem' }} />}
              onClick={() => setShowVendorModal(true)}
            >
              Manage Vendors
            </Button>
          )}
          <Button
            variant="outlined"
            size="small"
            color={latePOCount > 0 ? 'error' : 'primary'}
            startIcon={<WarningIcon sx={{ fontSize: '1rem' }} />}
            onClick={() => setShowDeliveryPerformance(true)}
          >
            Delivery Performance{latePOCount > 0 ? ` (${latePOCount} late)` : ''}
          </Button>
        </Box>
      </Box>

      <DeliveryPerformanceDialog
        open={showDeliveryPerformance}
        onClose={() => setShowDeliveryPerformance(false)}
      />

      <Box sx={{ flex: 1, minHeight: 0, px: 1.5, pb: 0.75, overflowY: 'auto' }}>
        {/* RFQ Table */}
        <Card sx={{ mb: 1 }}>
          <CardHeader
            title="RFQ Table"
            action={
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => loadRFQs()}
                disabled={loading}
              >
                Refresh
              </Button>
            }
            sx={{ py: 0.75, px: 1.5 }}
          />
          <CardContent sx={{ px: 1.5, py: 0.75, '&:last-child': { pb: 1 } }}>
            {/* RFQ Tabs */}
            <Tabs 
              value={showAllRFQs ? 'all' : activeRFQTab} 
              onChange={(e, newValue) => {
                if (newValue === 'all') {
                  setShowAllRFQs(true)
                  setActiveRFQTab('active') // Reset to active when showing all
                } else {
                  setShowAllRFQs(false)
                  setActiveRFQTab(newValue)
                }
              }}
              onDoubleClick={() => {
                setShowAllRFQs(!showAllRFQs)
                if (!showAllRFQs) {
                  setActiveRFQTab('active') // Reset to active when showing all
                }
              }}
              sx={{ mb: 1 }}
            >
              <Tab label="Active RFQ" value="active" />
              <Tab label="Converted to PO" value="converted" />
              {showAllRFQs && <Tab label="All RFQs" value="all" />}
            </Tabs>
            
            {/* RFQ Filters */}
            <Box sx={{ display: 'flex', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Filter by User</InputLabel>
                <Select
                  value={rfqFilters.user}
                  label="Filter by User"
                  onChange={(e) => setRfqFilters({ ...rfqFilters, user: e.target.value })}
                >
                  <MenuItem value="">All Users</MenuItem>
                  {uniqueRFQUsers.map(user => (
                    <MenuItem key={user} value={user}>{user}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>Loading RFQs...</Typography>
              </Box>
            ) : filteredRFQs.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 5 }}>
                <Typography color="text.secondary">No RFQs found</Typography>
              </Box>
            ) : (
              <TableContainer component={Paper} sx={{ maxHeight: '60vh', overflow: 'auto' }}>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>BOM Name</TableCell>
                      <TableCell>BOM Revision</TableCell>
                      <TableCell>RFQ Name</TableCell>
                      <TableCell>Date Created</TableCell>
                      <TableCell>Created By</TableCell>
                      <TableCell>Parts Count</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Notes</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredRFQs.map((rfq) => (
                      <TableRow key={rfq.id} hover>
                        <TableCell>{rfq.bom_name || 'N/A'}</TableCell>
                        <TableCell>{rfq.bom_revision || 'N/A'}</TableCell>
                        <TableCell>{rfq.rfq_name}</TableCell>
                        <TableCell>
                          {formatDateDDMMYYYY(rfq.created_date)}
                        </TableCell>
                        <TableCell>{rfq.created_by || 'N/A'}</TableCell>
                        <TableCell>{rfq.parts_count || 0}</TableCell>
                        <TableCell>
                          <Chip
                            label={getStatusText(rfq.status)}
                            color={getStatusColor(rfq.status)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {rfq.excluded_parts_note ? (
                            <Tooltip title={rfq.excluded_parts_note}>
                              <Typography variant="caption" color="text.secondary">
                                Excluded parts
                              </Typography>
                            </Tooltip>
                          ) : (
                            <Typography variant="caption" color="text.secondary">-</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            {rfq.google_drive_folder_url && (
                              <Tooltip title="Open Google Drive Folder">
                                <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={() => window.open(rfq.google_drive_folder_url, '_blank', 'noopener,noreferrer')}
                                >
                                  <FolderOpenIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canCreatePO && rfq.status === 'active' && (
                              <Tooltip title="Edit RFQ Quantities">
                                <IconButton
                                  size="small"
                                  color="warning"
                                  onClick={() => handleOpenReexport(rfq.id, rfq.rfq_name)}
                                >
                                  <EditIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canCreatePO && (
                              <Tooltip title="Duplicate RFQ (same parts, new quantities)">
                                <IconButton
                                  size="small"
                                  color="info"
                                  onClick={() => handleOpenDuplicate(rfq)}
                                >
                                  <DuplicateIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canCreatePO && (
                              <Tooltip title="Refresh RFQ (update part metadata from Parts DB and regenerate files)">
                                <span>
                                  <IconButton
                                    size="small"
                                    color="secondary"
                                    disabled={refreshingRFQ !== null}
                                    onClick={() => handleRefreshRFQ(rfq)}
                                  >
                                    {refreshingRFQ === rfq.id ? <CircularProgress size={18} /> : <RefreshIcon />}
                                  </IconButton>
                                </span>
                              </Tooltip>
                            )}
                            {canCreatePO && rfq.status === 'converted_to_po' && (
                              <Tooltip title="Reopen RFQ (linked PO must be deleted/cancelled first)">
                                <IconButton
                                  size="small"
                                  color="warning"
                                  onClick={() => handleReopenRFQ(rfq.id, rfq.rfq_name)}
                                >
                                  <UndoIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canCreatePO && (
                              <Tooltip title="Create PO">
                                <Button
                                  size="small"
                                  variant="contained"
                                  color="success"
                                  startIcon={<POIcon />}
                                  onClick={() => handleOpenPOCreation(rfq.id)}
                                >
                                  Create PO from RFQ
                                </Button>
                              </Tooltip>
                            )}
                            {canDelete && (
                              <Tooltip title="Delete RFQ">
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => handleDeleteRFQ(rfq.id, rfq.rfq_name)}
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        {/* RFQ Edit Quantities Modal */}
        <ResizableDialog
          open={showReexportModal}
          onClose={() => !reexporting && setShowReexportModal(false)}
          title={`Edit RFQ Quantities: ${reexportRFQName}`}
          maxWidth="md"
        >
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {loadingReexportItems ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 5 }}>
                <CircularProgress size={30} />
                <Typography sx={{ ml: 2 }}>Loading RFQ items...</Typography>
              </Box>
            ) : reexporting ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 5 }}>
                <CircularProgress size={30} />
                <Typography sx={{ ml: 2 }}>Updating quantities...</Typography>
              </Box>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Edit quantities below. Changes will update the RFQ database records used for PO creation.
                </Typography>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {reexportItems.length} item(s){removedRfqItems.length > 0 ? ` — ${removedRfqItems.length} queued for removal` : ''}
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    startIcon={<AddIcon />}
                    onClick={() => { setRfqAddSearchOpen(true); setRfqAddSearch(''); setRfqAddResults([]) }}
                  >
                    Add Part from Database
                  </Button>
                </Box>
                <TableContainer component={Paper} sx={{ flex: 1, overflow: 'auto' }}>
                  <Table stickyHeader size="small" sx={{ width: '100%' }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 50 }}>#</TableCell>
                        <TableCell>Part Number</TableCell>
                        <TableCell sx={{ width: 100 }}>Revision</TableCell>
                        <TableCell sx={{ width: 120 }}>Quantity</TableCell>
                        <TableCell sx={{ width: 60, textAlign: 'center' }}>Remove</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reexportItems.map((item, index) => (
                        <TableRow key={index} hover sx={item.is_new ? { bgcolor: 'success.light', opacity: 0.85 } : {}}>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              {item.part_number}
                              {item.is_new && <Chip label="NEW" size="small" color="success" sx={{ height: 18, fontSize: '0.65rem' }} />}
                              {item.is_new && item.db_linked === true && (
                                <Tooltip title={item.part_name ? `Linked: ${item.part_name}` : 'Found in parts database'}>
                                  <CheckCircleIcon fontSize="inherit" color="success" sx={{ fontSize: 14 }} />
                                </Tooltip>
                              )}
                              {item.is_new && item.db_linked === false && (
                                <Tooltip title="Not found in parts database — no part record linked">
                                  <WarningIcon fontSize="inherit" color="warning" sx={{ fontSize: 14 }} />
                                </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                          <TableCell>{item.revision || '-'}</TableCell>
                          <TableCell>
                            <TextField
                              type="number"
                              size="small"
                              value={item.newQuantity}
                              onChange={(e) => handleReexportQuantityChange(index, e.target.value)}
                              inputProps={{ min: 0, step: 1 }}
                              sx={{ width: 90 }}
                            />
                          </TableCell>
                          <TableCell sx={{ textAlign: 'center' }}>
                            <Tooltip title={item.is_new ? 'Drop this newly-added item' : 'Remove from RFQ on save'}>
                              <IconButton size="small" color="error" onClick={() => handleRemoveRfqItem(index)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowReexportModal(false)} disabled={reexporting}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="warning"
              onClick={handleConfirmReexport}
              disabled={reexporting || loadingReexportItems || reexportItems.length === 0}
              startIcon={reexporting ? <CircularProgress size={16} /> : <SaveIcon />}
            >
              Save Quantities
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* RFQ Duplicate Modal */}
        <ResizableDialog
          open={showDuplicateModal}
          onClose={() => !duplicating && setShowDuplicateModal(false)}
          title={`Duplicate RFQ: ${duplicateSourceRFQ?.rfq_name || ''}`}
          maxWidth="md"
        >
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {loadingDuplicateItems ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 5 }}>
                <CircularProgress size={30} />
                <Typography sx={{ ml: 2 }}>Loading RFQ items...</Typography>
              </Box>
            ) : duplicating ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', py: 5, gap: 2 }}>
                <CircularProgress size={30} />
                <Typography>
                  Duplicating RFQ — collecting PDF/X_T files, creating ZIP &amp; Excel, uploading to Google Drive...
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  This can take a minute for large RFQs
                </Typography>
              </Box>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  A new RFQ will be created with the parts below: files are collected from PDM,
                  the Excel and PDF+XT ZIP are generated, and a new folder is created in the RFQ Google Drive folder.
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
                  <TextField
                    label="New RFQ Name"
                    size="small"
                    value={duplicateRfqName}
                    onChange={(e) => setDuplicateRfqName(e.target.value)}
                    helperText={`Saved as "${duplicateRfqName.trim() || '...'} - RFQ - ${new Date().toISOString().slice(0, 10)}"`}
                    sx={{ flex: 1, minWidth: 260 }}
                  />
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <FormControl size="small" sx={{ width: 80 }}>
                      <InputLabel>Op</InputLabel>
                      <Select
                        value={duplicateFactorMode}
                        label="Op"
                        onChange={(e) => handleDuplicateFactorModeChange(e.target.value)}
                      >
                        <MenuItem value="multiply">&times;</MenuItem>
                        <MenuItem value="divide">&divide;</MenuItem>
                      </Select>
                    </FormControl>
                    <TextField
                      label={duplicateFactorMode === 'divide' ? 'Divide Qty By' : 'Multiply Qty By'}
                      type="number"
                      size="small"
                      value={duplicateMultiplier}
                      onChange={(e) => handleDuplicateMultiplierChange(e.target.value)}
                      inputProps={{ min: 0, step: 1 }}
                      helperText="Applies to all parts (rounded); edit per-part below"
                      sx={{ width: 190 }}
                    />
                  </Box>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                  {duplicateItems.length} item(s)
                </Typography>
                <TableContainer component={Paper} sx={{ flex: 1, overflow: 'auto' }}>
                  <Table stickyHeader size="small" sx={{ width: '100%' }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ width: 50 }}>#</TableCell>
                        <TableCell>Part Number</TableCell>
                        <TableCell sx={{ width: 100 }}>Revision</TableCell>
                        <TableCell sx={{ width: 110 }}>Original Qty</TableCell>
                        <TableCell sx={{ width: 120 }}>New Quantity</TableCell>
                        <TableCell sx={{ width: 60, textAlign: 'center' }}>Remove</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {duplicateItems.map((item, index) => (
                        <TableRow key={`${item.part_number}_${item.revision}`} hover>
                          <TableCell>{index + 1}</TableCell>
                          <TableCell>{item.part_number}</TableCell>
                          <TableCell>{item.revision || '-'}</TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>
                            <TextField
                              type="number"
                              size="small"
                              value={item.newQuantity}
                              onChange={(e) => handleDuplicateQuantityChange(index, e.target.value)}
                              inputProps={{ min: 0, step: 1 }}
                              sx={{ width: 90 }}
                            />
                          </TableCell>
                          <TableCell sx={{ textAlign: 'center' }}>
                            <Tooltip title="Exclude from the duplicated RFQ">
                              <IconButton size="small" color="error" onClick={() => handleRemoveDuplicateItem(index)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowDuplicateModal(false)} disabled={duplicating}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="info"
              onClick={handleConfirmDuplicate}
              disabled={duplicating || loadingDuplicateItems || duplicateItems.length === 0}
              startIcon={duplicating ? <CircularProgress size={16} /> : <DuplicateIcon />}
            >
              Duplicate RFQ
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* RFQ Refresh Modal */}
        <ResizableDialog
          open={showRFQRefreshModal}
          onClose={handleCancelRFQRefresh}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <RefreshIcon color="secondary" />
              Refresh RFQ: {refreshTargetRFQ?.rfq_name || ''}
            </Box>
          </DialogTitle>
          <DialogContent>
            {rfqRefreshData && (
              <>
                <Alert severity="info" sx={{ mb: 1 }}>
                  The parts database has changed since this RFQ was created. Refreshing will update
                  the RFQ items and upload a corrected Excel/ZIP to the existing Drive folder.
                  Quantities are not changed.
                </Alert>

                <Box sx={{ mb: 1 }}>
                  <Typography variant="subtitle1" gutterBottom>
                    Summary:
                  </Typography>
                  <Typography variant="body2">
                    • Total Parts: {rfqRefreshData.summary?.total_parts || 0}
                  </Typography>
                  <Typography variant="body2" color="warning.main">
                    • Revision Changes: {rfqRefreshData.summary?.revision_changes || 0}
                  </Typography>
                  <Typography variant="body2" color="warning.main">
                    • Metadata Changes (material/finish/state): {rfqRefreshData.summary?.metadata_changes || 0}
                  </Typography>
                  {(rfqRefreshData.missing_parts?.length || 0) > 0 && (
                    <Typography variant="body2" color="error.main">
                      • Parts left unchanged (no matching revision in the Parts DB): {rfqRefreshData.missing_parts.join(', ')}
                    </Typography>
                  )}
                </Box>

                {rfqRefreshData.revision_updates?.length > 0 && (
                  <>
                    <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>Revision updates</Typography>
                    <TableContainer component={Paper} sx={{ maxHeight: '25vh', overflow: 'auto', mb: 1 }}>
                      <Table stickyHeader size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600 }}>Part Number</TableCell>
                            <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600 }}>Revision Change</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rfqRefreshData.revision_updates.map((update, index) => (
                            <TableRow key={`${update.part_number}_${index}`}>
                              <TableCell>
                                <Typography variant="body2" fontWeight="medium">
                                  {update.part_number}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" component="span" color="text.secondary">
                                  {update.old_revision}
                                </Typography>
                                <Typography variant="body2" component="span" sx={{ mx: 1 }}>
                                  →
                                </Typography>
                                <Typography variant="body2" component="span" color="warning.main" fontWeight="medium">
                                  {update.new_revision}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
                )}

                {rfqRefreshData.metadata_updates?.length > 0 && (
                  <>
                    <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>Metadata updates</Typography>
                    <TableContainer component={Paper} sx={{ maxHeight: '35vh', overflow: 'auto' }}>
                      <Table stickyHeader size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600 }}>Part Number</TableCell>
                            <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600 }}>Field</TableCell>
                            <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600 }}>Current (RFQ)</TableCell>
                            <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600 }}>New (Parts DB)</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rfqRefreshData.metadata_updates.map((update, index) => (
                            <TableRow key={`${update.part_number}_${update.field}_${index}`}>
                              <TableCell>
                                <Typography variant="body2" fontWeight="medium">
                                  {update.part_number}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2">{update.field}</Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" color="text.secondary">
                                  {update.old_value || '—'}
                                </Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" color="warning.main" fontWeight="medium">
                                  {update.new_value || '—'}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </>
                )}
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCancelRFQRefresh} disabled={refreshingRFQ !== null}>
              Cancel
            </Button>
            <Button
              onClick={() => executeRFQRefresh(refreshTargetRFQ?.id)}
              variant="contained"
              color="secondary"
              disabled={refreshingRFQ !== null || !refreshTargetRFQ}
              startIcon={refreshingRFQ !== null ? <CircularProgress size={16} /> : <RefreshIcon />}
            >
              {refreshingRFQ !== null ? 'Refreshing...' : 'Confirm & Refresh'}
            </Button>
          </DialogActions>
        </ResizableDialog>

        {/* RFQ Edit — Add Part search popup */}
        <Dialog
          open={rfqAddSearchOpen}
          onClose={() => setRfqAddSearchOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>Add Part from Database</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder="Search by part number or description (min 2 chars)…"
              value={rfqAddSearch}
              onChange={(e) => handleSearchRfqAddParts(e.target.value)}
              sx={{ mb: 1.5 }}
            />
            {rfqAddLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                <CircularProgress size={20} />
              </Box>
            )}
            {!rfqAddLoading && rfqAddResults.length === 0 && rfqAddSearch.length >= 2 && (
              <Typography variant="caption" color="text.secondary">No parts found</Typography>
            )}
            {!rfqAddLoading && rfqAddResults.length > 0 && (
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Part Number</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Rev</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rfqAddResults.map((p) => {
                      const pn = (p.part_number || '').toUpperCase()
                      const rev = (p.revision || '').toUpperCase()
                      const inRfq = reexportItems.some(it => it.part_number === pn && it.revision === rev)
                      return (
                        <TableRow key={`${p.id}_${p.part_number}_${p.revision}`} hover>
                          <TableCell>{p.part_number}</TableCell>
                          <TableCell>{p.revision}</TableCell>
                          <TableCell sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.description || '—'}
                          </TableCell>
                          <TableCell>{p.part_type || '—'}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>
                            <Button
                              size="small"
                              variant="contained"
                              disabled={inRfq}
                              onClick={() => handleAddRfqPartFromSearch(p)}
                            >
                              {inRfq ? 'Added' : 'Add'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRfqAddSearchOpen(false)}>Done</Button>
          </DialogActions>
        </Dialog>

        {/* PO Table */}
        <Card>
          <CardHeader
            title="PO Table"
            action={
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => loadPOs()}
                disabled={loadingPOs}
              >
                Refresh
              </Button>
            }
            sx={{ py: 0.75, px: 1.5 }}
          />
          <CardContent sx={{ px: 1.5, py: 0.75, '&:last-child': { pb: 1 } }}>
            {/* PO Tabs */}
            <Tabs 
              value={showAllPOs ? 'all' : activePOTab} 
              onChange={(e, newValue) => {
                if (newValue === 'all') {
                  setShowAllPOs(true)
                  setActivePOTab('pending') // Reset to pending when showing all
                } else {
                  setShowAllPOs(false)
                  setActivePOTab(newValue)
                }
              }}
              onDoubleClick={() => {
                setShowAllPOs(!showAllPOs)
                if (!showAllPOs) {
                  setActivePOTab('pending') // Reset to pending when showing all
                }
              }}
              sx={{ mb: 1 }}
            >
              <Tab label="Pending" value="pending" />
              <Tab label="Received" value="received" />
              {showAllPOs && <Tab label="All POs" value="all" />}
            </Tabs>
            
            {/* PO Filters */}
            <Box sx={{ display: 'flex', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Filter by User</InputLabel>
                <Select
                  value={poFilters.user}
                  label="Filter by User"
                  onChange={(e) => setPoFilters({ ...poFilters, user: e.target.value })}
                >
                  <MenuItem value="">All Users</MenuItem>
                  {uniquePOUsers.map(user => (
                    <MenuItem key={user} value={user}>{user}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Filter by Vendor</InputLabel>
                <Select
                  value={poFilters.vendor}
                  label="Filter by Vendor"
                  onChange={(e) => setPoFilters({ ...poFilters, vendor: e.target.value })}
                >
                  <MenuItem value="">All Vendors</MenuItem>
                  {uniquePOVendors.map(vendor => (
                    <MenuItem key={vendor} value={vendor}>{vendor}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            
            {loadingPOs ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                <CircularProgress />
                <Typography sx={{ ml: 2 }}>Loading POs...</Typography>
              </Box>
            ) : filteredPOs.filter(po => !po.is_child).length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 5 }}>
                <Typography color="text.secondary">No POs found</Typography>
              </Box>
            ) : (
              <TableContainer component={Paper} sx={{ maxHeight: '60vh', overflow: 'auto' }}>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell width={50}></TableCell>
                      <TableCell>PO Number</TableCell>
                      <TableCell>BOM Name</TableCell>
                      <TableCell>BOM Revision</TableCell>
                      <TableCell>Vendor</TableCell>
                      <TableCell>PO Date</TableCell>
                      <TableCell>Created By</TableCell>
                      <TableCell>Total Cost</TableCell>
                      <TableCell>Parts Count</TableCell>
                      <TableCell>Lead Time (days)</TableCell>
                      <TableCell>Lead Time Date</TableCell>
                      <TableCell>Waybill (Tracking number)</TableCell>
                      <TableCell>Invoice Number</TableCell>
                      <TableCell>PO Received</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredPOs.filter(po => !po.is_child).map((po) => {
                      const isExpanded = expandedPOs.has(po.id)
                      const childPOs = po.child_pos || []
                      return (
                        <React.Fragment key={po.id}>
                          <TableRow hover>
                            <TableCell>
                              {childPOs.length > 0 && (
                                <IconButton
                                  size="small"
                                  onClick={() => handleToggleExpandPO(po.id)}
                                >
                                  {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                </IconButton>
                              )}
                            </TableCell>
                            <TableCell sx={{ minWidth: 180 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {childPOs.length > 0 && (
                                  <Chip label={`${childPOs.length} deliver${childPOs.length > 1 ? 'ies' : 'y'}`} size="small" color="info" />
                                )}
                                {po.po_number}
                              </Box>
                            </TableCell>
                        <TableCell>{po.bom_name || 'N/A'}</TableCell>
                        <TableCell>{po.bom_revision || 'N/A'}</TableCell>
                        <TableCell>{po.vendor}</TableCell>
                        <TableCell>
                          {editingPODate === po.id ? (
                            <TextField
                              size="small"
                              type="date"
                              value={editingPODateValue}
                              onChange={(e) => setEditingPODateValue(e.target.value)}
                              onBlur={() => {
                                if (editingPODateValue) {
                                  handleUpdateTracking(po.id, 'po_date', editingPODateValue)
                                  setPos(prevPos => prevPos.map(p =>
                                    p.id === po.id ? { ...p, po_date: editingPODateValue } : p
                                  ))
                                }
                                setEditingPODate(null)
                                setEditingPODateValue('')
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  e.target.blur()
                                }
                              }}
                              autoFocus
                              InputLabelProps={{ shrink: true }}
                              sx={{ minWidth: 150 }}
                            />
                          ) : (
                            <Typography
                              variant="body2"
                              onDoubleClick={() => {
                                const currentDate = po.po_date ? new Date(po.po_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
                                setEditingPODateValue(currentDate)
                                setEditingPODate(po.id)
                              }}
                              sx={{
                                cursor: 'pointer',
                                padding: '8px',
                                borderRadius: '4px',
                                '&:hover': {
                                  backgroundColor: 'action.hover'
                                }
                              }}
                            >
                              {formatDateDDMMYYYY(po.po_date)}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{po.created_by || 'N/A'}</TableCell>
                        <TableCell>
                          {isAdmin && po.po_date ? (
                            <TextField
                              size="small"
                              type="number"
                              value={po.total_cost || 0}
                              onChange={(e) => {
                                setPos(prevPos => prevPos.map(p => 
                                  p.id === po.id ? { ...p, total_cost: parseFloat(e.target.value) || 0 } : p
                                ))
                              }}
                              onBlur={(e) => handleUpdatePOTotalCost(po.id, parseFloat(e.target.value) || 0)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.target.blur()
                                }
                              }}
                              onWheel={(e) => {
                                e.target.blur()
                                e.preventDefault()
                              }}
                              inputProps={{ step: 0.01, min: 0 }}
                              InputProps={{
                                startAdornment: (() => {
                                  const currency = (po.currency || 'USD').toUpperCase()
                                  return (currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$') + ' '
                                })()
                              }}
                              sx={{ minWidth: 120 }}
                            />
                          ) : (
                            (() => {
                              const currency = (po.currency || 'USD').toUpperCase()
                              const symbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                              return `${symbol}${formatPrice(po.total_cost || 0)}`
                            })()
                          )}
                        </TableCell>
                        <TableCell>{po.parts_count || 0}</TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="number"
                            value={po.lead_time || ''}
                            onChange={(e) => {
                              setPos(prevPos => prevPos.map(p => 
                                p.id === po.id ? { ...p, lead_time: e.target.value ? parseInt(e.target.value) : null } : p
                              ))
                            }}
                            onBlur={(e) => handleUpdateTracking(po.id, 'lead_time', e.target.value ? parseInt(e.target.value) : null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.target.blur()
                              }
                            }}
                            onWheel={(e) => {
                              e.target.blur()
                              e.preventDefault()
                            }}
                            placeholder="Days"
                            disabled={!canCreatePO}
                            inputProps={{ min: 0, step: 1 }}
                            sx={{ minWidth: 100 }}
                          />
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const poDate = po.po_date ? new Date(po.po_date) : null
                            const leadTimeDays = po.lead_time || 0
                            const calculatedDate = poDate && leadTimeDays > 0 
                              ? new Date(poDate.getTime() + leadTimeDays * 24 * 60 * 60 * 1000)
                              : null
                            const isEditing = editingLeadTimeDate === po.id
                            
                            if (isEditing) {
                              return (
                                <TextField
                                  size="small"
                                  type="date"
                                  value={leadTimeDateValue}
                                  onChange={(e) => setLeadTimeDateValue(e.target.value)}
                                  onBlur={() => {
                                    if (leadTimeDateValue && poDate) {
                                      const newDate = new Date(leadTimeDateValue)
                                      const diffTime = newDate.getTime() - poDate.getTime()
                                      const diffDays = Math.round(diffTime / (24 * 60 * 60 * 1000))
                                      if (diffDays >= 0) {
                                        handleUpdateTracking(po.id, 'lead_time', diffDays)
                                        setPos(prevPos => prevPos.map(p => 
                                          p.id === po.id ? { ...p, lead_time: diffDays } : p
                                        ))
                                      }
                                    }
                                    setEditingLeadTimeDate(null)
                                    setLeadTimeDateValue('')
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === 'Escape') {
                                      e.target.blur()
                                    }
                                  }}
                                  autoFocus
                                  disabled={!canCreatePO || !poDate}
                                  InputLabelProps={{ shrink: true }}
                                  sx={{ minWidth: 150 }}
                                />
                              )
                            } else {
                              return (
                                <Typography
                                  variant="body2"
                                  onDoubleClick={() => {
                                    if (canCreatePO && poDate) {
                                      const currentDate = calculatedDate || new Date()
                                      const dateStr = currentDate.toISOString().split('T')[0]
                                      setLeadTimeDateValue(dateStr)
                                      setEditingLeadTimeDate(po.id)
                                    }
                                  }}
                                  sx={{
                                    cursor: canCreatePO && poDate ? 'pointer' : 'default',
                                    minWidth: 150,
                                    padding: '8px',
                                    borderRadius: '4px',
                                    '&:hover': canCreatePO && poDate ? {
                                      backgroundColor: 'action.hover'
                                    } : {}
                                  }}
                                >
                                  {calculatedDate ? formatDateDDMMYYYY(calculatedDate) : '-'}
                                </Typography>
                              )
                            }
                          })()}
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={po.waybill || ''}
                            onChange={(e) => {
                              // Update local state immediately for better UX
                              setPos(prevPos => prevPos.map(p => 
                                p.id === po.id ? { ...p, waybill: e.target.value } : p
                              ))
                            }}
                            onBlur={(e) => handleUpdateTracking(po.id, 'waybill', e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.target.blur()
                              }
                            }}
                            placeholder="Enter waybill number"
                            disabled={!canCreatePO}
                            sx={{ minWidth: 150 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            value={po.invoice_number || ''}
                            onChange={(e) => {
                              // Update local state immediately for better UX
                              setPos(prevPos => prevPos.map(p => 
                                p.id === po.id ? { ...p, invoice_number: e.target.value } : p
                              ))
                            }}
                            onBlur={(e) => handleUpdateTracking(po.id, 'invoice_number', e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.target.blur()
                              }
                            }}
                            placeholder="Enter invoice number"
                            disabled={!canCreatePO}
                            sx={{ minWidth: 150 }}
                          />
                        </TableCell>
                        <TableCell>
                          {(po.child_pos && po.child_pos.length > 0) ? (
                            po.po_received ? (
                              <Tooltip title="All deliveries received - PO auto-marked as received">
                                <CheckCircleIcon color="success" />
                              </Tooltip>
                            ) : (
                              <Tooltip title="Receive individual deliveries below">
                                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', fontSize: '0.75rem' }}>
                                  Via deliveries
                                </Typography>
                              </Tooltip>
                            )
                          ) : (
                            <Checkbox
                              checked={po.po_received || false}
                              onChange={(e) => handleTogglePOReceived(po.id, e.target.checked)}
                              disabled={po.po_received || !canReceivePO}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getStatusText(po.status)}
                            color={getStatusColor(po.status)}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            {po.google_drive_folder_url && (
                              <Tooltip title="Open Google Drive Folder">
                                <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={() => window.open(po.google_drive_folder_url, '_blank', 'noopener,noreferrer')}
                                >
                                  <FolderOpenIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {po.has_qc_data && (
                              <Tooltip title={po.po_received ? "View QC Data & Undo Parts" : "View QC Data"}>
                                <IconButton
                                  size="small"
                                  color="info"
                                  onClick={() => po.po_received ? handleTogglePOReceived(po.id, true) : handleViewQCDetails(po.id)}
                                >
                                  <InfoIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {po.po_received && (
                              <Tooltip title="Resend Notification Email">
                                <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={() => setEmailNotifyDialog({ open: true, poId: po.id, poNumber: po.po_number })}
                                >
                                  <EmailIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {isAdmin && po.po_received && !(po.child_pos && po.child_pos.length > 0) && (
                              <Tooltip title="Undo Received Status (Admin Only)">
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="info"
                                  startIcon={<UndoIcon />}
                                  onClick={() => handleUndoPOReceived(po.id)}
                                >
                                  Undo
                                </Button>
                              </Tooltip>
                            )}
                            {canRegeneratePO && (
                              <Tooltip title="Regenerate PO with Latest Revisions">
                                <IconButton
                                  size="small"
                                  color="warning"
                                  onClick={() => handleRegeneratePO(po.id)}
                                  disabled={regeneratingPO === po.id}
                                >
                                  <RefreshIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canRegeneratePO && !po.po_received && (
                              <Tooltip title="Edit PO (full edit — replaces files in Drive folder)">
                                <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={() => handleOpenEditPO(po)}
                                >
                                  <EditIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canDelete && (
                              <Tooltip title="Delete PO">
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => handleDeletePO(po.id, po.po_number)}
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {canSplitDelivery && !po.is_child && (
                              <Tooltip title="Split Delivery">
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<AddIcon />}
                                  onClick={() => handleOpenAddDelivery(po)}
                                >
                                  Split Delivery
                                </Button>
                              </Tooltip>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                      {/* Child POs (Deliveries) */}
                      {(childPOs.length > 0 || addingDeliveryForPO === po.id) && (
                        <TableRow>
                          <TableCell colSpan={15} sx={{ py: 0, border: 0 }}>
                            <Collapse in={isExpanded || addingDeliveryForPO === po.id} timeout="auto" unmountOnExit>
                              <Box sx={{ margin: 1 }}>
                                <Typography variant="h6" gutterBottom component="div">
                                  Deliveries
                                </Typography>
                                <Table size="small">
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>Delivery #</TableCell>
                                      <TableCell>Balance</TableCell>
                                      <TableCell>Total Cost</TableCell>
                                      <TableCell>Delivery Date</TableCell>
                                      <TableCell>Waybill</TableCell>
                                      <TableCell>Invoice Number</TableCell>
                                      <TableCell>PO Received</TableCell>
                                      <TableCell>Actions</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {/* Inline Add Delivery Row */}
                                    {addingDeliveryForPO === po.id && (
                                      <TableRow sx={{ bgcolor: 'action.hover' }}>
                                        <TableCell>
                                          <Typography variant="body2" color="text.secondary">
                                            New Delivery
                                          </Typography>
                                        </TableCell>
                                        <TableCell>
                                          {(() => {
                                            const parentTotalCost = po.total_cost || 0
                                            const sumOfDeliveries = (childPOs.reduce((sum, delivery) => sum + (delivery.total_cost || 0), 0)) + (parseFloat(newDeliveryData.total_cost) || 0)
                                            const balance = parentTotalCost - sumOfDeliveries
                                            const currency = (po.currency || 'USD').toUpperCase()
                                            const symbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                                            return (
                                              <Typography
                                                variant="body2"
                                                sx={{
                                                  minWidth: 120,
                                                  padding: '8px',
                                                  color: balance < 0 ? 'error.main' : 'text.primary',
                                                  fontWeight: balance < 0 ? 'bold' : 'normal'
                                                }}
                                              >
                                                {symbol}{formatPrice(balance)}
                                              </Typography>
                                            )
                                          })()}
                                        </TableCell>
                                        <TableCell>
                                          <TextField
                                            size="small"
                                            type="number"
                                            value={newDeliveryData.total_cost}
                                            onChange={(e) => setNewDeliveryData({ ...newDeliveryData, total_cost: e.target.value })}
                                            onWheel={(e) => {
                                              e.target.blur()
                                              e.preventDefault()
                                            }}
                                            placeholder="0.00"
                                            inputProps={{ step: 0.01, min: 0 }}
                                            sx={{ minWidth: 120 }}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <TextField
                                            size="small"
                                            type="date"
                                            value={newDeliveryData.delivery_date}
                                            onChange={(e) => setNewDeliveryData({ ...newDeliveryData, delivery_date: e.target.value })}
                                            InputLabelProps={{ shrink: true }}
                                            sx={{ minWidth: 150 }}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <TextField
                                            size="small"
                                            value={newDeliveryData.waybill}
                                            onChange={(e) => setNewDeliveryData({ ...newDeliveryData, waybill: e.target.value })}
                                            placeholder="Waybill"
                                            sx={{ minWidth: 150 }}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <TextField
                                            size="small"
                                            value={newDeliveryData.invoice_number}
                                            onChange={(e) => setNewDeliveryData({ ...newDeliveryData, invoice_number: e.target.value })}
                                            placeholder="Invoice #"
                                            sx={{ minWidth: 150 }}
                                          />
                                        </TableCell>
                                        <TableCell>-</TableCell>
                                        <TableCell>
                                          <Box sx={{ display: 'flex', gap: 1 }}>
                                            <Button
                                              size="small"
                                              variant="contained"
                                              color="primary"
                                              onClick={() => handleAddDelivery(po.id)}
                                              disabled={addingDelivery}
                                              startIcon={addingDelivery ? <CircularProgress size={16} /> : <AddIcon />}
                                            >
                                              {addingDelivery ? 'Adding...' : 'Save'}
                                            </Button>
                                            <Button
                                              size="small"
                                              variant="outlined"
                                              onClick={handleCancelAddDelivery}
                                              disabled={addingDelivery}
                                            >
                                              Cancel
                                            </Button>
                                          </Box>
                                        </TableCell>
                                      </TableRow>
                                    )}
                                    {childPOs.map((child, childIndex) => {
                                      const isEditing = editingDeliveryId === child.id
                                      // Use child's po_date if available, otherwise use parent PO date
                                      const displayDate = child.po_date ? new Date(child.po_date) : (po.po_date ? new Date(po.po_date) : null)
                                      
                                      // Calculate balance: PO total - sum of all delivery costs
                                      const parentTotalCost = po.total_cost || 0
                                      const sumOfDeliveries = childPOs.reduce((sum, delivery, idx) => {
                                        if (isEditing && idx === childIndex) {
                                          // Use editing value for current delivery
                                          return sum + (parseFloat(editingDeliveryData.total_cost) || 0)
                                        }
                                        return sum + (delivery.total_cost || 0)
                                      }, 0)
                                      const balance = parentTotalCost - sumOfDeliveries
                                      const currency = (po.currency || 'USD').toUpperCase()
                                      const symbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                                      
                                      return (
                                        <TableRow key={child.id} sx={isEditing ? { bgcolor: 'action.hover' } : {}}>
                                          <TableCell>{child.po_number}</TableCell>
                                          <TableCell>
                                            <Typography
                                              variant="body2"
                                              sx={{
                                                minWidth: 120,
                                                padding: '8px',
                                                color: balance < 0 ? 'error.main' : 'text.primary',
                                                fontWeight: balance < 0 ? 'bold' : 'normal'
                                              }}
                                            >
                                              {symbol}{formatPrice(balance)}
                                            </Typography>
                                          </TableCell>
                                          <TableCell>
                                            {isEditing ? (
                                              <TextField
                                                size="small"
                                                type="number"
                                                value={editingDeliveryData.total_cost}
                                                onChange={(e) => setEditingDeliveryData({ ...editingDeliveryData, total_cost: e.target.value })}
                                                onWheel={(e) => {
                                                  e.target.blur()
                                                  e.preventDefault()
                                                }}
                                                placeholder="0.00"
                                                inputProps={{ step: 0.01, min: 0 }}
                                                sx={{ minWidth: 120 }}
                                              />
                                            ) : canEditPrices ? (
                                              <TextField
                                                size="small"
                                                type="number"
                                                value={child.total_cost || 0}
                                                onChange={(e) => updatePOFieldInState(child.id, 'total_cost', parseFloat(e.target.value) || 0)}
                                                onBlur={(e) => handleUpdatePOTotalCost(child.id, parseFloat(e.target.value) || 0)}
                                                onWheel={(e) => {
                                                  e.target.blur()
                                                  e.preventDefault()
                                                }}
                                                inputProps={{ step: 0.01, min: 0 }}
                                                sx={{ minWidth: 120 }}
                                              />
                                            ) : (
                                              (() => {
                                                const currency = (child.currency || po.currency || 'USD').toUpperCase()
                                                const symbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                                                return `${symbol}${formatPrice(child.total_cost || 0)}`
                                              })()
                                            )}
                                          </TableCell>
                                          <TableCell>
                                            {isEditing ? (
                                              <TextField
                                                size="small"
                                                type="date"
                                                value={editingDeliveryData.delivery_date}
                                                onChange={(e) => setEditingDeliveryData({ ...editingDeliveryData, delivery_date: e.target.value })}
                                                InputLabelProps={{ shrink: true }}
                                                sx={{ minWidth: 150 }}
                                              />
                                            ) : (
                                              <Typography
                                                variant="body2"
                                                sx={{ minWidth: 150, padding: '8px' }}
                                              >
                                                {displayDate ? formatDateDDMMYYYY(displayDate) : '-'}
                                              </Typography>
                                            )}
                                          </TableCell>
                                          <TableCell>
                                            {isEditing ? (
                                              <TextField
                                                size="small"
                                                value={editingDeliveryData.waybill}
                                                onChange={(e) => setEditingDeliveryData({ ...editingDeliveryData, waybill: e.target.value })}
                                                placeholder="Waybill"
                                                sx={{ minWidth: 150 }}
                                              />
                                            ) : (
                                              <TextField
                                                size="small"
                                                value={child.waybill || ''}
                                                onChange={(e) => updatePOFieldInState(child.id, 'waybill', e.target.value)}
                                                onBlur={(e) => handleUpdateTracking(child.id, 'waybill', e.target.value)}
                                                placeholder="Enter waybill number"
                                                disabled={!canReceivePO}
                                                sx={{ minWidth: 150 }}
                                              />
                                            )}
                                          </TableCell>
                                          <TableCell>
                                            {isEditing ? (
                                              <TextField
                                                size="small"
                                                value={editingDeliveryData.invoice_number}
                                                onChange={(e) => setEditingDeliveryData({ ...editingDeliveryData, invoice_number: e.target.value })}
                                                placeholder="Invoice #"
                                                sx={{ minWidth: 150 }}
                                              />
                                            ) : (
                                              <TextField
                                                size="small"
                                                value={child.invoice_number || ''}
                                                onChange={(e) => updatePOFieldInState(child.id, 'invoice_number', e.target.value)}
                                                onBlur={(e) => handleUpdateTracking(child.id, 'invoice_number', e.target.value)}
                                                placeholder="Enter invoice number"
                                                disabled={!canReceivePO}
                                                sx={{ minWidth: 150 }}
                                              />
                                            )}
                                          </TableCell>
                                          <TableCell>
                                            <Checkbox
                                              checked={child.po_received || false}
                                              onChange={(e) => handleTogglePOReceived(child.id, e.target.checked)}
                                              disabled={child.po_received || !canReceivePO || isEditing}
                                            />
                                          </TableCell>
                                          <TableCell>
                                            <Box sx={{ display: 'flex', gap: 1 }}>
                                              {isEditing ? (
                                                <>
                                                  <Button
                                                    size="small"
                                                    variant="contained"
                                                    color="primary"
                                                    onClick={() => handleSaveEditDelivery(child.id, po.id)}
                                                    disabled={savingDelivery}
                                                    startIcon={savingDelivery ? <CircularProgress size={16} /> : <SaveIcon />}
                                                  >
                                                    {savingDelivery ? 'Saving...' : 'Save'}
                                                  </Button>
                                                  <Button
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={handleCancelEditDelivery}
                                                    disabled={savingDelivery}
                                                    startIcon={<CancelIcon />}
                                                  >
                                                    Cancel
                                                  </Button>
                                                </>
                                              ) : (
                                                <>
                                                  {child.po_received && (
                                                    <>
                                                      <Tooltip title="Resend Notification Email">
                                                        <IconButton
                                                          size="small"
                                                          color="primary"
                                                          onClick={() => setEmailNotifyDialog({ open: true, poId: child.id, poNumber: child.po_number })}
                                                        >
                                                          <EmailIcon />
                                                        </IconButton>
                                                      </Tooltip>
                                                      <Tooltip title="View QC Data & Undo Parts">
                                                        <IconButton
                                                          size="small"
                                                          color="info"
                                                          onClick={() => handleTogglePOReceived(child.id, true)}
                                                        >
                                                          <InfoIcon />
                                                        </IconButton>
                                                      </Tooltip>
                                                    </>
                                                  )}
                                                  {isAdmin && child.po_received && (
                                                    <Tooltip title="Undo Received Status (Admin Only)">
                                                      <Button
                                                        size="small"
                                                        variant="outlined"
                                                        color="info"
                                                        startIcon={<UndoIcon />}
                                                        onClick={() => handleUndoPOReceived(child.id)}
                                                      >
                                                        Undo
                                                      </Button>
                                                    </Tooltip>
                                                  )}
                                                  {canCreatePO && (
                                                    <Tooltip title="Edit Delivery">
                                                      <IconButton
                                                        size="small"
                                                        color="primary"
                                                        onClick={() => handleStartEditDelivery(child, po)}
                                                      >
                                                        <EditIcon />
                                                      </IconButton>
                                                    </Tooltip>
                                                  )}
                                                  {canDelete && (
                                                    <IconButton
                                                      size="small"
                                                      color="error"
                                                      onClick={() => handleDeletePO(child.id, child.po_number)}
                                                    >
                                                      <DeleteIcon />
                                                    </IconButton>
                                                  )}
                                                </>
                                              )}
                                            </Box>
                                          </TableCell>
                                        </TableRow>
                                      )
                                    })}
                                  </TableBody>
                                </Table>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                    )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </Box>

      {/* PO Creation Modal */}
      <ResizableDialog
        id="poCreationModal"
        open={showPOCreationModal}
        onClose={() => !creatingPO && setShowPOCreationModal(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <POIcon />
            Create PO from RFQ
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 1 }}>
            Upload quotation files (optional) to automatically extract pricing information. You can upload multiple files. If no quotation is uploaded, prices can be entered manually later.
          </Alert>
          <Grid container spacing={2} sx={{ mt: 2.25 }}>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="PO Number"
                required
                value={poNumber}
                onChange={(e) => setPONumber(e.target.value)}
                disabled={creatingPO}
              />
            </Grid>
            <Grid item xs={12} sm={9} md={9} lg={9}>
              <FormControl fullWidth required sx={{ width: '100%', minWidth: '300px' }}>
                <InputLabel>Vendor</InputLabel>
                <Select
                  value={vendor}
                  label="Vendor"
                  onChange={(e) => setVendor(e.target.value)}
                  disabled={creatingPO || loadingVendors}
                  sx={{ width: '100%' }}
                >
                  {vendors.map((v) => (
                    <MenuItem key={v.id} value={v.name}>
                      {v.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={3} md={3} lg={3}>
              <FormControl fullWidth required>
                <InputLabel>Currency</InputLabel>
                <Select
                  value={currency}
                  label="Currency"
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={creatingPO}
                >
                  <MenuItem value="USD">USD ($)</MenuItem>
                  <MenuItem value="EUR">EUR (€)</MenuItem>
                  <MenuItem value="ILS">ILS (₪)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <Button
                variant="outlined"
                component="label"
                fullWidth
                startIcon={<UploadIcon />}
                disabled={creatingPO}
              >
                Upload Quotation Files
                <input
                  type="file"
                  hidden
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
                  onChange={handleFileChange}
                />
              </Button>
              {quotationFiles.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {quotationFiles.length} file(s) selected
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Upload PDF, Excel, or image files to extract pricing automatically (optional)
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={dontUpdatePartCosts}
                    onChange={(e) => setDontUpdatePartCosts(e.target.checked)}
                    disabled={creatingPO}
                  />
                }
                label="Don't update part costs in database (use prices only for this PO)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', ml: 4.5 }}>
                When checked, the PO Excel will use quotation prices but won't update the unit_cost in the part database. Existing part costs will remain unchanged.
              </Typography>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPOCreationModal(false)} disabled={creatingPO}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmitPOCreation}
            variant="contained"
            disabled={creatingPO || !poNumber.trim() || !vendor.trim()}
            startIcon={creatingPO ? <CircularProgress size={16} /> : <POIcon />}
          >
            {creatingPO ? 'Processing...' : 'Create PO'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Price Validation Modal */}
      <ResizableDialog
        id="priceValidationModal"
        open={showPriceValidationModal}
        onClose={() => !creatingPO && !uploadingQuotations && setShowPriceValidationModal(false)}
        maxWidth="lg"
        fullWidth
        defaultWidth="95vw"
        defaultHeight="90vh"
        PaperProps={{
          sx: {
            display: 'flex',
            flexDirection: 'column',
            height: '90vh'
          }
        }}
      >
        <DialogTitle sx={{ bgcolor: allPricesValid ? 'success.main' : 'warning.main', color: 'white', flexShrink: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <POIcon />
            PO Price Validation - PO {poNumber}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ mt: 2, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'auto', pb: 2 }}>
          {/* AI Price Warning Note */}
          {partsData.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1.5, flexShrink: 0 }}>
              <Typography variant="body2">
                <strong>⚠️ Note:</strong> Prices were extracted using AI. Please verify all prices before exporting the PO.
              </Typography>
            </Alert>
          )}

          {/* Price Validation + Add Part from DB */}
          <Box sx={{ mb: 1, display: 'flex', justifyContent: 'flex-end', gap: 1, flexShrink: 0 }}>
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<CompareIcon />}
              onClick={() => setShowPriceComparisonModal(true)}
              disabled={creatingPO || uploadingQuotations || partsData.length === 0}
            >
              Price Validation
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="primary"
              onClick={() => { setAddExtraOpen(true); setAddExtraSearch(''); setAddExtraResults([]) }}
              disabled={creatingPO || uploadingQuotations}
            >
              + Add Part from Database
            </Button>
          </Box>

          {/* Parts Table */}
          <TableContainer component={Paper} sx={{ mb: 1.5, flex: 1, minHeight: 200, overflow: 'auto', border: `1px solid ${tc.tableBorder || '#ddd'}` }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, minWidth: 140 }}>
                    <TableSortLabel
                      active={priceValidationSort !== null}
                      direction={priceValidationSort || 'asc'}
                      onClick={() => setPriceValidationSort(prev => prev === 'asc' ? 'desc' : 'asc')}
                    >
                      Part Number
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, minWidth: 70 }}>Revision</TableCell>
                  <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, minWidth: 60, textAlign: 'center' }}>Qty</TableCell>
                  <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, minWidth: 110 }}>Unit Cost</TableCell>
                  <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, minWidth: 110 }}>
                    <Tooltip title="Existing price in the parts database. Green = quotation is cheaper, red = more expensive">
                      <span>DB Price</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, minWidth: 110 }}>Total Cost</TableCell>
                  <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, minWidth: 80, textAlign: 'center' }}>
                    <Tooltip title="When checked, this part's price will NOT be saved to the part database">
                      <span>Keep DB</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, minWidth: 50, textAlign: 'center' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortPartsByNumber(partsData, priceValidationSort).map((part) => {
                  let unitCostCell

                  if (part.has_price && part.price_options && part.price_options.length > 1) {
                    // Multiple prices - show dropdown
                    const selectedIndex = part.price_options.findIndex(opt => opt.unit_cost === part.unit_cost)
                    unitCostCell = (
                      <FormControl size="small" fullWidth>
                        <Select
                          value={selectedIndex >= 0 ? selectedIndex : 0}
                          onChange={(e) => handleSelectPriceOption(part.part_number, e.target.value)}
                          disabled={!canEditPrices}
                        >
                          {part.price_options.map((option, idx) => {
                            const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                            return (
                              <MenuItem key={idx} value={idx}>
                                {currencySymbol}{formatPrice(option.unit_cost || 0)} ({option.source_file || 'Unknown'})
                              </MenuItem>
                            )
                          })}
                        </Select>
                      </FormControl>
                    )
                  } else {
                    // Single price or no price - show input with currency symbol
                    const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                    unitCostCell = canEditPrices ? (
                      <TextField
                        size="small"
                        type="number"
                        value={part.unit_cost != null ? part.unit_cost : ''}
                        onChange={(e) => handleUpdatePartPrice(part.part_number, e.target.value)}
                        placeholder="Enter price"
                        onWheel={(e) => {
                          e.target.blur()
                          e.preventDefault()
                        }}
                        inputProps={{ step: 0.01, min: 0 }}
                        InputProps={{ startAdornment: currencySymbol + ' ' }}
                        error={!part.has_price}
                        sx={{ minWidth: 110, flex: 1 }}
                      />
                    ) : (
                      `${currencySymbol} ${part.unit_cost != null ? part.unit_cost : '-'}`
                    )
                  }

                  return (
                    <TableRow key={`${part.part_number}_${part.revision}`}>
                      <TableCell>{part.part_number}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {part.revision}
                          {part.revision_updated && (
                            <Tooltip title={`Updated from REV ${part.old_revision}${part.files_missing ? ` \u2014 Missing: ${[part.pdf_missing && 'PDF', part.xt_missing && 'XT'].filter(Boolean).join(', ')}` : ''} \u2014 click to inspect DB revisions`}>
                              <Chip
                                label={part.files_missing ? '!' : 'NEW'}
                                size="small"
                                color={part.files_missing ? 'error' : 'info'}
                                onClick={() => openDbRevisionsDialog(part.part_number)}
                                sx={{ height: 18, fontSize: '0.65rem' }}
                              />
                            </Tooltip>
                          )}
                          {!part.revision_updated && part.files_missing && (
                            <Tooltip title={`Missing: ${[part.pdf_missing && 'PDF', part.xt_missing && 'XT'].filter(Boolean).join(', ')} for REV ${part.revision} \u2014 click to inspect DB revisions`}>
                              <Chip
                                label={part.pdf_missing && part.xt_missing ? 'NO FILES' : 'NO PDF'}
                                size="small"
                                color="error"
                                variant="outlined"
                                onClick={() => openDbRevisionsDialog(part.part_number)}
                                sx={{ height: 18, fontSize: '0.60rem' }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          type="number"
                          value={part.quantity || ''}
                          onChange={(e) => {
                            // Only allow integers - strip decimals immediately
                            const value = e.target.value
                            if (value === '' || /^\d+$/.test(value)) {
                              handleUpdatePartQuantity(part.part_number, value)
                            }
                          }}
                          onWheel={(e) => {
                            e.target.blur()
                            e.preventDefault()
                          }}
                          inputProps={{
                            step: 1,
                            min: 1,
                            style: { textAlign: 'center' }
                          }}
                          sx={{ minWidth: 60, flex: 1 }}
                        />
                      </TableCell>
                      <TableCell>{unitCostCell}</TableCell>
                      <TableCell sx={priceDiffCellSx(part)}>
                        {(() => {
                          const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                          if (part.db_unit_cost == null) {
                            return <Typography variant="body2" color="text.secondary">—</Typography>
                          }
                          const diffInfo = getPriceDiff(part)
                          return (
                            <Box>
                              <Typography variant="body2">{currencySymbol}{formatPrice(part.db_unit_cost)}</Typography>
                              {diffInfo && diffInfo.diff !== 0 && (
                                <Typography variant="caption" sx={{ color: diffInfo.diff < 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                                  {diffInfo.diff < 0 ? '▼' : '▲'} {currencySymbol}{formatPrice(Math.abs(diffInfo.diff))}
                                  {diffInfo.pct != null ? ` (${diffInfo.pct > 0 ? '+' : ''}${diffInfo.pct.toFixed(1)}%)` : ''}
                                </Typography>
                              )}
                            </Box>
                          )
                        })()}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                          return `${currencySymbol}${formatPrice(part.total_cost || 0)}`
                        })()}
                      </TableCell>
                      <TableCell sx={{ textAlign: 'center' }}>
                        <Tooltip title="Check to keep the existing database price (won't update DB with PO price)">
                          <Checkbox
                            size="small"
                            checked={!!part.keep_existing_price}
                            onChange={(e) => handleToggleKeepExistingPrice(part.part_number, e.target.checked)}
                            disabled={dontUpdatePartCosts}
                          />
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleRemovePart(part.part_number)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Additional Costs Section (Mold/Tooling/Setup) */}
          {additionalCosts.length > 0 && (
            <Card sx={{ mb: 1.5, flexShrink: 0 }}>
              <CardHeader
                title={`Additional Costs (${additionalCosts.length} items)`}
                titleTypographyProps={{ variant: 'subtitle2' }}
                sx={{ pb: 0, py: 1 }}
              />
              <CardContent sx={{ py: 1, overflow: 'auto' }}>
                <Table size="small" sx={{ minWidth: 500 }}>
                  <TableHead>
                    <TableRow sx={{ bgcolor: tc.tableHeaderBg }}>
                      <TableCell sx={{ fontWeight: 600, color: tc.tableHeaderText, fontSize: '0.85rem', minWidth: 80 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: tc.tableHeaderText, fontSize: '0.85rem', minWidth: 100 }}>Related Part</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: tc.tableHeaderText, fontSize: '0.85rem', minWidth: 50, textAlign: 'center' }}>Qty</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: tc.tableHeaderText, fontSize: '0.85rem', minWidth: 90 }}>Unit Cost</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: tc.tableHeaderText, fontSize: '0.85rem', minWidth: 90 }}>Total Cost</TableCell>
                      <TableCell sx={{ fontWeight: 600, color: tc.tableHeaderText, fontSize: '0.85rem', minWidth: 50, textAlign: 'center' }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {additionalCosts.map((cost, idx) => {
                      const currencySymbol = currency === 'EUR' ? '\u20ac' : currency === 'ILS' ? '\u20aa' : '$'
                      return (
                        <TableRow key={idx}>
                          <TableCell>
                            <Chip label={cost.cost_type} size="small" color="warning" />
                          </TableCell>
                          <TableCell>{cost.base_part_number}</TableCell>
                          <TableCell>{cost.quantity || 1}</TableCell>
                          <TableCell>{currencySymbol}{formatPrice(cost.unit_cost || 0)}</TableCell>
                          <TableCell>{currencySymbol}{formatPrice(cost.total_cost || 0)}</TableCell>
                          <TableCell>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setAdditionalCosts(prev => prev.filter((_, i) => i !== idx))}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow>
                      <TableCell colSpan={4} sx={{ fontWeight: 600, textAlign: 'right' }}>
                        Additional Costs Total:
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>
                        {(() => {
                          const currencySymbol = currency === 'EUR' ? '\u20ac' : currency === 'ILS' ? '\u20aa' : '$'
                          return `${currencySymbol}${formatPrice(additionalCostsTotal)}`
                        })()}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Upload Additional Quotations Section */}
          <Card sx={{ mb: 1.5 }}>
            <CardHeader title="Upload Additional Quotations" />
            <CardContent>
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={12} md={8}>
                  <Button
                    variant="outlined"
                    component="label"
                    fullWidth
                    startIcon={<UploadIcon />}
                    disabled={uploadingQuotations}
                  >
                    Select Quotation Files
                    <input
                      type="file"
                      hidden
                      multiple
                      accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
                      onChange={handleAdditionalFileChange}
                    />
                  </Button>
                  {additionalQuotationFiles.length > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      {additionalQuotationFiles.length} file(s) selected
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} md={4}>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={handleUploadAdditionalQuotations}
                    disabled={uploadingQuotations || additionalQuotationFiles.length === 0}
                    startIcon={uploadingQuotations ? <CircularProgress size={16} /> : <UploadIcon />}
                  >
                    {uploadingQuotations ? 'Processing...' : 'Process Quotations'}
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>

          {/* Summary Section */}
          <Card sx={{ flexShrink: 0 }}>
            <CardHeader title="PO Summary" titleTypographyProps={{ variant: 'subtitle2' }} sx={{ py: 1 }} />
            <CardContent>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '1.1rem' }}>{summary.total_parts || partsData.length}</Typography>
                    <Typography variant="caption" color="text.secondary">Total Parts</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '1.1rem' }} color="success.main">
                      {summary.parts_with_prices || partsData.filter(p => p.has_price).length}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Parts with Prices</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography sx={{ fontWeight: 700, fontSize: '1.1rem' }} color="error.main">
                      {summary.missing_prices_count || partsData.filter(p => !p.has_price).length}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">Missing Prices</Typography>
                  </Box>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Box sx={{ textAlign: 'center' }}>
                    {poDiscountApplied ? (
                      <>
                        <Typography variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                          {(() => {
                            const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                            return `${currencySymbol}${formatPrice(originalPOTotalCost)}`
                          })()}
                        </Typography>
                        <Typography sx={{ fontWeight: 700, fontSize: '1.1rem' }} color="success.main">
                          {(() => {
                            const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                            return `${currencySymbol}${formatPrice(calculatedPOTotalCost)}`
                          })()}
                        </Typography>
                        <Typography variant="caption" color="success.main">
                          After {poDiscountPercent}% Discount
                        </Typography>
                      </>
                    ) : (
                      <>
                        <Typography sx={{ fontWeight: 700, fontSize: '1.1rem' }} color="primary.main">
                          {(() => {
                            const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
                            return `${currencySymbol}${formatPrice(calculatedPOTotalCost)}`
                          })()}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">Total PO Cost</Typography>
                      </>
                    )}
                  </Box>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    fullWidth
                    label="Lead Time (days)"
                    type="number"
                    value={poLeadTime}
                    onChange={(e) => setPOLeadTime(e.target.value)}
                    disabled={creatingPO || uploadingQuotations}
                    inputProps={{ min: 0, step: 1 }}
                  />
                </Grid>
                <Grid item xs={12} sm={2}>
                  <TextField
                    fullWidth
                    label="Discount %"
                    type="number"
                    value={poDiscountPercent}
                    onChange={(e) => handlePODiscountPercentChange(e.target.value)}
                    disabled={creatingPO || uploadingQuotations || originalPOTotalCost <= 0}
                    inputProps={{ step: 0.01, min: 0, max: 100 }}
                    InputProps={{ endAdornment: '%' }}
                    placeholder="0"
                  />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    fullWidth
                    label="Discounted Total"
                    type="number"
                    value={manualPOTotalCost !== null ? manualPOTotalCost : ''}
                    onChange={(e) => handlePODiscountTotalChange(e.target.value)}
                    disabled={creatingPO || uploadingQuotations || originalPOTotalCost <= 0}
                    inputProps={{ step: 0.01, min: 0 }}
                    InputProps={{
                      startAdornment: (currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$') + ' '
                    }}
                    placeholder="Enter total"
                  />
                </Grid>
                <Grid item xs={12} sm={12}>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    {manualPOTotalCost !== null && !poDiscountApplied && (
                      <Button
                        variant="outlined"
                        color="primary"
                        size="small"
                        onClick={handleApplyPODiscount}
                        disabled={creatingPO || uploadingQuotations}
                      >
                        Apply {poDiscountPercent ? `${poDiscountPercent}%` : ''} Discount to Part Prices
                      </Button>
                    )}
                    {poDiscountApplied && (
                      <Button
                        variant="outlined"
                        color="warning"
                        size="small"
                        onClick={handleClearPODiscount}
                        disabled={creatingPO || uploadingQuotations}
                      >
                        Clear Discount
                      </Button>
                    )}
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowPriceValidationModal(false)}
            disabled={creatingPO || uploadingQuotations}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExportPO}
            variant="contained"
            color="success"
            disabled={!allPricesValid || creatingPO || uploadingQuotations}
            startIcon={creatingPO ? <CircularProgress size={16} /> : <POIcon />}
          >
            {creatingPO ? 'Exporting...' : 'Export PO'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Parts DB Revisions Dialog — inspect/clean up the revision rows behind the warning marks */}
      <Dialog
        open={dbRevDialogOpen}
        onClose={() => dbRevDeletingId == null && setDbRevDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Parts DB Revisions — {dbRevPartNumber}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            All revision rows stored in the parts database for this part number. The PO always uses the highest
            revision, even if it has no PDM files. Delete a wrong row and the validation table updates
            automatically to the new latest revision.
          </Typography>
          {dbRevLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Revision</TableCell>
                    <TableCell>State</TableCell>
                    <TableCell>ECO</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell align="center">PDM Files</TableCell>
                    <TableCell align="center">Used In</TableCell>
                    <TableCell align="center">Delete</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dbRevisions.map((rev, idx) => (
                    <TableRow key={rev.id} sx={idx === 0 ? { bgcolor: 'action.hover' } : undefined}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {rev.revision}
                          {idx === 0 && (
                            <Chip label="LATEST" size="small" color="primary" sx={{ height: 18, fontSize: '0.6rem' }} />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={rev.state || '—'}
                          size="small"
                          color={rev.state === 'Released' ? 'success' : 'warning'}
                          variant="outlined"
                          sx={{ height: 20 }}
                        />
                      </TableCell>
                      <TableCell>{rev.eco_number || '—'}</TableCell>
                      <TableCell>{rev.created_at || '—'}</TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          <Chip label="PDF" size="small" color={rev.has_pdf ? 'success' : 'error'} variant={rev.has_pdf ? 'filled' : 'outlined'} sx={{ height: 18, fontSize: '0.6rem' }} />
                          <Chip label="X_T" size="small" color={rev.has_xt ? 'success' : 'error'} variant={rev.has_xt ? 'filled' : 'outlined'} sx={{ height: 18, fontSize: '0.6rem' }} />
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Tooltip title={`BOM lines: ${rev.bom_count} · RFQ items: ${rev.rfq_count} · PO items: ${rev.po_count}`}>
                          <Typography variant="body2" color={rev.bom_count + rev.rfq_count + rev.po_count === 0 ? 'text.secondary' : 'text.primary'}>
                            {rev.bom_count + rev.rfq_count + rev.po_count === 0
                              ? 'Not used'
                              : `${rev.bom_count} BOM / ${rev.rfq_count} RFQ / ${rev.po_count} PO`}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          size="small"
                          color="error"
                          disabled={dbRevDeletingId != null}
                          onClick={() => handleDeleteDbRevision(rev)}
                        >
                          {dbRevDeletingId === rev.id ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                  {dbRevisions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">No revisions found</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDbRevDialogOpen(false)} disabled={dbRevDeletingId != null}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Add Extra Part to PO Dialog */}
      <Dialog
        open={addExtraOpen}
        onClose={() => setAddExtraOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Add Part from Database</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Search the parts database and add additional items to this PO. After adding, enter the unit price in the validation table. PDF/X_T files (if available) will be included in the PO ZIP.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Search by part number or description (min 2 chars)…"
            value={addExtraSearch}
            onChange={(e) => handleSearchExtraParts(e.target.value)}
            sx={{ mb: 1.5 }}
          />
          {addExtraLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
              <CircularProgress size={20} />
            </Box>
          )}
          {!addExtraLoading && addExtraResults.length === 0 && addExtraSearch.length >= 2 && (
            <Typography variant="caption" color="text.secondary">No parts found</Typography>
          )}
          {!addExtraLoading && addExtraResults.length > 0 && (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Part Number</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Rev</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>Last Cost</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {addExtraResults.map((p) => {
                    const inPO = partsData.some(x => x.part_number === p.part_number)
                    return (
                      <TableRow key={`${p.id}_${p.part_number}_${p.revision}`} hover>
                        <TableCell>{p.part_number}</TableCell>
                        <TableCell>{p.revision}</TableCell>
                        <TableCell sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.description || '—'}
                        </TableCell>
                        <TableCell>{p.part_type || '—'}</TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>
                          {p.unit_cost != null ? `$${formatPrice(p.unit_cost)}` : '—'}
                        </TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={inPO}
                            onClick={() => handleAddExtraPartToPO(p)}
                          >
                            {inPO ? 'Added' : 'Add'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddExtraOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>

      {/* Price Comparison Modal — DB price vs quotation price */}
      <Dialog
        open={showPriceComparisonModal}
        onClose={() => setShowPriceComparisonModal(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CompareIcon />
            Price Validation — PO {poNumber}
          </Box>
        </DialogTitle>
        <DialogContent>
          {(() => {
            const currencySymbol = currency === 'EUR' ? '€' : currency === 'ILS' ? '₪' : '$'
            const fmtMoney = (v) => (v == null ? '—' : `${currencySymbol}${formatPrice(v)}`)
            const fmtDiff = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '-' : ''}${currencySymbol}${formatPrice(Math.abs(v))}`)
            const diffSx = (d) => (d == null || Math.abs(d) < 0.005)
              ? {}
              : { bgcolor: d < 0 ? 'rgba(76, 175, 80, 0.18)' : 'rgba(244, 67, 54, 0.16)', fontWeight: 600 }

            const rows = sortPartsByNumber(partsData, priceValidationSort).map(part => {
              const qty = part.quantity || 0
              const dbPrice = part.db_unit_cost != null ? part.db_unit_cost : null
              const newPrice = part.has_price && part.unit_cost != null ? part.unit_cost : null
              const both = dbPrice != null && newPrice != null
              const unitDiff = both ? newPrice - dbPrice : null
              return {
                part,
                qty,
                dbPrice,
                newPrice,
                dbTotal: dbPrice != null ? dbPrice * qty : null,
                newTotal: newPrice != null ? newPrice * qty : null,
                unitDiff,
                totalDiff: both ? unitDiff * qty : null,
                pct: both && dbPrice ? (unitDiff / dbPrice) * 100 : null,
              }
            })
            const sumDb = rows.reduce((s, r) => s + (r.dbTotal || 0), 0)
            const sumNew = rows.reduce((s, r) => s + (r.newTotal || 0), 0)
            const sumDiff = rows.reduce((s, r) => s + (r.totalDiff || 0), 0)
            const cheaperCount = rows.filter(r => r.unitDiff != null && r.unitDiff < -0.005).length
            const pricierCount = rows.filter(r => r.unitDiff != null && r.unitDiff > 0.005).length
            const noDbCount = rows.filter(r => r.dbPrice == null).length

            return (
              <>
                <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                  <Chip size="small" color="success" variant="outlined" label={`${cheaperCount} cheaper than DB`} />
                  <Chip size="small" color="error" variant="outlined" label={`${pricierCount} more expensive`} />
                  {noDbCount > 0 && (
                    <Chip size="small" variant="outlined" label={`${noDbCount} without DB price`} />
                  )}
                </Box>
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '55vh' }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Part Number</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Rev</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, textAlign: 'center' }}>Qty</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, textAlign: 'right' }}>DB Unit Price</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, textAlign: 'right' }}>Quotation Unit Price</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, textAlign: 'right' }}>Unit Diff</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, textAlign: 'right' }}>Diff %</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, textAlign: 'right' }}>DB Total</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, textAlign: 'right' }}>Quotation Total</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600, textAlign: 'right' }}>Total Diff</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={`${r.part.part_number}_${r.part.revision}`}>
                          <TableCell>{r.part.part_number}</TableCell>
                          <TableCell>{r.part.revision}</TableCell>
                          <TableCell sx={{ textAlign: 'center' }}>{r.qty}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{fmtMoney(r.dbPrice)}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{fmtMoney(r.newPrice)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', ...diffSx(r.unitDiff) }}>{fmtDiff(r.unitDiff)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', ...diffSx(r.unitDiff) }}>
                            {r.pct != null ? `${r.pct > 0 ? '+' : ''}${r.pct.toFixed(1)}%` : '—'}
                          </TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{fmtMoney(r.dbTotal)}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>{fmtMoney(r.newTotal)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', ...diffSx(r.totalDiff) }}>{fmtDiff(r.totalDiff)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ '& td': { fontWeight: 700, borderTop: `2px solid ${tc.tableBorder || '#ccc'}` } }}>
                        <TableCell colSpan={7} sx={{ textAlign: 'right' }}>TOTAL</TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>{fmtMoney(sumDb)}</TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>{fmtMoney(sumNew)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', ...diffSx(sumDiff) }}>{fmtDiff(sumDiff)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Diff columns compare only parts that have a price in the database. DB prices are shown in {currency}
                  {currency !== 'USD' ? ' (converted from USD where needed)' : ''}.
                </Typography>
              </>
            )
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPriceComparisonModal(false)}>Close</Button>
          <Button
            variant="contained"
            startIcon={exportingPriceComparison ? <CircularProgress size={16} /> : <DownloadIcon />}
            onClick={handleExportPriceComparison}
            disabled={exportingPriceComparison || partsData.length === 0}
          >
            {exportingPriceComparison ? 'Exporting...' : 'Export to Excel'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit PO Modal */}
      <Dialog
        open={editPOOpen}
        onClose={() => !editPOSaving && setEditPOOpen(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <EditIcon />
            Edit PO {editPOData?.po_number} — full edit
          </Box>
        </DialogTitle>
        <DialogContent>
          {editPOLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : editPOData && (
            <>
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                <Typography variant="body2">
                  Saving will <strong>replace the Excel and ZIP files</strong> in the PO's Drive folder, and overwrite all PO line items. Inventory is unaffected — PO has not been received.
                </Typography>
              </Alert>

              <Grid container spacing={2} sx={{ mb: 1.5 }}>
                <Grid item xs={12} sm={5}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Vendor</InputLabel>
                    <Select
                      value={editPOData.vendor}
                      label="Vendor"
                      onChange={(e) => setEditPOData(d => ({ ...d, vendor: e.target.value }))}
                      disabled={editPOSaving || loadingVendors}
                    >
                      {vendors.map(v => (
                        <MenuItem key={v.id} value={v.name}>{v.name}</MenuItem>
                      ))}
                      {!vendors.find(v => v.name === editPOData.vendor) && editPOData.vendor && (
                        <MenuItem value={editPOData.vendor}>{editPOData.vendor}</MenuItem>
                      )}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Currency</InputLabel>
                    <Select
                      value={editPOData.currency}
                      label="Currency"
                      onChange={(e) => setEditPOData(d => ({ ...d, currency: e.target.value }))}
                      disabled={editPOSaving}
                    >
                      <MenuItem value="USD">USD ($)</MenuItem>
                      <MenuItem value="EUR">EUR (€)</MenuItem>
                      <MenuItem value="ILS">ILS (₪)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <TextField
                    fullWidth size="small" type="number"
                    label="Lead Time (days)"
                    value={editPOData.lead_time}
                    onChange={(e) => setEditPOData(d => ({ ...d, lead_time: e.target.value }))}
                    disabled={editPOSaving}
                    inputProps={{ min: 0, step: 1 }}
                  />
                </Grid>
              </Grid>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2">Line Items ({editPOItems.length})</Typography>
                <Button
                  size="small" variant="outlined"
                  onClick={() => { setEditPOAddSearchOpen(true); setEditPOAddSearch(''); setEditPOAddResults([]) }}
                  disabled={editPOSaving}
                >
                  + Add Part
                </Button>
              </Box>

              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 600 }}>Part Number</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Rev</TableCell>
                      <TableCell sx={{ fontWeight: 600, width: 100 }}>Qty</TableCell>
                      <TableCell sx={{ fontWeight: 600, width: 140 }}>Unit Cost ({editPOData.currency})</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Line Total</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {editPOItems.map((it, idx) => {
                      const sym = editPOData.currency === 'EUR' ? '€' : editPOData.currency === 'ILS' ? '₪' : '$'
                      const lineTotal = (parseFloat(it.unit_cost) || 0) * (parseInt(it.quantity) || 0)
                      return (
                        <TableRow key={`${it.part_number}_${idx}`}>
                          <TableCell>{it.part_number}</TableCell>
                          <TableCell>{it.revision}</TableCell>
                          <TableCell>
                            <TextField
                              size="small" type="number"
                              value={it.quantity}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v === '' || /^\d+$/.test(v)) handleEditPOItemChange(idx, 'quantity', v)
                              }}
                              inputProps={{ min: 1, step: 1, style: { textAlign: 'center' } }}
                              disabled={editPOSaving}
                              sx={{ width: 80 }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small" type="number"
                              value={it.unit_cost}
                              onChange={(e) => handleEditPOItemChange(idx, 'unit_cost', e.target.value)}
                              InputProps={{ startAdornment: sym + ' ' }}
                              inputProps={{ min: 0, step: 0.01 }}
                              disabled={editPOSaving}
                              sx={{ width: 130 }}
                              error={!it.unit_cost || parseFloat(it.unit_cost) <= 0}
                            />
                          </TableCell>
                          <TableCell>{sym}{formatPrice(lineTotal)}</TableCell>
                          <TableCell>
                            <IconButton size="small" color="error" onClick={() => handleEditPORemoveItem(idx)} disabled={editPOSaving}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ mt: 1, textAlign: 'right' }}>
                <Typography variant="subtitle2">
                  Total: {editPOData.currency === 'EUR' ? '€' : editPOData.currency === 'ILS' ? '₪' : '$'}
                  {formatPrice(editPOItems.reduce((sum, it) => sum + (parseFloat(it.unit_cost) || 0) * (parseInt(it.quantity) || 0), 0))}
                </Typography>
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditPOOpen(false)} disabled={editPOSaving}>Cancel</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSaveEditPO}
            disabled={editPOSaving || editPOLoading || editPOItems.length === 0}
            startIcon={editPOSaving ? <CircularProgress size={14} /> : <SaveIcon />}
          >
            {editPOSaving ? 'Saving…' : 'Save & Replace Files'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit PO — Add Part search popup */}
      <Dialog open={editPOAddSearchOpen} onClose={() => setEditPOAddSearchOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Add Part from Database</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small"
            placeholder="Search by part number or description…"
            value={editPOAddSearch}
            onChange={(e) => handleEditPOSearchAdd(e.target.value)}
            sx={{ mb: 1.5 }}
          />
          {editPOAddResults.length > 0 && (
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600 }}>Part Number</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Rev</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {editPOAddResults.map(p => {
                    const inPO = editPOItems.some(it => it.part_number === p.part_number)
                    return (
                      <TableRow key={p.id} hover>
                        <TableCell>{p.part_number}</TableCell>
                        <TableCell>{p.revision}</TableCell>
                        <TableCell sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.description || '—'}
                        </TableCell>
                        <TableCell>{p.part_type || '—'}</TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>
                          <Button
                            size="small" variant="contained"
                            disabled={inPO}
                            onClick={() => handleEditPOAddPart(p)}
                          >
                            {inPO ? 'Added' : 'Add'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditPOAddSearchOpen(false)}>Done</Button>
        </DialogActions>
      </Dialog>

      {/* PO Document Details Modal */}
      <ResizableDialog
        open={showPODocumentModal}
        onClose={() => setShowPODocumentModal(false)}
        maxWidth="sm"
        fullWidth
        id="poDocumentModal"
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ArticleIcon />
            PO Document Details
          </Box>
        </DialogTitle>
        <DialogContent>
          <FormControlLabel
            control={
              <Checkbox
                checked={generatePODocument}
                onChange={(e) => setGeneratePODocument(e.target.checked)}
              />
            }
            label={poDocumentSource === 'edit' ? 'Regenerate PO Document (Google Docs)' : 'Generate PO Document (Google Docs)'}
            sx={{ mb: 1, mt: 1 }}
          />
          {generatePODocument && (
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Quotation Details
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Contact Name"
                  fullWidth
                  size="small"
                  value={poTemplateVars.contact_name}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, contact_name: e.target.value }))}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Quotation Number"
                  fullWidth
                  size="small"
                  value={poTemplateVars.quotation_number}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, quotation_number: e.target.value }))}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Quotation Date"
                  fullWidth
                  size="small"
                  value={poTemplateVars.quotation_date}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, quotation_date: e.target.value }))}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Delivery Date"
                  fullWidth
                  size="small"
                  value={poTemplateVars.delivery_date}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, delivery_date: e.target.value }))}
                  helperText="Auto-suggested from the quotation/PO lead time — edit if needed"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Payment Terms"
                  fullWidth
                  size="small"
                  value={poTemplateVars.payment_terms}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, payment_terms: e.target.value }))}
                />
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 1 }}>
                  Orderer Details
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Orderer Name"
                  fullWidth
                  size="small"
                  value={poTemplateVars.orderer_name}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, orderer_name: e.target.value }))}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Orderer Email"
                  fullWidth
                  size="small"
                  value={poTemplateVars.orderer_email}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, orderer_email: e.target.value }))}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Orderer Phone"
                  fullWidth
                  size="small"
                  value={poTemplateVars.orderer_phone}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, orderer_phone: e.target.value }))}
                />
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 1 }}>
                  Approver Details
                </Typography>
              </Grid>
              {poApprovers.length > 0 && (
                <Grid item xs={12}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Select Approver</InputLabel>
                    <Select
                      label="Select Approver"
                      value={poApprovers.find(a => a.name === poTemplateVars.approver_name && a.title === poTemplateVars.approver_title)?.id || ''}
                      onChange={(e) => {
                        const selected = poApprovers.find(a => a.id === e.target.value)
                        if (selected) {
                          setPoTemplateVars(prev => ({
                            ...prev,
                            approver_name: selected.name,
                            approver_title: selected.title,
                          }))
                        }
                      }}
                    >
                      {poApprovers.map((approver) => (
                        <MenuItem key={approver.id} value={approver.id}>
                          {approver.name} — {approver.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              )}
              <Grid item xs={6}>
                <TextField
                  label="Approver Name"
                  fullWidth
                  size="small"
                  value={poTemplateVars.approver_name}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, approver_name: e.target.value }))}
                />
              </Grid>
              <Grid item xs={6}>
                <TextField
                  label="Approver Title"
                  fullWidth
                  size="small"
                  value={poTemplateVars.approver_title}
                  onChange={(e) => setPoTemplateVars(prev => ({ ...prev, approver_title: e.target.value }))}
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPODocumentModal(false)}>
            Cancel
          </Button>
          <Button
            onClick={
              poDocumentSource === 'edit' ? handleConfirmEditPO
                : poDocumentSource === 'direct' ? handleConfirmDirectPO
                : handleConfirmPODocument
            }
            variant="contained"
            color="success"
            disabled={creatingPO || creatingExistingPO || editPOSaving}
            startIcon={(creatingPO || creatingExistingPO || editPOSaving) ? <CircularProgress size={16} /> : <POIcon />}
          >
            {poDocumentSource === 'edit'
              ? (editPOSaving ? 'Saving PO...' : 'Save PO')
              : (creatingPO || creatingExistingPO) ? 'Creating PO...' : 'Create PO'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* PO Success Modal */}
      <ResizableDialog
        open={showPOSuccessModal}
        onClose={() => setShowPOSuccessModal(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'success.main', color: 'white' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleIcon />
            PO Created Successfully!
          </Box>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          {poSuccessData && (
            <>
              <Alert severity="success" sx={{ mb: 1.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  PO Created Successfully!
                </Typography>
                <Typography>
                  Your purchase order has been created and files have been uploaded to Google Drive.
                </Typography>
              </Alert>

              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography variant="subtitle1" gutterBottom>
                    <strong>PO Number:</strong> {poSuccessData.po_number}
                  </Typography>
                  <Typography variant="subtitle1" gutterBottom>
                    <strong>Total Cost:</strong> {(() => {
                      const poCurrency = poSuccessData.currency || 'USD'
                      const currencySymbol = poCurrency === 'EUR' ? '€' : poCurrency === 'ILS' ? '₪' : '$'
                      return `${currencySymbol}${formatPrice(poSuccessData.total_cost || 0)}`
                    })()}
                  </Typography>
                  <Typography variant="subtitle1" gutterBottom>
                    <strong>Parts Count:</strong> {poSuccessData.summary?.parts_count || 0}
                  </Typography>
                  {poSuccessData.summary?.excluded_count > 0 && (
                    <Typography variant="subtitle1" gutterBottom color="warning.main">
                      <strong>Excluded Parts:</strong> {poSuccessData.summary.excluded_count}
                    </Typography>
                  )}
                </Grid>
                <Grid item xs={12} md={6}>
                  {(poSuccessData.google_drive?.folder_url || poSuccessData.folder_url) && (
                    <Box sx={{ mb: 1 }}>
                      <Button
                        variant="contained"
                        color="primary"
                        fullWidth
                        startIcon={<FolderOpenIcon />}
                        href={poSuccessData.google_drive?.folder_url || poSuccessData.folder_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open Google Drive Folder
                      </Button>
                    </Box>
                  )}
                  {poSuccessData.po_doc_url && (
                    <Box sx={{ mb: 1 }}>
                      <Button
                        variant="contained"
                        color="success"
                        fullWidth
                        startIcon={<ArticleIcon />}
                        href={poSuccessData.po_doc_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open PO Document
                      </Button>
                    </Box>
                  )}
                </Grid>
              </Grid>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPOSuccessModal(false)} variant="contained" color="primary">
            Close
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Delete Confirmation Modal */}
      <ResizableDialog
        open={showDeleteConfirmModal}
        onClose={() => !deleting && setShowDeleteConfirmModal(false)}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this {deleteType === 'rfq' ? 'RFQ' : 'PO'}: <strong>{deleteName}</strong>?
          </Typography>
          <Typography variant="body2" color="error" sx={{ mt: 1 }}>
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDeleteConfirmModal(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            onClick={confirmDelete}
            variant="contained"
            color="error"
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={16} /> : <DeleteIcon />}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Revision Updates Modal */}
      <ResizableDialog
        open={showRevisionUpdatesModal}
        onClose={handleCancelRegenerate}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <RefreshIcon color="warning" />
            Revision Updates Detected
          </Box>
        </DialogTitle>
        <DialogContent>
          {revisionUpdatesData && (
            <>
              <Alert severity="info" sx={{ mb: 1 }}>
                The following parts have revision updates. Review the changes before proceeding.
              </Alert>

              <Box sx={{ mb: 1 }}>
                <Typography variant="subtitle1" gutterBottom>
                  Summary:
                </Typography>
                <Typography variant="body2">
                  • Total Parts: {revisionUpdatesData.summary?.total_parts || 0}
                </Typography>
                <Typography variant="body2" color="warning.main">
                  • Revision Changes: {revisionUpdatesData.summary?.revision_changes || 0}
                </Typography>
              </Box>

              {revisionUpdatesData.revision_updates?.length > 0 && (
                <TableContainer component={Paper} sx={{ maxHeight: '50vh', overflow: 'auto' }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600 }}>Part Number</TableCell>
                        <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600 }}>Revision Change</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {revisionUpdatesData.revision_updates.map((update, index) => (
                        <TableRow key={`${update.part_number}_${index}`}>
                          <TableCell>
                            <Typography variant="body2" fontWeight="medium">
                              {update.part_number}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Box>
                              <Typography variant="body2" color="text.secondary">
                                {update.old_revision}
                              </Typography>
                              <Typography variant="body2" component="span" sx={{ mx: 1 }}>
                                →
                              </Typography>
                              <Typography variant="body2" color="warning.main" fontWeight="medium">
                                {update.new_revision}
                              </Typography>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}

              {!revisionUpdatesData.revision_updates?.length && (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                  No revision changes detected
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelRegenerate} disabled={regeneratingPO !== null}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirmRegenerate}
            variant="contained"
            color="warning"
            disabled={regeneratingPO !== null}
            startIcon={regeneratingPO !== null ? <CircularProgress size={16} /> : <RefreshIcon />}
          >
            {regeneratingPO !== null ? 'Regenerating...' : 'Confirm & Regenerate'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Price Update Modal */}
      <ResizableDialog
        open={showPriceUpdateModal}
        onClose={() => setShowPriceUpdateModal(false)}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle>
          Price Update
          {priceUpdateStep > 0 && (
            <IconButton
              onClick={() => setPriceUpdateStep(priceUpdateStep - 1)}
              sx={{ position: 'absolute', right: 8, top: 8 }}
            >
              <UndoIcon />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '70vh', p: 2 }}>
          {priceUpdateStep === 0 && (
            <Box>
              <Typography gutterBottom>Select Part Type(s):</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                {priceUpdateTypes.map(type => (
                  <Chip
                    key={type}
                    label={type}
                    onClick={() => handleTypeSelect(type)}
                    clickable
                    color={selectedUpdateTypes.includes(type) ? 'primary' : 'default'}
                    variant={selectedUpdateTypes.includes(type) ? 'filled' : 'outlined'}
                  />
                ))}
              </Box>
              {selectedUpdateTypes.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {selectedUpdateTypes.length} type(s) selected
                  </Typography>
                  <Button variant="contained" onClick={handleTypeSelectContinue}>
                    Continue
                  </Button>
                </Box>
              )}
            </Box>
          )}

          {priceUpdateStep === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <Typography gutterBottom>Select Parts to Update ({selectedUpdateTypes.join(', ')}):</Typography>
              <Box sx={{ display: 'flex', gap: 2, mb: 1, mt: 1.25, flexShrink: 0 }}>
                <TextField
                  label="Search Parts"
                  value={updateSearchTerm}
                  onChange={(e) => setUpdateSearchTerm(e.target.value)}
                  placeholder="Search by part number or description"
                  sx={{ flex: 1 }}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  }}
                />
                {priceUpdateAvailableVendors.length > 0 && (
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Vendor</InputLabel>
                    <Select
                      value={priceUpdateVendorFilter}
                      label="Vendor"
                      onChange={(e) => setPriceUpdateVendorFilter(e.target.value)}
                    >
                      <MenuItem value="">All Vendors</MenuItem>
                      {priceUpdateAvailableVendors.map(v => (
                        <MenuItem key={v} value={v}>{v}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Box>
              <TableContainer component={Paper} sx={{ flex: 1, minHeight: 0, overflow: 'auto', mb: 1 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>
                        <Checkbox
                          checked={filteredUpdatePartsList.length > 0 && filteredUpdatePartsList.every(p => selectedUpdateParts.includes(p.id))}
                          indeterminate={filteredUpdatePartsList.some(p => selectedUpdateParts.includes(p.id)) && !filteredUpdatePartsList.every(p => selectedUpdateParts.includes(p.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const newSelected = [...selectedUpdateParts]
                              filteredUpdatePartsList.forEach(part => {
                                if (!newSelected.includes(part.id)) {
                                  newSelected.push(part.id)
                                }
                              })
                              setSelectedUpdateParts(newSelected)
                            } else {
                              const filteredIds = filteredUpdatePartsList.map(p => p.id)
                              setSelectedUpdateParts(selectedUpdateParts.filter(id => !filteredIds.includes(id)))
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>
                        <TableSortLabel
                          active={priceUpdateSort !== null}
                          direction={priceUpdateSort || 'asc'}
                          onClick={() => setPriceUpdateSort(prev => prev === 'asc' ? 'desc' : 'asc')}
                        >
                          Part Number
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Description</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Current Cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredUpdatePartsList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} align="center">
                          <Typography color="text.secondary">No parts found</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUpdatePartsList.map(part => (
                        <TableRow key={part.id} hover onClick={() => handleUpdatePartSelect(part.id)}>
                          <TableCell padding="checkbox">
                            <Checkbox checked={selectedUpdateParts.includes(part.id)} />
                          </TableCell>
                          <TableCell>{part.part_number}</TableCell>
                          <TableCell>{part.description}</TableCell>
                          <TableCell>${formatPrice(part.unit_cost || 0)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                <Button
                  variant="outlined"
                  component="label"
                  fullWidth
                  startIcon={<UploadIcon />}
                >
                  Upload Quotation Files (Optional)
                  <input
                    type="file"
                    hidden
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
                    onChange={handleUpdateFileChange}
                  />
                </Button>
                {updateQuotationFiles.length > 0 && (
                  <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                    {updateQuotationFiles.length} file(s) selected
                  </Typography>
                )}
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleContinueWithoutQuotation}
                  disabled={selectedUpdateParts.length === 0}
                >
                  Continue Without Quotation
                </Button>
              </Box>
            </Box>
          )}

          {priceUpdateStep === 2 && (
            <Box>
              <Grid container spacing={2} sx={{ mb: 1.5, mt: 2.25 }}>
                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth sx={{ minWidth: 300 }}>
                    <InputLabel>Vendor</InputLabel>
                    <Select
                      value={priceUpdateVendor}
                      label="Vendor"
                      onChange={(e) => {
                        const newVendor = e.target.value
                        setPriceUpdateVendor(newVendor)
                        // Apply vendor to all parts
                        if (partsData && partsData.length > 0) {
                          setPartsData(prev => prev.map(p => ({ ...p, vendor: newVendor })))
                        }
                      }}
                      disabled={processingUpdate || loadingVendors}
                    >
                      <MenuItem value=""><em>None</em></MenuItem>
                      {vendors.map((v) => (
                        <MenuItem key={v.id} value={v.name}>
                          {v.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <TextField
                    fullWidth
                    label="PO Number"
                    value={priceUpdatePONumber}
                    onChange={(e) => setPriceUpdatePONumber(e.target.value)}
                    disabled={processingUpdate}
                    placeholder="Optional"
                  />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <FormControl fullWidth>
                    <InputLabel>Currency</InputLabel>
                    <Select
                      value={priceUpdateCurrency}
                      label="Currency"
                      onChange={(e) => setPriceUpdateCurrency(e.target.value)}
                      disabled={processingUpdate}
                    >
                      <MenuItem value="USD">USD ($)</MenuItem>
                      <MenuItem value="EUR">EUR (€)</MenuItem>
                      <MenuItem value="ILS">ILS (₪)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
              <Typography gutterBottom>
                {updateQuotationFiles.length > 0 ? 'Review Extracted Prices:' : 'Enter Prices Manually:'}
              </Typography>
              <TableContainer component={Paper} sx={{ maxHeight: '60vh', minHeight: 200, overflow: 'auto' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>
                        <TableSortLabel
                          active={priceUpdateSort !== null}
                          direction={priceUpdateSort || 'asc'}
                          onClick={() => setPriceUpdateSort(prev => prev === 'asc' ? 'desc' : 'asc')}
                        >
                          Part Number
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Revision</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Description</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Current Cost</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>New Cost</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Current Inv.</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Add Qty</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Vendor</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Manufacturer</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Manufacturer PN</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Datasheet</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {partsData && partsData.length > 0 ? (
                      sortPartsByNumber(partsData, priceUpdateSort).map((part, idx) => {
                        if (!part || !part.part_number) {
                          return null
                        }
                        return (
                          <TableRow key={`${part.part_number}_${part.revision}_${idx}`}>
                            <TableCell>{part.part_number}</TableCell>
                            <TableCell>{part.revision || 'N/A'}</TableCell>
                            <TableCell>{part.description || 'N/A'}</TableCell>
                            <TableCell>${formatPrice(part.current_cost || 0)}</TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                value={part.unit_cost != null ? part.unit_cost : ''}
                                onChange={(e) => handleUpdatePartPrice(part.part_number, e.target.value)}
                                type="number"
                                inputProps={{ step: 0.01, min: 0 }}
                                InputProps={{
                                  startAdornment: (priceUpdateCurrency === 'EUR' ? '€' : priceUpdateCurrency === 'ILS' ? '₪' : '$') + ' '
                                }}
                                placeholder="Enter price"
                                error={!part.has_price && part.unit_cost === null}
                                disabled={!canEditPrices}
                                sx={{ width: 150 }}
                              />
                            </TableCell>
                            <TableCell>{part.current_inventory || 0}</TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                value={part.add_inventory || ''}
                                onChange={(e) => handleUpdatePartInventory(part.part_number, e.target.value)}
                                type="number"
                                inputProps={{ step: 1, min: 0 }}
                                placeholder="0"
                                sx={{ width: 100 }}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                value={part.vendor || ''}
                                onChange={(e) => handleUpdatePartField(part.part_number, 'vendor', e.target.value)}
                                placeholder="Vendor"
                                sx={{ width: 130 }}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                value={part.manufacturer || ''}
                                onChange={(e) => handleUpdatePartField(part.part_number, 'manufacturer', e.target.value)}
                                placeholder="Manufacturer"
                                sx={{ width: 150 }}
                              />
                            </TableCell>
                            <TableCell>
                              <TextField
                                size="small"
                                value={part.manufacturer_pn || ''}
                                onChange={(e) => handleUpdatePartField(part.part_number, 'manufacturer_pn', e.target.value)}
                                placeholder="MPN"
                                sx={{ width: 130 }}
                              />
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {part.datasheet_drive_url && (
                                  <Tooltip title="View current datasheet">
                                    <IconButton
                                      size="small"
                                      component="a"
                                      href={part.datasheet_drive_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      sx={{ color: 'info.main' }}
                                    >
                                      <ArticleIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                )}
                                <Tooltip title="Upload datasheet">
                                  <IconButton
                                    size="small"
                                    component="label"
                                    disabled={uploadingDatasheetForPart === part.part_number}
                                    sx={{ color: 'text.secondary' }}
                                  >
                                    {uploadingDatasheetForPart === part.part_number
                                      ? <CircularProgress size={14} />
                                      : <UploadDatasheetIcon fontSize="small" />}
                                    <input
                                      type="file"
                                      hidden
                                      accept=".pdf,.doc,.docx"
                                      onChange={e => handleUploadDatasheetInModal(part.part_number, e.target.files?.[0])}
                                    />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const orig = part._original || {}
                                const costChanged = part.unit_cost != null && parseFloat(part.unit_cost) !== parseFloat(orig.unit_cost || 0)
                                const invChanged = part.add_inventory && parseInt(part.add_inventory) > 0
                                const vendorChanged = (part.vendor || '').trim() !== (orig.vendor || '').trim()
                                const mfrChanged = (part.manufacturer || '').trim() !== (orig.manufacturer || '').trim()
                                const mfrPnChanged = (part.manufacturer_pn || '').trim() !== (orig.manufacturer_pn || '').trim()
                                const hasChanges = costChanged || invChanged || vendorChanged || mfrChanged || mfrPnChanged
                                return hasChanges
                                  ? <CheckCircleIcon color="success" />
                                  : <Typography color="text.secondary" variant="caption">No changes</Typography>
                              })()}
                            </TableCell>
                          </TableRow>
                        )
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={12} align="center">
                          <Typography color="text.secondary">No parts selected</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowPriceUpdateModal(false)
            setUpdateSearchTerm('')
          }}>Cancel</Button>
          {priceUpdateStep === 1 && updateQuotationFiles.length > 0 && (
            <Button
              variant="contained"
              onClick={handleProcessPriceUpdate}
              disabled={selectedUpdateParts.length === 0 || processingUpdate}
            >
              {processingUpdate ? 'Processing...' : 'Process Quotation'}
            </Button>
          )}
          {priceUpdateStep === 2 && (
            <Button
              variant="contained"
              onClick={handleFinalizePriceUpdate}
              disabled={processingUpdate}
            >
              {processingUpdate ? 'Updating...' : 'Update Prices'}
            </Button>
          )}
        </DialogActions>
      </ResizableDialog>

      {/* Create PO Without RFQ Modal */}
      <ResizableDialog
        open={showExistingPOModal}
        onClose={() => !creatingExistingPO && setShowExistingPOModal(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Create PO (Without RFQ)
          {existingPOStep > 0 && (
            <IconButton
              onClick={() => setExistingPOStep(existingPOStep - 1)}
              sx={{ position: 'absolute', right: 8, top: 8 }}
            >
              <UndoIcon />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '70vh', p: 2 }}>
          {existingPOStep === 0 && (
            <Box>
              <Typography gutterBottom>Select Part Type(s):</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                {existingPOTypes.map(type => (
                  <Chip
                    key={type}
                    label={type}
                    onClick={() => handleExistingPOTypeSelect(type)}
                    clickable
                    color={selectedExistingPOTypes.includes(type) ? 'primary' : 'default'}
                    variant={selectedExistingPOTypes.includes(type) ? 'filled' : 'outlined'}
                  />
                ))}
              </Box>
              {selectedExistingPOTypes.length > 0 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    {selectedExistingPOTypes.length} type(s) selected
                  </Typography>
                  <Button variant="contained" onClick={handleExistingPOTypeSelectContinue}>
                    Continue
                  </Button>
                </Box>
              )}
            </Box>
          )}

          {existingPOStep === 1 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <Typography gutterBottom>Select Parts ({selectedExistingPOTypes.join(', ')}):</Typography>
              <Box sx={{ display: 'flex', gap: 2, mb: 1, mt: 1.25, flexShrink: 0 }}>
                <TextField
                  label="Search Parts"
                  value={existingPOSearchTerm}
                  onChange={(e) => setExistingPOSearchTerm(e.target.value)}
                  placeholder="Search by part number or description"
                  sx={{ flex: 1 }}
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
                  }}
                />
                {existingPOAvailableVendors.length > 0 && (
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Vendor</InputLabel>
                    <Select
                      value={existingPOVendorFilter}
                      label="Vendor"
                      onChange={(e) => setExistingPOVendorFilter(e.target.value)}
                    >
                      <MenuItem value="">All Vendors</MenuItem>
                      {existingPOAvailableVendors.map(v => (
                        <MenuItem key={v} value={v}>{v}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Box>
              <TableContainer component={Paper} sx={{ flex: 1, minHeight: 0, overflow: 'auto', mb: 1 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>
                        <Checkbox
                          checked={filteredExistingPOPartsList.length > 0 && filteredExistingPOPartsList.every(p => selectedExistingPOParts.includes(p.id))}
                          indeterminate={filteredExistingPOPartsList.some(p => selectedExistingPOParts.includes(p.id)) && !filteredExistingPOPartsList.every(p => selectedExistingPOParts.includes(p.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              const newSelected = [...selectedExistingPOParts]
                              filteredExistingPOPartsList.forEach(part => {
                                if (!newSelected.includes(part.id)) {
                                  newSelected.push(part.id)
                                }
                              })
                              setSelectedExistingPOParts(newSelected)
                            } else {
                              const filteredIds = filteredExistingPOPartsList.map(p => p.id)
                              setSelectedExistingPOParts(selectedExistingPOParts.filter(id => !filteredIds.includes(id)))
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>
                        <TableSortLabel
                          active={existingPOSort !== null}
                          direction={existingPOSort || 'asc'}
                          onClick={() => setExistingPOSort(prev => prev === 'asc' ? 'desc' : 'asc')}
                        >
                          Part Number
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Description</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Current Cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredExistingPOPartsList.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} align="center">
                          <Typography color="text.secondary">No parts found</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredExistingPOPartsList.map(part => (
                        <TableRow key={part.id} hover onClick={() => handleExistingPOPartSelect(part.id)}>
                          <TableCell padding="checkbox">
                            <Checkbox checked={selectedExistingPOParts.includes(part.id)} />
                          </TableCell>
                          <TableCell>{part.part_number}</TableCell>
                          <TableCell>{part.description}</TableCell>
                          <TableCell>${formatPrice(part.unit_cost || 0)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
                <Button
                  variant="outlined"
                  component="label"
                  fullWidth
                  startIcon={<UploadIcon />}
                  disabled={creatingExistingPO}
                >
                  Upload Quotation Files (Optional)
                  <input
                    type="file"
                    hidden
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
                    onChange={handleExistingPOFileChange}
                  />
                </Button>
                {existingPOQuotationFiles.length > 0 && (
                  <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                    {existingPOQuotationFiles.length} file(s) selected
                  </Typography>
                )}
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleContinueExistingPOWithoutQuotation}
                  disabled={selectedExistingPOParts.length === 0 || creatingExistingPO}
                >
                  Continue Without Quotation
                </Button>
              </Box>
            </Box>
          )}

          {existingPOStep === 2 && (
            <Box>
              <Grid container spacing={2} sx={{ mb: 1.5, mt: 2.25 }}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="PO Number"
                    required
                    value={existingPONumber}
                    onChange={(e) => setExistingPONumber(e.target.value)}
                    disabled={creatingExistingPO}
                  />
                </Grid>
                <Grid item xs={12} sm={9} md={9} lg={9}>
                  <FormControl fullWidth required sx={{ width: '100%', minWidth: '300px' }}>
                    <InputLabel>Vendor</InputLabel>
                    <Select
                      value={existingPOVendor}
                      label="Vendor"
                      onChange={(e) => setExistingPOVendor(e.target.value)}
                      disabled={creatingExistingPO || loadingVendors}
                      sx={{ width: '100%' }}
                    >
                      {vendors.map((v) => (
                        <MenuItem key={v.id} value={v.name}>
                          {v.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={3} md={3} lg={3}>
                  <FormControl fullWidth required>
                    <InputLabel>Currency</InputLabel>
                    <Select
                      value={existingPOCurrency}
                      label="Currency"
                      onChange={(e) => setExistingPOCurrency(e.target.value)}
                      disabled={creatingExistingPO}
                    >
                      <MenuItem value="USD">USD ($)</MenuItem>
                      <MenuItem value="EUR">EUR (€)</MenuItem>
                      <MenuItem value="ILS">ILS (₪)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Lead Time (days)"
                    type="number"
                    value={existingPOLeadTime}
                    onChange={(e) => setExistingPOLeadTime(e.target.value)}
                    disabled={creatingExistingPO}
                    inputProps={{ min: 0, step: 1 }}
                  />
                </Grid>
              </Grid>

              {existingPOQuotationFiles.length > 0 && (
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleProcessExistingPOQuotations}
                  disabled={creatingExistingPO}
                  sx={{ mb: 1 }}
                >
                  {creatingExistingPO ? 'Processing...' : 'Process Quotation Files'}
                </Button>
              )}

              <Typography gutterBottom>
                {existingPOQuotationFiles.length > 0 ? 'Review Extracted Prices:' : 'Enter Prices Manually:'}
              </Typography>
              <TableContainer component={Paper} sx={{ maxHeight: '60vh', minHeight: 200, overflow: 'auto' }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>
                        <TableSortLabel
                          active={existingPOSort !== null}
                          direction={existingPOSort || 'asc'}
                          onClick={() => setExistingPOSort(prev => prev === 'asc' ? 'desc' : 'asc')}
                        >
                          Part Number
                        </TableSortLabel>
                      </TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Revision</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Description</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Qty</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Unit Cost</TableCell>
                      <TableCell sx={{ bgcolor: tc.tableHeaderBg, color: tc.tableHeaderText, fontWeight: 600 }}>Total Cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {existingPOPartsData && existingPOPartsData.length > 0 ? (
                      sortPartsByNumber(existingPOPartsData, existingPOSort).map((part, idx) => (
                        <TableRow key={`${part.part_number}_${part.revision}_${idx}`}>
                          <TableCell>{part.part_number}</TableCell>
                          <TableCell>{part.revision || 'N/A'}</TableCell>
                          <TableCell>{part.description || 'N/A'}</TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              type="number"
                              value={part.quantity || 1}
                              onChange={(e) => {
                                // Only allow integers - strip decimals immediately
                                const value = e.target.value
                                if (value === '' || /^\d+$/.test(value)) {
                                  handleUpdateExistingPOPartQuantity(part.part_number, value)
                                }
                              }}
                              onWheel={(e) => {
                                e.target.blur()
                                e.preventDefault()
                              }}
                              inputProps={{ min: 1, step: 1 }}
                              sx={{ width: 80 }}
                            />
                          </TableCell>
                          <TableCell>
                            <TextField
                              size="small"
                              value={part.unit_cost != null ? part.unit_cost : ''}
                              onChange={(e) => handleUpdateExistingPOPartPrice(part.part_number, e.target.value)}
                              type="number"
                              onWheel={(e) => {
                                e.target.blur()
                                e.preventDefault()
                              }}
                              inputProps={{ step: 0.01, min: 0 }}
                              InputProps={{
                                startAdornment: (existingPOCurrency === 'EUR' ? '€' : existingPOCurrency === 'ILS' ? '₪' : '$') + ' '
                              }}
                              placeholder="Enter price"
                              error={!part.has_price && part.unit_cost === null}
                              disabled={!canEditPrices}
                              sx={{ width: 150 }}
                            />
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const currencySymbol = existingPOCurrency === 'EUR' ? '€' : existingPOCurrency === 'ILS' ? '₪' : '$'
                              return `${currencySymbol}${formatPrice(part.total_cost || 0)}`
                            })()}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          <Typography color="text.secondary">No parts selected</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Discount Section */}
              {existingPOPartsData.length > 0 && (() => {
                const existingPOCurrentTotal = existingPOPartsData.reduce((sum, part) => sum + (part.total_cost || 0), 0)
                const existingPOOrigTotal = existingPOPartsData.reduce((sum, part) => sum + ((part._original_unit_cost || part.unit_cost || 0) * part.quantity), 0)
                const existingPODiscountApplied = existingPOPartsData.some(p => p._original_unit_cost != null)
                return (
                <Grid container spacing={2} sx={{ mt: 2 }} alignItems="center">
                  <Grid item xs={12} sm={3}>
                    <Box sx={{ textAlign: 'center' }}>
                      {existingPODiscountApplied ? (
                        <>
                          <Typography variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                            {(() => {
                              const currencySymbol = existingPOCurrency === 'EUR' ? '€' : existingPOCurrency === 'ILS' ? '₪' : '$'
                              return `${currencySymbol}${formatPrice(existingPOOrigTotal)}`
                            })()}
                          </Typography>
                          <Typography variant="h6" color="success.main">
                            {(() => {
                              const currencySymbol = existingPOCurrency === 'EUR' ? '€' : existingPOCurrency === 'ILS' ? '₪' : '$'
                              return `${currencySymbol}${formatPrice(existingPOCurrentTotal)}`
                            })()}
                          </Typography>
                          <Typography variant="caption" color="success.main">
                            After {existingPODiscountPercent}% Discount
                          </Typography>
                        </>
                      ) : (
                        <>
                          <Typography variant="h6" color="primary.main">
                            {(() => {
                              const currencySymbol = existingPOCurrency === 'EUR' ? '€' : existingPOCurrency === 'ILS' ? '₪' : '$'
                              return `${currencySymbol}${formatPrice(existingPOCurrentTotal)}`
                            })()}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">Total PO Cost</Typography>
                        </>
                      )}
                    </Box>
                  </Grid>
                  <Grid item xs={12} sm={2}>
                    <TextField
                      fullWidth
                      label="Discount %"
                      type="number"
                      size="small"
                      value={existingPODiscountPercent}
                      onChange={(e) => handleExistingPODiscountPercentChange(e.target.value)}
                      disabled={creatingExistingPO || existingPOOrigTotal <= 0}
                      inputProps={{ step: 0.01, min: 0, max: 100 }}
                      InputProps={{ endAdornment: '%' }}
                      placeholder="0"
                    />
                  </Grid>
                  <Grid item xs={12} sm={3}>
                    <TextField
                      fullWidth
                      label="Discounted Total"
                      type="number"
                      size="small"
                      value={existingPOManualTotal !== null ? existingPOManualTotal : ''}
                      onChange={(e) => handleExistingPODiscountTotalChange(e.target.value)}
                      disabled={creatingExistingPO || existingPOOrigTotal <= 0}
                      inputProps={{ step: 0.01, min: 0 }}
                      InputProps={{
                        startAdornment: (existingPOCurrency === 'EUR' ? '€' : existingPOCurrency === 'ILS' ? '₪' : '$') + ' '
                      }}
                      placeholder="Enter total"
                    />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      {existingPOManualTotal !== null && !existingPODiscountApplied && (
                        <Button
                          variant="outlined"
                          color="primary"
                          size="small"
                          onClick={handleApplyExistingPODiscount}
                          disabled={creatingExistingPO}
                        >
                          Apply {existingPODiscountPercent ? `${existingPODiscountPercent}%` : ''} Discount
                        </Button>
                      )}
                      {existingPODiscountApplied && (
                        <Button
                          variant="outlined"
                          color="warning"
                          size="small"
                          onClick={handleClearExistingPODiscount}
                          disabled={creatingExistingPO}
                        >
                          Clear Discount
                        </Button>
                      )}
                    </Box>
                  </Grid>
                </Grid>
                )
              })()}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowExistingPOModal(false)
            setExistingPOSearchTerm('')
          }} disabled={creatingExistingPO}>
            Cancel
          </Button>
          {existingPOStep === 1 && existingPOQuotationFiles.length > 0 && (
            <Button
              variant="contained"
              onClick={handleProcessExistingPOQuotations}
              disabled={selectedExistingPOParts.length === 0 || creatingExistingPO}
            >
              {creatingExistingPO ? 'Processing...' : 'Process Quotation'}
            </Button>
          )}
          {existingPOStep === 2 && (
            <Button
              variant="contained"
              onClick={handleFinalizeExistingPO}
              disabled={creatingExistingPO || !existingPONumber.trim() || !existingPOVendor.trim()}
            >
              {creatingExistingPO ? 'Creating...' : 'Create PO'}
            </Button>
          )}
        </DialogActions>
      </ResizableDialog>

      {/* PO Received Modal */}
      <ResizableDialog
        id="poReceivedModal"
        open={showPOReceivedModal}
        onClose={() => !markingReceived && setShowPOReceivedModal(false)}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleIcon />
            Mark PO as Received - {currentPOForReceiving?.po_number}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          <Alert severity="info" sx={{ mb: 1 }}>
            Review and approve parts for QC. Only QC-approved parts will be added to inventory.
          </Alert>
          <TextField
            fullWidth
            label="Search Parts"
            value={poReceivedSearchTerm}
            onChange={(e) => setPoReceivedSearchTerm(e.target.value)}
            placeholder="Search by part number, revision, notes, or warehouse box"
            sx={{ mb: 1 }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />
            }}
          />
          <Paper sx={{ maxHeight: '70vh', minHeight: 200, overflow: 'auto', flex: 1 }}>
            <TableContainer>
              <Table stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>
                      <TableSortLabel
                        active={poReceivedSort !== null}
                        direction={poReceivedSort || 'asc'}
                        onClick={() => setPoReceivedSort(prev => prev === 'asc' ? 'desc' : 'asc')}
                      >
                        Part Number
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Drawings</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Revision</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Quantity in PO</TableCell>
                    {currentPOForReceiving?.parent_po_id && (
                      <TableCell sx={{ bgcolor: '#fff3e0', fontWeight: 600, color: tc.tableHeaderText }}>Remaining Qty</TableCell>
                    )}
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>QTY Arrived</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>QTY Approved</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Warehouse Box</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Notes</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Checked</TableCell>
                    {isAdmin && <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Actions</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredQcData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={(isAdmin ? 10 : 9) + (currentPOForReceiving?.parent_po_id ? 1 : 0)} align="center">
                        <Typography color="text.secondary">No parts found</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredQcData.map((item, index) => {
                      // Find the original index in qcData for state updates
                      const originalIndex = qcData.findIndex(
                        q => q.part_number === item.part_number && q.revision === item.revision
                      )
                      const itemIndex = originalIndex >= 0 ? originalIndex : index
                    const partKey = `${item.part_number}_${item.revision}`
                    const thumbnail = poReceivedPartThumbnails[partKey]
                    const hasThumb = hasThumbnail(thumbnail)
                    // Check if part is received - explicitly check for true to ensure proper styling
                    const isReceived = item.received === true
                    // Check if part is fully received across other deliveries (remaining = 0)
                    const isFullyReceivedElsewhere = !isReceived && currentPOForReceiving?.parent_po_id && item.qty_remaining !== undefined && item.qty_remaining === 0
                    return (
                    <TableRow 
                      key={`${item.part_number}_${item.revision}`}
                      sx={{
                        bgcolor: isReceived ? 'rgba(76, 175, 80, 0.1)' : isFullyReceivedElsewhere ? 'rgba(76, 175, 80, 0.05)' : 'transparent',
                        opacity: isReceived ? 0.7 : isFullyReceivedElsewhere ? 0.6 : 1,
                        '& .MuiTableCell-root': {
                          color: (isReceived || isFullyReceivedElsewhere) ? 'rgba(0, 0, 0, 0.6)' : 'inherit'
                        }
                      }}
                    >
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography
                            component="span"
                            onClick={(e) => {
                              if (hasThumb) {
                                setPoReceivedHoveredPart({ partNumber: item.part_number, thumbnail, partKey })
                                setPoReceivedThumbnailAnchor(e.currentTarget)
                              }
                            }}
                            onMouseEnter={(e) => {
                              if (hasThumb) {
                                setPoReceivedHoveredPart({ partNumber: item.part_number, thumbnail, partKey })
                                setPoReceivedThumbnailAnchor(e.currentTarget)
                              }
                            }}
                            onMouseLeave={() => {
                              // Delay closing to allow moving to popover
                              setTimeout(() => {
                                if (!poReceivedThumbnailAnchor?.closest('.MuiPopover-root')) {
                                  setPoReceivedHoveredPart(null)
                                  setPoReceivedThumbnailAnchor(null)
                                }
                              }, 100)
                            }}
                            sx={{
                              cursor: hasThumb ? 'pointer' : 'default',
                              textDecoration: poReceivedHoveredPart?.partKey === partKey ? 'underline' : 'none',
                              '&:hover': {
                                textDecoration: hasThumb ? 'underline' : 'none',
                              }
                            }}
                          >
                            {item.part_number}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Tooltip title={`View PDF for ${item.part_number} REV${item.revision}`}>
                          <IconButton
                            size="small"
                            onClick={() => {
                              if (item.part_number && item.revision) {
                                window.open(`/api/part-pdf/${item.part_number}/${item.revision}?t=${Date.now()}`, '_blank')
                              }
                            }}
                            sx={{ color: 'error.main' }}
                          >
                            <PdfIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {item.revision}
                          {(() => {
                            const mKey = `${item.part_number}_${item.revision}`
                            const mismatch = revisionMismatches[mKey]
                            const decision = revisionDecisions[mKey]
                            if (!mismatch) return null
                            if (decision) {
                              return (
                                <Tooltip title={`Decision: ${decision.action === 'upgrade' ? `Upgrade inventory to ${mismatch.latest_revision}` : 'Keep original revision'} (click to change)`}>
                                  <Chip
                                    size="small"
                                    label={decision.action === 'upgrade' ? `→${mismatch.latest_revision}` : 'Keep'}
                                    color={decision.action === 'upgrade' ? 'info' : 'default'}
                                    onClick={() => setShowRevisionMismatchDialog(true)}
                                    sx={{ cursor: 'pointer', height: 20, fontSize: '0.7rem' }}
                                  />
                                </Tooltip>
                              )
                            }
                            return (
                              <Tooltip title={`BOM updated to ${mismatch.latest_revision} — click to resolve`}>
                                <Chip
                                  size="small"
                                  icon={<WarningIcon sx={{ fontSize: 14 }} />}
                                  label={`BOM: ${mismatch.latest_revision}`}
                                  color="warning"
                                  onClick={() => setShowRevisionMismatchDialog(true)}
                                  sx={{ cursor: 'pointer', height: 20, fontSize: '0.7rem' }}
                                />
                              </Tooltip>
                            )
                          })()}
                        </Box>
                      </TableCell>
                      <TableCell>{item.quantity_in_po}</TableCell>
                      {currentPOForReceiving?.parent_po_id && (
                        <TableCell>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 'bold',
                              color: (item.qty_remaining !== undefined && item.qty_remaining === 0) ? 'success.main' : 'warning.main'
                            }}
                          >
                            {item.qty_remaining !== undefined ? item.qty_remaining : item.quantity_in_po}
                          </Typography>
                        </TableCell>
                      )}
                      <TableCell>
                        <TextField
                          size="small"
                          type="number"
                          value={item.qty_arrived}
                          onChange={(e) => {
                            const updated = [...qcData]
                            const newVal = parseFloat(e.target.value) || 0
                            updated[itemIndex].qty_arrived = newVal
                            updated[itemIndex].qty_approved = newVal
                            setQcData(updated)
                          }}
                          onWheel={(e) => {
                            e.target.blur()
                            e.preventDefault()
                          }}
                          inputProps={{ min: 0, step: 1 }}
                          sx={{ width: 100 }}
                          disabled={isReceived || isFullyReceivedElsewhere}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          type="number"
                          value={item.qty_approved}
                          onChange={(e) => {
                            const updated = [...qcData]
                            updated[itemIndex].qty_approved = parseFloat(e.target.value) || 0
                            setQcData(updated)
                          }}
                          onWheel={(e) => {
                            e.target.blur()
                            e.preventDefault()
                          }}
                          inputProps={{ min: 0, step: 1 }}
                          sx={{ width: 100 }}
                          disabled={isReceived || isFullyReceivedElsewhere}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          value={item.warehouse_box_number || ''}
                          onChange={(e) => {
                            const updated = [...qcData]
                            updated[itemIndex].warehouse_box_number = e.target.value
                            setQcData(updated)
                            // Clear error when user types
                            const key = `${itemIndex}`
                            if (warehouseBoxErrors[key]) {
                              setWarehouseBoxErrors(prev => {
                                const newErrors = { ...prev }
                                delete newErrors[key]
                                return newErrors
                              })
                            }
                          }}
                          onBlur={async (e) => {
                            const boxNumber = e.target.value.trim()
                            const key = `${itemIndex}`
                            
                            // Validate pattern
                            const validation = validateWarehouseBoxNumber(boxNumber)
                            if (!validation.isValid) {
                              setWarehouseBoxErrors(prev => ({
                                ...prev,
                                [key]: validation.error
                              }))
                              showNotification(validation.error, 'error')
                              return
                            }
                            
                            // Check for duplicate if pattern is valid
                            if (boxNumber) {
                              setCheckingDuplicates(prev => ({ ...prev, [key]: true }))
                              try {
                                const duplicateCheck = await checkWarehouseBoxDuplicate(boxNumber)
                                if (duplicateCheck.exists) {
                                  const partInfo = duplicateCheck.partInfo
                                  const message = `Warehouse box number ${boxNumber} already exists for part ${partInfo.part_number} REV${partInfo.revision}. Are you sure you want to use it again?`
                                  const confirmed = window.confirm(message)
                                  setDuplicateConfirmations(prev => ({
                                    ...prev,
                                    [`${item.part_number}_${item.revision}`]: confirmed
                                  }))
                                  if (confirmed) {
                                    showNotification(`Using duplicate warehouse box number ${boxNumber}`, 'warning')
                                  }
                                }
                              } catch (error) {
                                console.error('Error checking duplicate:', error)
                              } finally {
                                setCheckingDuplicates(prev => {
                                  const newState = { ...prev }
                                  delete newState[key]
                                  return newState
                                })
                              }
                            }
                            
                            // Clear error if validation passed
                            setWarehouseBoxErrors(prev => {
                              const newErrors = { ...prev }
                              delete newErrors[key]
                              return newErrors
                            })
                          }}
                          placeholder="Enter box number"
                          sx={{ width: 150 }}
                          disabled={isReceived || isFullyReceivedElsewhere}
                          error={!!warehouseBoxErrors[`${itemIndex}`]}
                          helperText={warehouseBoxErrors[`${itemIndex}`] || ''}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          value={item.notes}
                          onChange={(e) => {
                            const updated = [...qcData]
                            updated[itemIndex].notes = e.target.value
                            setQcData(updated)
                          }}
                          placeholder="Enter notes"
                          multiline
                          rows={1}
                          sx={{ width: 200 }}
                          disabled={isReceived || isFullyReceivedElsewhere}
                        />
                      </TableCell>
                      <TableCell>
                        {isFullyReceivedElsewhere ? (
                          <Tooltip title="Fully received in other delivery">
                            <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 'bold', textAlign: 'center' }}>
                              ✓
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Checkbox
                            checked={item.checked}
                            onChange={(e) => {
                              const updated = [...qcData]
                              updated[itemIndex].checked = e.target.checked
                              setQcData(updated)
                            }}
                            disabled={isReceived}
                          />
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {item.part_exists === false && !isReceived && (
                            <Tooltip title={item.has_compatible_fallback
                              ? "Part revision not found but a backward-compatible revision exists. Will auto-resolve on receive. Click to update PO to latest revision."
                              : "Part revision not found in Part table. Click to update to latest revision."
                            }>
                              <IconButton
                                size="small"
                                onClick={() => handleRefreshPartRevision(item.part_number, item.revision)}
                                disabled={refreshingPart === item.part_number}
                                color={item.has_compatible_fallback ? 'info' : 'warning'}
                              >
                                <RefreshIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {isReceived && (
                            <Tooltip title="Undo Received Status (Admin Only)">
                              <IconButton
                                size="small"
                                onClick={() => handleUndoPartReceived(item.part_number, item.revision)}
                                disabled={markingReceived}
                                color="warning"
                              >
                                <UndoIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                    )
                  }))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
          
          {/* Thumbnail Hover Popover */}
          <Popover
            open={!!poReceivedHoveredPart && !!poReceivedThumbnailAnchor}
            anchorEl={poReceivedThumbnailAnchor}
            onClose={() => {
              setPoReceivedHoveredPart(null)
              setPoReceivedThumbnailAnchor(null)
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
              pointerEvents: 'none',
            }}
            onMouseEnter={() => {
              // Keep popover open when hovering over it
            }}
            onMouseLeave={() => {
              setPoReceivedHoveredPart(null)
              setPoReceivedThumbnailAnchor(null)
            }}
          >
            <Box sx={{ p: 2, maxWidth: 300 }}>
              {poReceivedHoveredPart && hasThumbnail(poReceivedHoveredPart.thumbnail) ? (
                <Box>
                  <img
                    src={getThumbnailSrc(poReceivedHoveredPart.thumbnail)}
                    alt={poReceivedHoveredPart.partNumber}
                    style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
                  />
                  <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                    {poReceivedHoveredPart.partNumber}
                  </Typography>
                </Box>
              ) : (
                <Typography variant="body2">No thumbnail available</Typography>
              )}
            </Box>
          </Popover>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            // Don't clear QC data - it's saved in qcDataByPO and will be restored when reopening
            setShowPOReceivedModal(false)
            setPoReceivedSearchTerm('')
            // Keep currentPOForReceiving and qcData so they can be restored
          }} disabled={markingReceived}>
            Cancel
          </Button>
          <Button
            onClick={handlePartialReceive}
            variant="outlined"
            color="primary"
            disabled={markingReceived || !qcData.some(item => item.checked && !item.received)}
            startIcon={markingReceived ? <CircularProgress size={16} /> : <SaveIcon />}
            sx={{ mr: 1 }}
          >
            {markingReceived ? 'Processing...' : 'Save and Update'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* PO Received - Email Notification Dialog */}
      <Dialog
        open={emailNotifyDialog.open}
        onClose={() => setEmailNotifyDialog({ open: false, poId: null, poNumber: '' })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <EmailIcon color="primary" />
            <span>Notify Finance — PO {emailNotifyDialog.poNumber}</span>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {(() => {
            const po = pos.find(p => p.id === emailNotifyDialog.poId)
            const senderName = user?.username || 'MenteeBOM User'
            const row = (label, value) => (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, gap: 2 }}>
                <Typography variant="body2" color="textSecondary">{label}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500, textAlign: 'right' }}>{value}</Typography>
              </Box>
            )
            return (
              <>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                  This will open Gmail with a pre-filled message to the Finance team confirming
                  receipt of this PO. Review the summary below, then approve to open Gmail or
                  decline to cancel.
                </Typography>

                <Box sx={{ mb: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  {row('To', FINANCE_EMAIL)}
                  {row('From (signed by)', senderName)}
                  {row('Subject', `PO ${emailNotifyDialog.poNumber} received notification`)}
                </Box>

                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  Receipt Summary
                </Typography>
                <Box sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  {row('Order Number', emailNotifyDialog.poNumber)}
                  {row('Vendor', po?.vendor || 'N/A')}
                  {row('Tracking Number', po?.waybill || 'N/A')}
                  {row('Invoice Number', po?.invoice_number || 'N/A')}
                  {row('Date Received', po?.received_date ? new Date(po.received_date).toLocaleDateString() : 'N/A')}
                  {row('Received By', senderName)}
                </Box>
              </>
            )
          })()}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setEmailNotifyDialog({ open: false, poId: null, poNumber: '' })}>
            Decline
          </Button>
          <Button
            onClick={handleSendReceivedEmail}
            variant="contained"
            startIcon={<EmailIcon />}
          >
            Approve & Open Gmail
          </Button>
        </DialogActions>
      </Dialog>

      {/* View QC Data Modal */}
      <ResizableDialog
        id="viewQCModal"
        open={showViewQCModal}
        onClose={() => {
          setShowViewQCModal(false)
          setEditingQCData(false)
          setEditingQCDataState([])
        }}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <InfoIcon />
              QC Data - {currentPOForViewing?.po_number}
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {!editingQCData && (
                <>
                  <Button
                    variant="outlined"
                    startIcon={<EditIcon />}
                    onClick={handleStartEditQC}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    onClick={() => handleExportQCToExcel(currentPOForViewing?.id)}
                  >
                    Export to Excel
                  </Button>
                </>
              )}
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ mt: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Paper sx={{ maxHeight: '70vh', minHeight: 200, overflow: 'auto', flex: 1 }}>
            <TableContainer>
              <Table stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>
                      <TableSortLabel
                        active={viewQCSort !== null}
                        direction={viewQCSort || 'asc'}
                        onClick={() => setViewQCSort(prev => prev === 'asc' ? 'desc' : 'asc')}
                      >
                        Part Number
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Revision</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Quantity in PO</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>QTY Arrived</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>QTY Approved</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>QC Approved</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Warehouse Box</TableCell>
                    <TableCell sx={{ bgcolor: tc.tableHeaderBg, fontWeight: 600, color: tc.tableHeaderText }}>Notes</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {viewQCData.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center">
                        <Typography color="text.secondary">No QC data available</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortPartsByNumber(editingQCData ? editingQCDataState : viewQCData, viewQCSort).map((item, index) => {
                      const qtyArrived = item.qty_arrived ?? item.quantity_in_po ?? 0
                      const qtyApproved = item.qty_approved ?? item.quantity_in_po ?? 0
                      const qtyNotApproved = Math.max(0, qtyArrived - qtyApproved)
                      // `index` is the position in the SORTED copy — resolve the real
                      // index in editingQCDataState so edits land on the right part
                      const realIndex = editingQCData
                        ? editingQCDataState.findIndex(q => q.part_number === item.part_number && q.revision === item.revision)
                        : index
                      const updateQCItem = (field, value) => {
                        setEditingQCDataState(prev => prev.map((q, i) => i === realIndex ? { ...q, [field]: value } : q))
                      }

                      return (
                        <TableRow
                          key={`${item.part_number}_${item.revision}`}
                          sx={{
                            bgcolor: item.qc_approved ? 'rgba(76, 175, 80, 0.08)' : 'transparent',
                          }}
                        >
                          <TableCell>{item.part_number}</TableCell>
                          <TableCell>{item.revision}</TableCell>
                          <TableCell>{item.quantity_in_po}</TableCell>
                          <TableCell>
                            {editingQCData ? (
                              <TextField
                                size="small"
                                type="number"
                                value={item.qty_arrived ?? item.quantity_in_po}
                                onChange={(e) => updateQCItem('qty_arrived', parseFloat(e.target.value) || 0)}
                                onWheel={(e) => {
                                  e.target.blur()
                                  e.preventDefault()
                                }}
                                inputProps={{ min: 0, step: 1 }}
                                sx={{ width: 100 }}
                              />
                            ) : (
                              qtyArrived
                            )}
                          </TableCell>
                          <TableCell>
                            {editingQCData ? (
                              <TextField
                                size="small"
                                type="number"
                                value={item.qty_approved ?? item.quantity_in_po}
                                onChange={(e) => updateQCItem('qty_approved', parseFloat(e.target.value) || 0)}
                                inputProps={{ min: 0, step: 1 }}
                                sx={{ width: 100 }}
                              />
                            ) : (
                              qtyApproved
                            )}
                          </TableCell>
                          <TableCell>
                            {item.qc_approved ? (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <CheckIcon color="success" fontSize="small" />
                                <Typography variant="body2" color="success.main" fontWeight="bold">Received</Typography>
                              </Box>
                            ) : (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <CloseIcon color="disabled" fontSize="small" />
                                <Typography variant="body2" color="text.secondary">Not received</Typography>
                              </Box>
                            )}
                          </TableCell>
                          <TableCell>
                            {editingQCData ? (
                              <TextField
                                size="small"
                                value={item.warehouse_box_number || ''}
                                onChange={(e) => {
                                  updateQCItem('warehouse_box_number', e.target.value)
                                  // Clear error when user types
                                  const key = `edit_${realIndex}`
                                  if (warehouseBoxErrors[key]) {
                                    setWarehouseBoxErrors(prev => {
                                      const newErrors = { ...prev }
                                      delete newErrors[key]
                                      return newErrors
                                    })
                                  }
                                }}
                                onBlur={async (e) => {
                                  const boxNumber = e.target.value.trim()
                                  const key = `edit_${realIndex}`
                                  
                                  // Validate pattern
                                  const validation = validateWarehouseBoxNumber(boxNumber)
                                  if (!validation.isValid) {
                                    setWarehouseBoxErrors(prev => ({
                                      ...prev,
                                      [key]: validation.error
                                    }))
                                    showNotification(validation.error, 'error')
                                    return
                                  }
                                  
                                  // Check for duplicate if pattern is valid
                                  if (boxNumber) {
                                    setCheckingDuplicates(prev => ({ ...prev, [key]: true }))
                                    try {
                                      const duplicateCheck = await checkWarehouseBoxDuplicate(boxNumber)
                                      if (duplicateCheck.exists) {
                                        const partInfo = duplicateCheck.partInfo
                                        const message = `Warehouse box number ${boxNumber} already exists for part ${partInfo.part_number} REV${partInfo.revision}. Are you sure you want to use it again?`
                                        const confirmed = window.confirm(message)
                                        setDuplicateConfirmations(prev => ({
                                          ...prev,
                                          [`${item.part_number}_${item.revision}`]: confirmed
                                        }))
                                        if (confirmed) {
                                          showNotification(`Using duplicate warehouse box number ${boxNumber}`, 'warning')
                                        }
                                      }
                                    } catch (error) {
                                      console.error('Error checking duplicate:', error)
                                    } finally {
                                      setCheckingDuplicates(prev => {
                                        const newState = { ...prev }
                                        delete newState[key]
                                        return newState
                                      })
                                    }
                                  }
                                  
                                  // Clear error if validation passed
                                  setWarehouseBoxErrors(prev => {
                                    const newErrors = { ...prev }
                                    delete newErrors[key]
                                    return newErrors
                                  })
                                }}
                                placeholder="Enter box number"
                                sx={{ width: 150 }}
                                error={!!warehouseBoxErrors[`edit_${realIndex}`]}
                                helperText={warehouseBoxErrors[`edit_${realIndex}`] || ''}
                              />
                            ) : (
                              item.warehouse_box_number || '-'
                            )}
                          </TableCell>
                          <TableCell>
                            {editingQCData ? (
                              <TextField
                                size="small"
                                value={item.notes || ''}
                                onChange={(e) => updateQCItem('notes', e.target.value)}
                                placeholder="Enter notes"
                                multiline
                                rows={1}
                                sx={{ width: 200 }}
                              />
                            ) : (
                              item.notes || '-'
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </DialogContent>
        <DialogActions>
          {editingQCData ? (
            <>
              <Button onClick={handleCancelEditQC} disabled={updatingQCData}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveEditQC}
                variant="contained"
                color="primary"
                disabled={updatingQCData}
                startIcon={updatingQCData ? <CircularProgress size={16} /> : <SaveIcon />}
              >
                {updatingQCData ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          ) : (
            <Button onClick={() => {
              setShowViewQCModal(false)
              setEditingQCData(false)
              setEditingQCDataState([])
            }}>
              Close
            </Button>
          )}
        </DialogActions>
      </ResizableDialog>

      {/* Vendor Management Modal */}
      <ResizableDialog id="vendorModal" open={showVendorModal} onClose={() => {
        setShowVendorModal(false)
        setEditingVendor(null)
        setVendorForm({ name: '', contact_name: '' })
      }} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <POIcon />
            Manage Vendors
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="h6">Vendor List</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="outlined" color="warning" onClick={handleOpenReconcile}>
                  Fix Mismatches
                </Button>
                <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateVendor}>
                  Add Vendor
                </Button>
              </Box>
            </Box>
            {loadingVendors ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                <CircularProgress />
              </Box>
            ) : vendors.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 5 }}>
                <Typography color="text.secondary">No vendors found</Typography>
              </Box>
            ) : (
              <TableContainer component={Paper}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Vendor Name</TableCell>
                      <TableCell>Contact Person</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {vendors.map((vendor) => (
                      <TableRow key={vendor.id} hover>
                        <TableCell>{vendor.name}</TableCell>
                        <TableCell>{vendor.contact_name || '-'}</TableCell>
                        <TableCell>{new Date(vendor.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <IconButton size="small" color="primary" onClick={() => handleEditVendor(vendor)}>
                            <EditIcon />
                          </IconButton>
                          <IconButton size="small" color="error" onClick={() => handleDeleteVendor(vendor.id)}>
                            <DeleteIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowVendorModal(false)
            setEditingVendor(null)
            setVendorForm({ name: '', contact_name: '' })
          }}>
            Close
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Add/Edit Vendor Form Modal */}
      <ResizableDialog id="vendorFormModal" open={showVendorFormModal} onClose={() => {
        setShowVendorFormModal(false)
        setEditingVendor(null)
        setVendorForm({ name: '', contact_name: '' })
      }} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Vendor Name"
            value={vendorForm.name}
            onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
            margin="normal"
            required
            autoFocus
          />
          <TextField
            fullWidth
            label="Contact Person Name"
            value={vendorForm.contact_name}
            onChange={(e) => setVendorForm({ ...vendorForm, contact_name: e.target.value })}
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowVendorFormModal(false)
            setEditingVendor(null)
            setVendorForm({ name: '', contact_name: '' })
          }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSaveVendor} disabled={!vendorForm.name.trim()}>
            {editingVendor ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Vendor Reconcile Modal */}
      <ResizableDialog id="vendorReconcileModal" open={showReconcileModal} onClose={() => setShowReconcileModal(false)} maxWidth="md" fullWidth>
        <DialogTitle>Fix Vendor Mismatches</DialogTitle>
        <DialogContent>
          {loadingUnmatched ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
              <CircularProgress />
            </Box>
          ) : unmatchedVendors.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 5 }}>
              <Typography color="success.main">All vendor names in parts match the vendor list.</Typography>
            </Box>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                The following vendor names exist in parts but don't match any entry in the vendor list.
                Select the correct canonical name for each row (suggestions are pre-filled), then click Apply.
                Leave a row blank to skip it.
              </Typography>
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Vendor string in parts</TableCell>
                      <TableCell align="center">Parts</TableCell>
                      <TableCell>Map to (canonical vendor)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {unmatchedVendors.map((item) => (
                      <TableRow key={item.vendor_string} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{item.vendor_string}</TableCell>
                        <TableCell align="center">{item.parts_count}</TableCell>
                        <TableCell>
                          <TextField
                            select
                            size="small"
                            fullWidth
                            value={reconcileMappings[item.vendor_string] || ''}
                            onChange={(e) => setReconcileMappings(prev => ({ ...prev, [item.vendor_string]: e.target.value }))}
                            SelectProps={{ native: true }}
                          >
                            <option value="">— skip —</option>
                            {canonicalVendors.map(name => (
                              <option key={name} value={name}>{name}</option>
                            ))}
                          </TextField>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowReconcileModal(false)}>Cancel</Button>
          {unmatchedVendors.length > 0 && (
            <Button
              variant="contained"
              onClick={handleApplyRemap}
              disabled={applyingRemap || Object.values(reconcileMappings).every(v => !v)}
            >
              {applyingRemap ? 'Applying…' : 'Apply'}
            </Button>
          )}
        </DialogActions>
      </ResizableDialog>

      {/* Revision Mismatch Decision Dialog */}
      <ResizableDialog
        id="revisionMismatchDialog"
        open={showRevisionMismatchDialog}
        onClose={() => setShowRevisionMismatchDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningIcon color="warning" />
          Revision Mismatch — Decide Before Receiving
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1 }}>
            Some parts in this PO were ordered at a different revision than the current BOM revision.
            Please decide for each part whether to <strong>upgrade inventory to the new revision</strong> or <strong>keep the original ordered revision</strong>.
          </Alert>

          {/* Bulk action buttons */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Button
              size="small"
              variant="outlined"
              color="info"
              onClick={() => {
                const bulk = {}
                Object.entries(revisionMismatches).forEach(([key, m]) => {
                  bulk[key] = { action: 'upgrade', target_revision: m.latest_revision }
                })
                setRevisionDecisions(bulk)
              }}
            >
              Upgrade All to Latest
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                const bulk = {}
                Object.entries(revisionMismatches).forEach(([key, m]) => {
                  bulk[key] = { action: 'keep_original', target_revision: m.po_revision }
                })
                setRevisionDecisions(bulk)
              }}
            >
              Keep All Original
            </Button>
          </Box>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Part Number</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>PO Revision</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>BOM Revision</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Decision</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(revisionMismatches).map(([key, m]) => {
                  const decision = revisionDecisions[key]
                  return (
                    <TableRow key={key}>
                      <TableCell>{m.part_number}</TableCell>
                      <TableCell>
                        <Chip size="small" label={m.part_type || 'Unknown'} />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={m.po_revision} color="default" />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={m.latest_revision} color="primary" />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Button
                            size="small"
                            variant={decision?.action === 'upgrade' ? 'contained' : 'outlined'}
                            color="info"
                            onClick={() => setRevisionDecisions(prev => ({
                              ...prev,
                              [key]: { action: 'upgrade', target_revision: m.latest_revision }
                            }))}
                            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                          >
                            Upgrade to {m.latest_revision}
                          </Button>
                          <Button
                            size="small"
                            variant={decision?.action === 'keep_original' ? 'contained' : 'outlined'}
                            color="inherit"
                            onClick={() => setRevisionDecisions(prev => ({
                              ...prev,
                              [key]: { action: 'keep_original', target_revision: m.po_revision }
                            }))}
                            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                          >
                            Keep {m.po_revision}
                          </Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowRevisionMismatchDialog(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={Object.keys(revisionMismatches).some(key => !revisionDecisions[key])}
            onClick={() => setShowRevisionMismatchDialog(false)}
          >
            Confirm Decisions ({Object.keys(revisionDecisions).length}/{Object.keys(revisionMismatches).length})
          </Button>
        </DialogActions>
      </ResizableDialog>

    </Box>
  )
}

export default Purchases
