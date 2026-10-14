import { useState, useEffect } from 'react'
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  CircularProgress,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Grid,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  ListItemIcon,
  ListSubheader,
  Divider,
  Tooltip,
  Checkbox,
} from '@mui/material'
import {
  Download as DownloadIcon,
  Upload as UploadIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Label as LabelIcon,
  Palette as PaletteIcon,
  People as PeopleIcon,
  Settings as SettingsIcon,
  ListAlt as ListAltIcon,
  Storage as StorageIcon,
  IntegrationInstructions as PDMIcon,
  Category as CategoryIcon,
  ArrowUpward as ArrowUpwardIcon,
  ArrowDownward as ArrowDownwardIcon,
  PrecisionManufacturing as RobotIcon,
  Assignment as AssignmentIcon,
  AttachMoney as CostRobotIcon,
  Warehouse as WarehouseIcon,
} from '@mui/icons-material'
import { useNotification } from '../context/NotificationContext'
import { useAuth } from '../context/AuthContext'
import { adminService } from '../services/adminService'
import ResizableDialog from '../components/ResizableDialog'
import RobotAssemblyAdmin from '../components/robot-assembly/RobotAssemblyAdmin'
import CostRobotAdmin from '../components/bom-cost/CostRobotAdmin'
import StockWiseAdmin from '../components/StockWiseAdmin'

const Admin = () => {
  const { showNotification } = useNotification()
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('users')
  
  // Users tab
  const [users, setUsers] = useState([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [userForm, setUserForm] = useState({ username: '', email: '', password: '', role: 'floor', phone: '' })

  // PO Settings tab
  const [poApprovers, setPoApprovers] = useState([])
  const [loadingApprovers, setLoadingApprovers] = useState(false)
  const [showApproverModal, setShowApproverModal] = useState(false)
  const [editingApprover, setEditingApprover] = useState(null)
  const [approverForm, setApproverForm] = useState({ name: '', title: '', email: '' })
  
  // System tab
  const [systemInfo, setSystemInfo] = useState(null)
  const [loadingSystemInfo, setLoadingSystemInfo] = useState(false)
  const [cleanupDays, setCleanupDays] = useState(30)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearConfirmText, setClearConfirmText] = useState('')
  
  // Logs tab
  const [logs, setLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logDateFilter, setLogDateFilter] = useState('')
  const [availableLogDates, setAvailableLogDates] = useState([])
  
  // Backup tab
  const [lastBackup, setLastBackup] = useState(null)
  const [backupHistory, setBackupHistory] = useState([])
  const [backupFile, setBackupFile] = useState(null)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [restoringBackup, setRestoringBackup] = useState(false)
  
  // PDM Integration tab
  const [pdmConfig, setPdmConfig] = useState({
    enabled: false,
    exporter_path: '',
    vault_name: 'pdm',
    default_bom_layout: 'MenteeBOM',
    default_configuration: 'Default',
    exporter_valid: false,
  })
  const [savingPDMConfig, setSavingPDMConfig] = useState(false)
  
  // Project Badges tab
  const [badges, setBadges] = useState([])
  const [loadingBadges, setLoadingBadges] = useState(false)
  const [showBadgeModal, setShowBadgeModal] = useState(false)
  const [editingBadge, setEditingBadge] = useState(null)
  const [badgeForm, setBadgeForm] = useState({ name: '', color: '#1976d2' })
  
  // Part Classifier tab
  const [classificationRules, setClassificationRules] = useState([])
  const [loadingRules, setLoadingRules] = useState(false)
  const [showRuleModal, setShowRuleModal] = useState(false)
  const [editingRule, setEditingRule] = useState(null)
  const [ruleForm, setRuleForm] = useState({ 
    part_type: '', 
    keyword: '', 
    classification_method: 'keyword', 
    priority: 100,
    is_active: true 
  })
  const [reclassifying, setReclassifying] = useState(false)
  const [testingRule, setTestingRule] = useState(null)
  const [ruleTestResults, setRuleTestResults] = useState(null)
  const [availablePartTypesForRules, setAvailablePartTypesForRules] = useState([])
  
  // Part Types tab
  const [partTypes, setPartTypes] = useState([])
  const [loadingPartTypes, setLoadingPartTypes] = useState(false)
  const [showPartTypeModal, setShowPartTypeModal] = useState(false)
  const [editingPartType, setEditingPartType] = useState(null)
  const [partTypeForm, setPartTypeForm] = useState({ name: '', color: '#6c757d' })
  const [migratingPartTypes, setMigratingPartTypes] = useState(false)
  
  // Unused Parts tab
  const [unusedParts, setUnusedParts] = useState([])
  const [loadingUnusedParts, setLoadingUnusedParts] = useState(false)
  const [selectedPartIds, setSelectedPartIds] = useState([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingParts, setDeletingParts] = useState(false)

  useEffect(() => {
    if (activeTab === 'users') loadUsers()
    else if (activeTab === 'system') loadSystemInfo()
    else if (activeTab === 'logs') loadLogs()
    else if (activeTab === 'backup') loadLastBackup()
    else if (activeTab === 'pdm') loadPDMConfig()
    else if (activeTab === 'badges') loadBadges()
    else if (activeTab === 'classifier') loadClassificationRules()
    else if (activeTab === 'partTypes') loadPartTypes()
    else if (activeTab === 'unusedParts') loadUnusedParts()
    else if (activeTab === 'poSettings') loadApprovers()
  }, [activeTab])

  // Users tab functions
  const loadUsers = async () => {
    setLoadingUsers(true)
    try {
      const response = await adminService.getUsers()
      setUsers(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      console.error('Error loading users:', error)
      showNotification('Error loading users', 'error')
    } finally {
      setLoadingUsers(false)
    }
  }

  const handleCreateUser = () => {
    setEditingUser(null)
    setUserForm({ username: '', email: '', password: '', role: 'floor', phone: '' })
    setShowUserModal(true)
  }

  const handleEditUser = (user) => {
    setEditingUser(user)
    setUserForm({ username: user.username, email: user.email, password: '', role: user.role, phone: user.phone || '' })
    setShowUserModal(true)
  }

  const handleSaveUser = async () => {
    try {
      if (editingUser) {
        const updateData = {
          id: editingUser.id,
          username: userForm.username,
          email: userForm.email,
          role: userForm.role,
          phone: userForm.phone,
        }
        if (userForm.password) {
          updateData.password = userForm.password
        }
        await adminService.updateUser(editingUser.id, updateData)
        showNotification('User updated successfully', 'success')
      } else {
        await adminService.createUser(userForm)
        showNotification('User created successfully', 'success')
      }
      setShowUserModal(false)
      loadUsers()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error saving user', 'error')
    }
  }

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return
    try {
      await adminService.deleteUser(userId)
      showNotification('User deleted successfully', 'success')
      loadUsers()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error deleting user', 'error')
    }
  }

  // PO Approvers tab functions
  const loadApprovers = async () => {
    setLoadingApprovers(true)
    try {
      const response = await adminService.getPOApprovers()
      setPoApprovers(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      console.error('Error loading approvers:', error)
      showNotification('Error loading PO approvers', 'error')
    } finally {
      setLoadingApprovers(false)
    }
  }

  const handleCreateApprover = () => {
    setEditingApprover(null)
    setApproverForm({ name: '', title: '', email: '' })
    setShowApproverModal(true)
  }

  const handleEditApprover = (approver) => {
    setEditingApprover(approver)
    setApproverForm({ name: approver.name, title: approver.title, email: approver.email || '' })
    setShowApproverModal(true)
  }

  const handleSaveApprover = async () => {
    try {
      if (editingApprover) {
        await adminService.updatePOApprover(editingApprover.id, approverForm)
        showNotification('Approver updated successfully', 'success')
      } else {
        await adminService.createPOApprover(approverForm)
        showNotification('Approver created successfully', 'success')
      }
      setShowApproverModal(false)
      loadApprovers()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error saving approver', 'error')
    }
  }

  const handleDeleteApprover = async (approverId) => {
    if (!window.confirm('Are you sure you want to delete this approver?')) return
    try {
      await adminService.deletePOApprover(approverId)
      showNotification('Approver deleted successfully', 'success')
      loadApprovers()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error deleting approver', 'error')
    }
  }

  const handleToggleApproverActive = async (approver) => {
    try {
      await adminService.updatePOApprover(approver.id, { is_active: !approver.is_active })
      showNotification(`Approver ${approver.is_active ? 'deactivated' : 'activated'} successfully`, 'success')
      loadApprovers()
    } catch (error) {
      showNotification('Error updating approver status', 'error')
    }
  }

  // System tab functions
  const loadSystemInfo = async () => {
    setLoadingSystemInfo(true)
    try {
      const response = await adminService.getSystemInfo()
      if (response.data.success) {
        setSystemInfo(response.data.system)
      }
    } catch (error) {
      console.error('Error loading system info:', error)
    } finally {
      setLoadingSystemInfo(false)
    }
  }

  const handleCleanupDatabase = async () => {
    if (!window.confirm(`Are you sure you want to delete all BOMs older than ${cleanupDays} days? This action cannot be undone.`)) return
    try {
      const response = await adminService.cleanupDatabase({ days_to_keep: cleanupDays })
      if (response.data.success) {
        showNotification(response.data.message, 'success')
        loadSystemInfo()
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error cleaning up database', 'error')
    }
  }

  const handleClearDatabase = async () => {
    if (clearConfirmText !== 'DELETE ALL') {
      showNotification('Confirmation text must be exactly "DELETE ALL"', 'error')
      return
    }
    if (!window.confirm('FINAL WARNING: This will delete ALL data except users. Are you ABSOLUTELY sure?')) return
    try {
      const response = await adminService.clearDatabase({ confirm_text: clearConfirmText })
      if (response.data.success) {
        showNotification(response.data.message, 'success')
        setShowClearConfirm(false)
        setClearConfirmText('')
        loadSystemInfo()
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error clearing database', 'error')
    }
  }

  // Logs tab functions
  const loadLogs = async (date) => {
    const selectedDate = date !== undefined ? date : logDateFilter
    setLoadingLogs(true)
    try {
      const response = await adminService.getLogs({ date: selectedDate || undefined, max_lines: 500 })
      if (response.data.success) {
        setLogs(response.data.entries || [])
        setAvailableLogDates(response.data.available_dates || [])
      }
    } catch (error) {
      console.error('Error loading logs:', error)
      showNotification('Error loading logs', 'error')
    } finally {
      setLoadingLogs(false)
    }
  }

  const exportLogs = () => {
    const dateFilter = logDateFilter || new Date().toISOString().split('T')[0]
    const logPath = `Documents/MenteeBOM Data/logs/menteebom_${dateFilter}.log`
    showNotification(`Log file location: ${logPath}. You can open it directly with Notepad.`, 'info')
  }

  // Backup tab functions
  const loadLastBackup = async () => {
    try {
      const response = await adminService.getLastBackup()
      if (response.data.success) {
        setLastBackup(response.data.last_backup)
        setBackupHistory(response.data.history || [])
      }
    } catch (error) {
      console.error('Error loading last backup:', error)
    }
  }

  const handleCreateBackup = async () => {
    setCreatingBackup(true)
    try {
      const response = await adminService.createBackup()
      if (response.data.success) {
        showNotification(`Backup created successfully: ${response.data.backup_filename} (${response.data.backup_size})`, 'success')
        loadLastBackup()
      } else {
        showNotification('Error creating backup', 'error')
      }
    } catch (error) {
      showNotification('Error creating backup', 'error')
    } finally {
      setCreatingBackup(false)
    }
  }

  const handleRestoreBackup = async () => {
    if (!backupFile) {
      showNotification('Please select a backup file', 'warning')
      return
    }
    if (!window.confirm('Are you sure you want to restore from backup? This will overwrite current data. The application will need to be restarted.')) return
    setRestoringBackup(true)
    try {
      const response = await adminService.restoreBackup(backupFile)
      if (response.data.success) {
        showNotification(response.data.message || 'Backup restored successfully. Please restart the application.', 'success')
        if (response.data.safety_backup) {
          showNotification(`Safety backup created: ${response.data.safety_backup}`, 'info')
        }
        setBackupFile(null)
      } else {
        showNotification(response.data.error || 'Error restoring backup', 'error')
      }
    } catch (error) {
      showNotification('Error restoring backup', 'error')
    } finally {
      setRestoringBackup(false)
    }
  }

  // PDM Integration tab functions
  const loadPDMConfig = async () => {
    try {
      const response = await adminService.getPDMConfig()
      if (response.data) {
        setPdmConfig(response.data)
      }
    } catch (error) {
      console.error('Error loading PDM config:', error)
    }
  }

  const handleSavePDMConfig = async () => {
    setSavingPDMConfig(true)
    try {
      await adminService.savePDMConfig(pdmConfig)
      showNotification('PDM configuration saved successfully', 'success')
      loadPDMConfig()
    } catch (error) {
      showNotification('Error saving PDM configuration', 'error')
    } finally {
      setSavingPDMConfig(false)
    }
  }

  const handleTestPDMConnection = () => {
    showNotification('Testing PDM connection...', 'info')
    if (pdmConfig.enabled && pdmConfig.exporter_valid) {
      showNotification('PDM connection test successful', 'success')
    } else {
      showNotification('PDM connection test failed', 'error')
    }
  }

  // Project Badges tab functions
  const loadBadges = async () => {
    setLoadingBadges(true)
    try {
      const response = await adminService.getBadges()
      setBadges(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      console.error('Error loading badges:', error)
      showNotification('Error loading badges', 'error')
    } finally {
      setLoadingBadges(false)
    }
  }

  const handleCreateBadge = () => {
    setEditingBadge(null)
    setBadgeForm({ name: '', color: '#1976d2' })
    setShowBadgeModal(true)
  }

  const handleEditBadge = (badge) => {
    setEditingBadge(badge)
    setBadgeForm({ name: badge.name, color: badge.color })
    setShowBadgeModal(true)
  }

  const handleSaveBadge = async () => {
    try {
      if (editingBadge) {
        await adminService.updateBadge(editingBadge.id, badgeForm)
        showNotification('Badge updated successfully', 'success')
      } else {
        await adminService.createBadge(badgeForm)
        showNotification('Badge created successfully', 'success')
      }
      setShowBadgeModal(false)
      loadBadges()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error saving badge', 'error')
    }
  }

  const handleDeleteBadge = async (badgeId) => {
    if (!window.confirm('Are you sure you want to delete this badge?')) return
    try {
      await adminService.deleteBadge(badgeId)
      showNotification('Badge deleted successfully', 'success')
      loadBadges()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error deleting badge', 'error')
    }
  }

  // Part Classifier tab functions
  const loadClassificationRules = async () => {
    setLoadingRules(true)
    try {
      const [rulesResponse, typesResponse] = await Promise.all([
        adminService.getClassificationRules(),
        adminService.getPartTypes()
      ])
      setClassificationRules(Array.isArray(rulesResponse.data) ? rulesResponse.data : [])
      setAvailablePartTypesForRules(Array.isArray(typesResponse.data) ? typesResponse.data.map(t => t.name) : [])
    } catch (error) {
      console.error('Error loading classification rules:', error)
      showNotification('Error loading classification rules', 'error')
    } finally {
      setLoadingRules(false)
    }
  }

  const handleCreateRule = () => {
    setEditingRule(null)
    setRuleForm({ 
      part_type: '', 
      keyword: '', 
      classification_method: 'keyword', 
      priority: 100,
      is_active: true 
    })
    setShowRuleModal(true)
  }

  const handleEditRule = (rule) => {
    setEditingRule(rule)
    setRuleForm({ 
      part_type: rule.part_type, 
      keyword: rule.keyword, 
      classification_method: rule.classification_method,
      priority: rule.priority || 100,
      is_active: rule.is_active 
    })
    setShowRuleModal(true)
  }

  const handleTestRule = async (ruleId) => {
    setTestingRule(ruleId)
    setRuleTestResults(null)
    try {
      const response = await adminService.testClassificationRule(ruleId)
      if (response.data.success) {
        setRuleTestResults(response.data)
      }
    } catch (error) {
      showNotification('Error testing rule', 'error')
    } finally {
      setTestingRule(null)
    }
  }

  const handleMoveRulePriority = async (ruleId, direction) => {
    const rule = classificationRules.find(r => r.id === ruleId)
    if (!rule) return
    
    const sameTypeRules = classificationRules
      .filter(r => r.part_type === rule.part_type)
      .sort((a, b) => (a.priority || 100) - (b.priority || 100))
    
    const currentIndex = sameTypeRules.findIndex(r => r.id === ruleId)
    if (currentIndex === -1) return
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (newIndex < 0 || newIndex >= sameTypeRules.length) return
    
    const targetRule = sameTypeRules[newIndex]
    const currentPriority = rule.priority || 100
    const targetPriority = targetRule.priority || 100
    
    // Swap priorities
    try {
      await adminService.reorderClassificationRules([
        { id: ruleId, priority: targetPriority },
        { id: targetRule.id, priority: currentPriority }
      ])
      loadClassificationRules()
    } catch (error) {
      showNotification('Error reordering rules', 'error')
    }
  }

  const handleReclassifyAllParts = async () => {
    if (!window.confirm('This will reclassify all parts in all BOMs based on the current rules. This may take a moment. Continue?')) return
    
    setReclassifying(true)
    try {
      await adminService.reclassifyAllParts()
      showNotification('All parts reclassified successfully', 'success')
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error reclassifying parts', 'error')
    } finally {
      setReclassifying(false)
    }
  }

  const handleSaveRule = async () => {
    try {
      if (editingRule) {
        await adminService.updateClassificationRule(editingRule.id, ruleForm)
        showNotification('Classification rule updated successfully', 'success')
      } else {
        await adminService.createClassificationRule(ruleForm)
        showNotification('Classification rule created successfully', 'success')
      }
      setShowRuleModal(false)
      loadClassificationRules()
      // Reload classifier
      try {
        await adminService.reloadPartClassifier()
      } catch (e) {
        console.warn('Could not reload classifier:', e)
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error saving classification rule', 'error')
    }
  }

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm('Are you sure you want to delete this classification rule?')) return
    try {
      await adminService.deleteClassificationRule(ruleId)
      showNotification('Classification rule deleted successfully', 'success')
      loadClassificationRules()
      // Reload classifier
      try {
        await adminService.reloadPartClassifier()
      } catch (e) {
        console.warn('Could not reload classifier:', e)
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error deleting classification rule', 'error')
    }
  }

  // Part Types tab functions
  const loadPartTypes = async () => {
    setLoadingPartTypes(true)
    try {
      const response = await adminService.getPartTypes()
      setPartTypes(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      console.error('Error loading part types:', error)
      showNotification('Error loading part types', 'error')
    } finally {
      setLoadingPartTypes(false)
    }
  }

  const handleCreatePartType = () => {
    setEditingPartType(null)
    setPartTypeForm({ name: '', color: '#6c757d' })
    setShowPartTypeModal(true)
  }

  const handleEditPartType = (partType) => {
    setEditingPartType(partType)
    setPartTypeForm({ name: partType.name, color: partType.color || '#6c757d' })
    setShowPartTypeModal(true)
  }

  const handleSavePartType = async () => {
    try {
      if (editingPartType) {
        await adminService.updatePartType(editingPartType.id, partTypeForm)
        showNotification('Part type renamed successfully. All parts and rules have been updated.', 'success')
      } else {
        await adminService.createPartType(partTypeForm)
        showNotification('Part type created successfully', 'success')
      }
      setShowPartTypeModal(false)
      loadPartTypes()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error saving part type', 'error')
    }
  }

  const handleDeletePartType = async (typeId) => {
    const partType = partTypes.find(pt => pt.id === typeId)
    if (!partType) return
    
    const partCount = partType.part_count || 0
    const confirmMessage = partCount > 0
      ? `This will delete "${partType.name}" and reassign ${partCount} part(s) to "Unknown" type. Are you sure?`
      : `Are you sure you want to delete "${partType.name}"?`
    
    if (!window.confirm(confirmMessage)) return
    
    try {
      const response = await adminService.deletePartType(typeId)
      if (response.data.success) {
        const message = partCount > 0
          ? `Part type deleted. ${response.data.parts_reassigned} part(s) reassigned to "Unknown".`
          : 'Part type deleted successfully'
        showNotification(message, 'success')
        loadPartTypes()
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error deleting part type', 'error')
    }
  }

  const handleMigratePartTypes = async () => {
    if (!window.confirm('This will create Part Type records from existing part data. Continue?')) return
    
    setMigratingPartTypes(true)
    try {
      const response = await adminService.migratePartTypes()
      if (response.data.success) {
        showNotification(
          `Migration complete: ${response.data.created} created, ${response.data.skipped} already existed`,
          'success'
        )
        loadPartTypes()
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error migrating part types', 'error')
    } finally {
      setMigratingPartTypes(false)
    }
  }

  // Unused Parts tab functions
  const loadUnusedParts = async () => {
    setLoadingUnusedParts(true)
    try {
      const response = await adminService.getUnusedParts()
      console.log('Unused parts response:', response)
      console.log('Response data:', response.data)
      if (response.data && response.data.success) {
        const parts = Array.isArray(response.data.parts) ? response.data.parts : []
        console.log('Setting unused parts:', parts.length, 'parts')
        setUnusedParts(parts)
        setSelectedPartIds([])
      } else {
        console.warn('Response not successful or missing success field:', response.data)
        setUnusedParts([])
      }
    } catch (error) {
      console.error('Error loading unused parts:', error)
      showNotification('Error loading unused parts', 'error')
      setUnusedParts([])
    } finally {
      setLoadingUnusedParts(false)
    }
  }

  const handleSelectPart = (partId) => {
    setSelectedPartIds(prev => 
      prev.includes(partId) 
        ? prev.filter(id => id !== partId)
        : [...prev, partId]
    )
  }

  const handleSelectAllParts = () => {
    if (selectedPartIds.length === unusedParts.length) {
      setSelectedPartIds([])
    } else {
      setSelectedPartIds(unusedParts.map(p => p.id))
    }
  }

  const handleDeleteSelectedParts = () => {
    if (selectedPartIds.length === 0) {
      showNotification('Please select parts to delete', 'warning')
      return
    }
    setShowDeleteConfirm(true)
  }

  const handleDeleteAllParts = () => {
    if (unusedParts.length === 0) {
      showNotification('No unused parts to delete', 'info')
      return
    }
    setSelectedPartIds(unusedParts.map(p => p.id))
    setShowDeleteConfirm(true)
  }

  const confirmDeleteParts = async () => {
    if (selectedPartIds.length === 0) {
      showNotification('No parts selected', 'warning')
      return
    }

    setDeletingParts(true)
    try {
      const response = await adminService.deleteUnusedParts(selectedPartIds)
      if (response.data.success) {
        showNotification(
          `Successfully deleted ${response.data.deleted_count} unused part(s)`,
          'success'
        )
        setShowDeleteConfirm(false)
        setSelectedPartIds([])
        loadUnusedParts()
      } else {
        showNotification(response.data.error || 'Error deleting parts', 'error')
      }
    } catch (error) {
      showNotification(
        error.response?.data?.error || 'Error deleting parts',
        'error'
      )
    } finally {
      setDeletingParts(false)
    }
  }

  const handleDeleteSinglePart = async (partId) => {
    if (!window.confirm(`Are you sure you want to delete part ID ${partId}?`)) return
    
    setDeletingParts(true)
    try {
      const response = await adminService.deleteUnusedParts([partId])
      if (response.data.success) {
        showNotification(
          `Successfully deleted part`,
          'success'
        )
        loadUnusedParts()
      } else {
        showNotification(response.data.error || 'Error deleting part', 'error')
      }
    } catch (error) {
      showNotification(
        error.response?.data?.error || 'Error deleting part',
        'error'
      )
    } finally {
      setDeletingParts(false)
    }
  }

  // Group rules by part type
  const groupedRules = classificationRules.reduce((acc, rule) => {
    if (!acc[rule.part_type]) {
      acc[rule.part_type] = []
    }
    acc[rule.part_type].push(rule)
    return acc
  }, {})

  return (
    <Box sx={{ width: '100%', height: 'calc(100vh - 44px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ px: 1.5, pt: 0.75, pb: 0.25, flexShrink: 0 }}>
        <Typography variant="h5" sx={{ fontSize: '0.95rem', fontWeight: 600, mb: 0.25 }}>
          Admin Panel
        </Typography>
        <Typography variant="body2" color="text.secondary">
          System administration and user management
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar Navigation */}
        <Box sx={{
          width: 220, flexShrink: 0, borderRight: 1, borderColor: 'divider',
          overflowY: 'auto', bgcolor: 'background.default',
        }}>
          <List dense disablePadding>
            <ListSubheader sx={{ lineHeight: '32px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', color: 'text.secondary', bgcolor: 'background.default' }}>
              SYSTEM
            </ListSubheader>
            {[
              { key: 'users', icon: <PeopleIcon fontSize="small" />, label: 'Users' },
              { key: 'system', icon: <SettingsIcon fontSize="small" />, label: 'System' },
              { key: 'logs', icon: <ListAltIcon fontSize="small" />, label: 'Logs' },
              { key: 'backup', icon: <StorageIcon fontSize="small" />, label: 'Backup' },
            ].map(item => (
              <ListItemButton
                key={item.key}
                selected={activeTab === item.key}
                onClick={() => setActiveTab(item.key)}
                sx={{ py: 0.5, pl: 2, minHeight: 36 }}
              >
                <ListItemIcon sx={{ minWidth: 32, color: activeTab === item.key ? 'primary.main' : 'text.secondary' }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    variant: 'body2',
                    fontWeight: activeTab === item.key ? 600 : 400,
                  }}
                />
              </ListItemButton>
            ))}

            <ListSubheader sx={{ lineHeight: '32px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', color: 'text.secondary', bgcolor: 'background.default', mt: 1 }}>
              CONFIGURATION
            </ListSubheader>
            {[
              { key: 'pdm', icon: <PDMIcon fontSize="small" />, label: 'PDM Integration' },
              { key: 'badges', icon: <LabelIcon fontSize="small" />, label: 'Project Badges' },
              { key: 'classifier', icon: <CategoryIcon fontSize="small" />, label: 'Part Classifier' },
              { key: 'partTypes', icon: <PaletteIcon fontSize="small" />, label: 'Part Types' },
              { key: 'poSettings', icon: <AssignmentIcon fontSize="small" />, label: 'PO Settings' },
              { key: 'stockwise', icon: <WarehouseIcon fontSize="small" />, label: 'StockWise API' },
            ].map(item => (
              <ListItemButton
                key={item.key}
                selected={activeTab === item.key}
                onClick={() => setActiveTab(item.key)}
                sx={{ py: 0.5, pl: 2, minHeight: 36 }}
              >
                <ListItemIcon sx={{ minWidth: 32, color: activeTab === item.key ? 'primary.main' : 'text.secondary' }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    variant: 'body2',
                    fontWeight: activeTab === item.key ? 600 : 400,
                  }}
                />
              </ListItemButton>
            ))}

            <ListSubheader sx={{ lineHeight: '32px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', color: 'text.secondary', bgcolor: 'background.default', mt: 1 }}>
              MAINTENANCE
            </ListSubheader>
            <ListItemButton
              selected={activeTab === 'unusedParts'}
              onClick={() => setActiveTab('unusedParts')}
              sx={{ py: 0.5, pl: 2, minHeight: 36 }}
            >
              <ListItemIcon sx={{ minWidth: 32, color: activeTab === 'unusedParts' ? 'primary.main' : 'text.secondary' }}>
                <DeleteIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Unused Parts" primaryTypographyProps={{ variant: 'body2', fontWeight: activeTab === 'unusedParts' ? 600 : 400 }} />
            </ListItemButton>

            <ListSubheader sx={{ lineHeight: '32px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', color: 'text.secondary', bgcolor: 'background.default', mt: 1 }}>
              ROBOT
            </ListSubheader>
            <ListItemButton
              selected={activeTab === 'robotAssembly'}
              onClick={() => setActiveTab('robotAssembly')}
              sx={{ py: 0.5, pl: 2, minHeight: 36 }}
            >
              <ListItemIcon sx={{ minWidth: 32, color: activeTab === 'robotAssembly' ? 'primary.main' : 'text.secondary' }}>
                <RobotIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="Robot Assembly" primaryTypographyProps={{ variant: 'body2', fontWeight: activeTab === 'robotAssembly' ? 600 : 400 }} />
            </ListItemButton>
            <ListItemButton
              selected={activeTab === 'costRobot'}
              onClick={() => setActiveTab('costRobot')}
              sx={{ py: 0.5, pl: 2, minHeight: 36 }}
            >
              <ListItemIcon sx={{ minWidth: 32, color: activeTab === 'costRobot' ? 'primary.main' : 'text.secondary' }}>
                <CostRobotIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary="BOM Cost Robot" primaryTypographyProps={{ variant: 'body2', fontWeight: activeTab === 'costRobot' ? 600 : 400 }} />
            </ListItemButton>
          </List>
        </Box>

        {/* Content Area */}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, pt: 0.75, pb: 0.25 }}>
          {/* Users Tab */}
          {activeTab === 'users' && (
            <Card>
              <CardHeader
                title="User Management"
                action={
                  <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateUser}>
                    Add User
                  </Button>
                }
              />
              <CardContent>
                {loadingUsers ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                    <Typography sx={{ ml: 2 }}>Loading users...</Typography>
                  </Box>
                ) : users.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5 }}>
                    <Typography color="text.secondary">No users found</Typography>
                  </Box>
                ) : (
                  <TableContainer component={Paper}>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Username</TableCell>
                          <TableCell>Email</TableCell>
                          <TableCell>Phone</TableCell>
                          <TableCell>Role</TableCell>
                          <TableCell>Created</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {users.map((user) => (
                          <TableRow key={user.id} hover>
                            <TableCell>{user.username}</TableCell>
                            <TableCell>{user.email}</TableCell>
                            <TableCell>{user.phone || '-'}</TableCell>
                            <TableCell>
                              <Chip
                                label={user.role ? user.role.replace('_', ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : ''}
                                color={user.role === 'admin' ? 'error' : user.role === 'engineer' ? 'warning' : user.role === 'finance' ? 'secondary' : user.role === 'system' ? 'primary' : user.role === 'floor_manager' ? 'info' : 'info'}
                                size="small"
                              />
                            </TableCell>
                            <TableCell>{new Date(user.created_at).toLocaleDateString()}</TableCell>
                            <TableCell>
                              <Chip
                                label={user.is_active !== false ? 'Active' : 'Inactive'}
                                color={user.is_active !== false ? 'success' : 'default'}
                                size="small"
                              />
                            </TableCell>
                            <TableCell>
                              <IconButton size="small" color="primary" onClick={() => handleEditUser(user)}>
                                <EditIcon />
                              </IconButton>
                              <IconButton size="small" color="error" onClick={() => handleDeleteUser(user.id)}>
                                <DeleteIcon />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          )}

          {/* System Tab */}
          {activeTab === 'system' && (
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="System Information" />
                  <CardContent>
                    {loadingSystemInfo ? (
                      <CircularProgress />
                    ) : systemInfo ? (
                      <Box>
                        <Typography variant="body2" gutterBottom>
                          <strong>Application Version:</strong> 1.0.0
                        </Typography>
                        <Typography variant="body2" gutterBottom>
                          <strong>Database:</strong> SQLite
                        </Typography>
                        <Typography variant="body2" gutterBottom>
                          <strong>Database Size:</strong> {systemInfo.database_size || 'Unknown'}
                        </Typography>
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        System information not available
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={6}>
                <Card>
                  <CardHeader title="System Settings" />
                  <CardContent>
                    <FormControlLabel
                      control={<Switch defaultChecked />}
                      label="Enable Email Notifications"
                      sx={{ mb: 2, display: 'block' }}
                    />
                    <FormControlLabel
                      control={<Switch defaultChecked />}
                      label="Enable Audit Logging"
                      sx={{ mb: 2, display: 'block' }}
                    />
                    <Button variant="contained" sx={{ mt: 2 }}>
                      Save Settings
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12}>
                <Card>
                  <CardHeader title="Manual Database Cleanup" />
                  <CardContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      <strong>Manual Cleanup Only:</strong> This feature requires explicit admin action. No automatic deletion will occur.
                    </Alert>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                      <TextField
                        type="number"
                        label="Delete BOMs older than (days)"
                        value={cleanupDays}
                        onChange={(e) => setCleanupDays(parseInt(e.target.value) || 30)}
                        inputProps={{ min: 1, max: 365 }}
                        sx={{ width: 250 }}
                      />
                      <Button variant="outlined" color="warning" onClick={handleCleanupDatabase}>
                        Manual Cleanup
                      </Button>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12}>
                <Card sx={{ border: '2px solid', borderColor: 'error.main' }}>
                  <CardHeader
                    title={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="h6" color="error">
                          Clear All Database Data
                        </Typography>
                      </Box>
                    }
                  />
                  <CardContent>
                    <Alert severity="error" sx={{ mb: 2 }}>
                      <strong>⚠️ DANGER ZONE ⚠️</strong>
                      <br />
                      This will permanently delete ALL data from the database EXCEPT user accounts.
                    </Alert>
                    <Button
                      variant="contained"
                      color="error"
                      onClick={() => setShowClearConfirm(true)}
                    >
                      Clear All Database Data
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}

          {/* Logs Tab */}
          {activeTab === 'logs' && (
            <Card>
              <CardHeader
                title="System Logs"
                action={
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <FormControl size="small" sx={{ minWidth: 150 }}>
                      <InputLabel>Date Filter</InputLabel>
                      <Select
                        value={logDateFilter}
                        label="Date Filter"
                        onChange={(e) => {
                          setLogDateFilter(e.target.value)
                          loadLogs(e.target.value)
                        }}
                      >
                        <MenuItem value="">Today</MenuItem>
                        {availableLogDates.map((date) => (
                          <MenuItem key={date} value={date}>
                            {new Date(date).toLocaleDateString()}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportLogs}>
                      Export Logs
                    </Button>
                    <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => loadLogs()}>
                      Refresh
                    </Button>
                  </Box>
                }
              />
              <CardContent>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Log files are stored in: <code>Documents/MenteeBOM Data/logs/</code> and can be opened with Notepad.
                </Alert>
                {loadingLogs ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                  </Box>
                ) : (
                  <TableContainer component={Paper} sx={{ maxHeight: '70vh' }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ width: 180 }}>Timestamp</TableCell>
                          <TableCell sx={{ width: 80 }}>Level</TableCell>
                          <TableCell sx={{ width: 120 }}>User</TableCell>
                          <TableCell sx={{ width: 150 }}>Action</TableCell>
                          <TableCell>Details</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {logs.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} align="center">
                              <Typography color="text.secondary">No log entries found</Typography>
                            </TableCell>
                          </TableRow>
                        ) : (
                          logs.map((entry, idx) => {
                            // Parse log entry
                            const logMatch = entry.raw?.match(/\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)/)
                            if (logMatch) {
                              const timestamp = logMatch[1]
                              const level = logMatch[2]
                              const rest = logMatch[3]
                              const userMatch = rest.match(/\[USER:([^\]]+)\]/)
                              const actionMatch = rest.match(/\[ACTION:([^\]]+)\]/)
                              const user = userMatch ? userMatch[1] : 'unknown'
                              const action = actionMatch ? actionMatch[1] : ''
                              const details = rest.replace(/\[USER:[^\]]+\]\s+\[ROLE:[^\]]+\]\s+\[ACTION:[^\]]+\]\s*/, '')
                              const levelColor = level === 'ERROR' ? 'error' : level === 'WARNING' ? 'warning' : 'info'
                              
                              return (
                                <TableRow key={idx}>
                                  <TableCell>{timestamp}</TableCell>
                                  <TableCell>
                                    <Chip label={level} color={levelColor} size="small" />
                                  </TableCell>
                                  <TableCell>{user}</TableCell>
                                  <TableCell>
                                    <code>{action}</code>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption">{details}</Typography>
                                  </TableCell>
                                </TableRow>
                              )
                            }
                            return (
                              <TableRow key={idx}>
                                <TableCell colSpan={5}>
                                  <Typography variant="caption" color="text.secondary">
                                    {entry.raw}
                                  </Typography>
                                </TableCell>
                              </TableRow>
                            )
                          })
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          )}

          {/* Backup Tab */}
          {activeTab === 'backup' && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardHeader title="Database Backup" />
                    <CardContent>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Create a backup of the database and user data. Backups are also created automatically every day.
                      </Typography>
                      <Button
                        variant="contained"
                        startIcon={creatingBackup ? <CircularProgress size={20} /> : <DownloadIcon />}
                        onClick={handleCreateBackup}
                        disabled={creatingBackup}
                        sx={{ mt: 2 }}
                      >
                        Create Backup
                      </Button>
                      {lastBackup && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
                          Last backup: {new Date(lastBackup.timestamp).toLocaleString()} ({lastBackup.size_display})
                        </Typography>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Card>
                    <CardHeader title="Restore Backup" />
                    <CardContent>
                      <Typography variant="body2" color="text.secondary" gutterBottom>
                        Restore from a previous backup file.
                      </Typography>
                      <input
                        type="file"
                        accept=".zip"
                        onChange={(e) => setBackupFile(e.target.files[0])}
                        style={{ marginTop: 16, marginBottom: 16, display: 'block' }}
                      />
                      <Button
                        variant="outlined"
                        color="warning"
                        startIcon={restoringBackup ? <CircularProgress size={20} /> : <UploadIcon />}
                        onClick={handleRestoreBackup}
                        disabled={restoringBackup || !backupFile}
                      >
                        Restore Backup
                      </Button>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
              <Card>
                <CardHeader
                  title="Backup History"
                  action={
                    <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadLastBackup} size="small">
                      Refresh
                    </Button>
                  }
                />
                <CardContent>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Backup files are stored in: <code>Documents/MenteeBOM Data/backups/</code>. Automatic daily backups are scheduled for 2:00 AM and on server startup.
                  </Alert>
                  {backupHistory.length === 0 ? (
                    <Typography color="text.secondary" align="center" sx={{ py: 3 }}>
                      No backups found
                    </Typography>
                  ) : (
                    <TableContainer component={Paper} sx={{ maxHeight: '50vh' }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Date & Time</TableCell>
                            <TableCell>Filename</TableCell>
                            <TableCell align="right">Size</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {backupHistory.map((backup, idx) => (
                            <TableRow key={idx} sx={idx === 0 ? { bgcolor: 'action.hover' } : {}}>
                              <TableCell>{new Date(backup.timestamp).toLocaleString()}</TableCell>
                              <TableCell>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                  {backup.filename}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">{backup.size_display}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            </Box>
          )}

          {/* PDM Integration Tab */}
          {activeTab === 'pdm' && (
            <Grid container spacing={2}>
              <Grid item xs={12} md={8}>
                <Card>
                  <CardHeader title="PDM Integration Settings" />
                  <CardContent>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={pdmConfig.enabled}
                          onChange={(e) => setPdmConfig({ ...pdmConfig, enabled: e.target.checked })}
                        />
                      }
                      label="Enable PDM Integration"
                      sx={{ mb: 2, display: 'block' }}
                    />
                    <TextField
                      fullWidth
                      label="PdmBomExporter Path"
                      value={pdmConfig.exporter_path}
                      onChange={(e) => setPdmConfig({ ...pdmConfig, exporter_path: e.target.value })}
                      placeholder="C:\Users\...\PdmBomExporter\bin\Debug\PdmBomExporter.exe"
                      helperText="Path to your PdmBomExporter.exe executable"
                      sx={{ mb: 2 }}
                    />
                    <TextField
                      fullWidth
                      label="PDM Vault Name"
                      value={pdmConfig.vault_name}
                      onChange={(e) => setPdmConfig({ ...pdmConfig, vault_name: e.target.value })}
                      helperText="Name of your PDM vault (usually 'pdm')"
                      sx={{ mb: 2 }}
                    />
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <FormControl fullWidth>
                          <InputLabel>Default BOM Layout</InputLabel>
                          <Select
                            value={pdmConfig.default_bom_layout}
                            label="Default BOM Layout"
                            onChange={(e) => setPdmConfig({ ...pdmConfig, default_bom_layout: e.target.value })}
                          >
                            <MenuItem value="MenteeBOM">MenteeBOM</MenuItem>
                            <MenuItem value="Default">Default</MenuItem>
                            <MenuItem value="Parts Only">Parts Only</MenuItem>
                            <MenuItem value="Indented">Indented</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          fullWidth
                          label="Default Configuration"
                          value={pdmConfig.default_configuration}
                          onChange={(e) => setPdmConfig({ ...pdmConfig, default_configuration: e.target.value })}
                        />
                      </Grid>
                    </Grid>
                    <Button
                      variant="contained"
                      startIcon={savingPDMConfig ? <CircularProgress size={20} /> : <SaveIcon />}
                      onClick={handleSavePDMConfig}
                      disabled={savingPDMConfig}
                      sx={{ mt: 2 }}
                    >
                      Save Configuration
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={12} md={4}>
                <Card>
                  <CardHeader title="PDM Status" />
                  <CardContent>
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="body2">Integration Status</Typography>
                        <Chip
                          label={pdmConfig.enabled ? 'Enabled' : 'Disabled'}
                          color={pdmConfig.enabled ? 'success' : 'default'}
                          size="small"
                        />
                      </Box>
                    </Box>
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="body2">Executable Status</Typography>
                        <Chip
                          label={pdmConfig.exporter_valid ? 'Valid' : 'Invalid'}
                          color={pdmConfig.exporter_valid ? 'success' : 'error'}
                          size="small"
                        />
                      </Box>
                    </Box>
                    <Button
                      variant="outlined"
                      fullWidth
                      onClick={handleTestPDMConnection}
                      sx={{ mt: 2 }}
                    >
                      Test Connection
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}

          {/* Project Badges Tab */}
          {activeTab === 'badges' && (
            <Card>
              <CardHeader
                title="Project Badges"
                action={
                  <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateBadge}>
                    Add Badge
                  </Button>
                }
              />
              <CardContent>
                {loadingBadges ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                  </Box>
                ) : badges.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5 }}>
                    <Typography color="text.secondary">No badges found</Typography>
                  </Box>
                ) : (
                  <TableContainer component={Paper}>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Color</TableCell>
                          <TableCell>Created</TableCell>
                          <TableCell>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {badges.map((badge) => (
                          <TableRow key={badge.id} hover>
                            <TableCell>
                              <Chip
                                label={badge.name}
                                sx={{
                                  backgroundColor: badge.color,
                                  color: '#fff',
                                  fontWeight: 'bold',
                                }}
                              />
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Box
                                  sx={{
                                    width: 40,
                                    height: 40,
                                    backgroundColor: badge.color,
                                    borderRadius: 1,
                                    border: '1px solid #ccc',
                                  }}
                                />
                                <Typography variant="body2">{badge.color}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell>{new Date(badge.created_at).toLocaleDateString()}</TableCell>
                            <TableCell>
                              <IconButton size="small" color="primary" onClick={() => handleEditBadge(badge)}>
                                <EditIcon />
                              </IconButton>
                              <IconButton size="small" color="error" onClick={() => handleDeleteBadge(badge.id)}>
                                <DeleteIcon />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          )}

          {/* Part Classifier Tab */}
          {activeTab === 'classifier' && (
            <Card>
              <CardHeader
                title="Part Classification Rules"
                action={
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button 
                      variant="outlined" 
                      startIcon={<RefreshIcon />} 
                      onClick={handleReclassifyAllParts}
                      disabled={reclassifying}
                    >
                      {reclassifying ? 'Reclassifying...' : 'Reclassify All Parts'}
                    </Button>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateRule}>
                      Add Rule
                    </Button>
                  </Box>
                }
              />
              <CardContent>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Classification rules determine how parts are automatically categorized. Rules are checked in order, and the first matching rule is used. Use "Reclassify All Parts" to update existing BOMs with new rules.
                </Alert>
                {loadingRules ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                  </Box>
                ) : classificationRules.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5 }}>
                    <Typography color="text.secondary">No classification rules found</Typography>
                  </Box>
                ) : (
                  <Box>
                    {Object.keys(groupedRules).sort().map((partType) => (
                      <Box key={partType} sx={{ mb: 3 }}>
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', mb: 1 }}>
                          {partType}
                        </Typography>
                        <TableContainer component={Paper}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell width="80">Priority</TableCell>
                                <TableCell>Keyword</TableCell>
                                <TableCell>Method</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell width="200">Actions</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {groupedRules[partType]
                                .sort((a, b) => (a.priority || 100) - (b.priority || 100))
                                .map((rule, index, arr) => (
                                <TableRow key={rule.id} hover>
                                  <TableCell>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <IconButton
                                        size="small"
                                        onClick={() => handleMoveRulePriority(rule.id, 'up')}
                                        disabled={index === 0}
                                        sx={{ p: 0.5 }}
                                      >
                                        <ArrowUpwardIcon fontSize="small" />
                                      </IconButton>
                                      <Typography variant="body2" sx={{ minWidth: 30, textAlign: 'center' }}>
                                        {rule.priority || 100}
                                      </Typography>
                                      <IconButton
                                        size="small"
                                        onClick={() => handleMoveRulePriority(rule.id, 'down')}
                                        disabled={index === arr.length - 1}
                                        sx={{ p: 0.5 }}
                                      >
                                        <ArrowDownwardIcon fontSize="small" />
                                      </IconButton>
                                    </Box>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                      {rule.keyword}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Chip 
                                      label={rule.classification_method} 
                                      size="small" 
                                      color={rule.classification_method === '3d_printing' ? 'warning' : 'default'}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Chip
                                      label={rule.is_active ? 'Active' : 'Inactive'}
                                      color={rule.is_active ? 'success' : 'default'}
                                      size="small"
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <IconButton size="small" color="info" onClick={() => handleTestRule(rule.id)} title="Test Rule">
                                      <RefreshIcon />
                                    </IconButton>
                                    <IconButton size="small" color="primary" onClick={() => handleEditRule(rule)}>
                                      <EditIcon />
                                    </IconButton>
                                    <IconButton size="small" color="error" onClick={() => handleDeleteRule(rule.id)}>
                                      <DeleteIcon />
                                    </IconButton>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </Box>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          )}

          {/* Part Types Tab */}
          {activeTab === 'partTypes' && (
            <Card>
              <CardHeader
                title="Part Types Management"
                action={
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant="outlined"
                      startIcon={<RefreshIcon />}
                      onClick={handleMigratePartTypes}
                      disabled={migratingPartTypes}
                    >
                      {migratingPartTypes ? 'Migrating...' : 'Migrate from Parts'}
                    </Button>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreatePartType}>
                      Add Part Type
                    </Button>
                  </Box>
                }
              />
              <CardContent>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Manage the list of part types used throughout the system. Renaming a type will automatically update all parts and classification rules. Deleting a type will reassign all parts to "Unknown".
                </Alert>
                {loadingPartTypes ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                  </Box>
                ) : partTypes.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5 }}>
                    <Typography color="text.secondary">No part types found</Typography>
                    <Button
                      variant="outlined"
                      startIcon={<RefreshIcon />}
                      onClick={handleMigratePartTypes}
                      disabled={migratingPartTypes}
                      sx={{ mt: 2 }}
                    >
                      Migrate from Existing Parts
                    </Button>
                  </Box>
                ) : (
                  <TableContainer component={Paper}>
                    <Table>
                      <TableHead>
                          <TableRow>
                            <TableCell>Part Type Name</TableCell>
                            <TableCell>Color</TableCell>
                            <TableCell>Parts Using This Type</TableCell>
                            <TableCell>Created</TableCell>
                            <TableCell>Actions</TableCell>
                          </TableRow>
                      </TableHead>
                      <TableBody>
                        {partTypes.map((partType) => (
                          <TableRow key={partType.id} hover>
                            <TableCell>
                              <Typography variant="body1" sx={{ fontWeight: partType.name === 'Unknown' ? 'bold' : 'normal' }}>
                                {partType.name}
                                {partType.name === 'Unknown' && (
                                  <Chip label="System" size="small" color="default" sx={{ ml: 1 }} />
                                )}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Box
                                  sx={{
                                    width: 30,
                                    height: 30,
                                    backgroundColor: partType.color || '#6c757d',
                                    borderRadius: 1,
                                    border: '1px solid #ccc',
                                  }}
                                />
                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                  {partType.color || '#6c757d'}
                                </Typography>
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={partType.part_count || 0}
                                size="small"
                                color={partType.part_count > 0 ? 'primary' : 'default'}
                              />
                            </TableCell>
                            <TableCell>
                              {partType.created_at
                                ? new Date(partType.created_at).toLocaleDateString()
                                : '-'}
                            </TableCell>
                            <TableCell>
                              {partType.name !== 'Unknown' && (
                                <>
                                  <IconButton size="small" color="primary" onClick={() => handleEditPartType(partType)}>
                                    <EditIcon />
                                  </IconButton>
                                  <IconButton size="small" color="error" onClick={() => handleDeletePartType(partType.id)}>
                                    <DeleteIcon />
                                  </IconButton>
                                </>
                              )}
                              {partType.name === 'Unknown' && (
                                <Typography variant="caption" color="text.secondary">
                                  Cannot modify
                                </Typography>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          )}

          {/* Unused Parts Tab */}
          {activeTab === 'unusedParts' && (
            <Card>
              <CardHeader
                title="Unused Parts"
                action={
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant="outlined"
                      startIcon={<RefreshIcon />}
                      onClick={loadUnusedParts}
                      disabled={loadingUnusedParts}
                    >
                      Refresh
                    </Button>
                    <Button
                      variant="outlined"
                      color="warning"
                      startIcon={<DeleteIcon />}
                      onClick={handleDeleteSelectedParts}
                      disabled={selectedPartIds.length === 0 || deletingParts}
                    >
                      Delete Selected ({selectedPartIds.length})
                    </Button>
                    <Button
                      variant="contained"
                      color="error"
                      startIcon={<DeleteIcon />}
                      onClick={handleDeleteAllParts}
                      disabled={unusedParts.length === 0 || deletingParts}
                    >
                      Delete All Unused
                    </Button>
                  </Box>
                }
              />
              <CardContent>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Parts that are not referenced in any BOM assembly. These parts can be safely deleted to clean up the database.
                </Alert>
                {loadingUnusedParts ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                    <Typography sx={{ ml: 2 }}>Loading unused parts...</Typography>
                  </Box>
                ) : unusedParts.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5 }}>
                    <Typography color="text.secondary">No unused parts found</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      All parts in the database are currently used in at least one BOM.
                    </Typography>
                  </Box>
                ) : (
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Total unused parts: {unusedParts.length}
                    </Typography>
                    <TableContainer component={Paper}>
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={unusedParts.length > 0 && selectedPartIds.length === unusedParts.length}
                                indeterminate={selectedPartIds.length > 0 && selectedPartIds.length < unusedParts.length}
                                onChange={handleSelectAllParts}
                              />
                            </TableCell>
                            <TableCell>Part Number</TableCell>
                            <TableCell>Revision</TableCell>
                            <TableCell>Part Name</TableCell>
                            <TableCell>Part Type</TableCell>
                            <TableCell>State</TableCell>
                            <TableCell>Created</TableCell>
                            <TableCell>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {unusedParts.map((part) => (
                            <TableRow key={part.id} hover>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  checked={selectedPartIds.includes(part.id)}
                                  onChange={() => handleSelectPart(part.id)}
                                />
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                  {part.part_number}
                                </Typography>
                              </TableCell>
                              <TableCell>{part.revision}</TableCell>
                              <TableCell>{part.part_name || '-'}</TableCell>
                              <TableCell>
                                {part.part_type ? (
                                  <Chip label={part.part_type} size="small" />
                                ) : (
                                  '-'
                                )}
                              </TableCell>
                              <TableCell>{part.state || '-'}</TableCell>
                              <TableCell>
                                {part.created_at
                                  ? new Date(part.created_at).toLocaleDateString()
                                  : '-'}
                              </TableCell>
                              <TableCell>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => handleDeleteSinglePart(part.id)}
                                  disabled={deletingParts}
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}
              </CardContent>
            </Card>
          )}

          {/* Robot Assembly Tab */}
          {activeTab === 'robotAssembly' && (
            <RobotAssemblyAdmin />
          )}

          {/* BOM Cost Robot Tab */}
          {activeTab === 'costRobot' && (
            <CostRobotAdmin />
          )}

          {/* StockWise API Tab */}
          {activeTab === 'stockwise' && (
            <StockWiseAdmin />
          )}

          {/* PO Settings Tab */}
          {activeTab === 'poSettings' && (
            <Card>
              <CardHeader
                title="PO Approval Persons"
                subheader="Manage approval persons that appear in PO document generation"
                action={
                  <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreateApprover}>
                    Add Approver
                  </Button>
                }
              />
              <CardContent>
                {loadingApprovers ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                    <CircularProgress />
                    <Typography sx={{ ml: 2 }}>Loading approvers...</Typography>
                  </Box>
                ) : poApprovers.length === 0 ? (
                  <Box sx={{ textAlign: 'center', py: 5 }}>
                    <Typography color="text.secondary">No approval persons defined yet</Typography>
                  </Box>
                ) : (
                  <TableContainer component={Paper}>
                    <Table>
                      <TableHead>
                        <TableRow>
                          <TableCell>Name</TableCell>
                          <TableCell>Title</TableCell>
                          <TableCell>Email</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {poApprovers.map((approver) => (
                          <TableRow key={approver.id} hover>
                            <TableCell>{approver.name}</TableCell>
                            <TableCell>{approver.title}</TableCell>
                            <TableCell>{approver.email || '-'}</TableCell>
                            <TableCell>
                              <Chip
                                label={approver.is_active ? 'Active' : 'Inactive'}
                                color={approver.is_active ? 'success' : 'default'}
                                size="small"
                                onClick={() => handleToggleApproverActive(approver)}
                                sx={{ cursor: 'pointer' }}
                              />
                            </TableCell>
                            <TableCell>
                              <IconButton size="small" color="primary" onClick={() => handleEditApprover(approver)}>
                                <EditIcon />
                              </IconButton>
                              <IconButton size="small" color="error" onClick={() => handleDeleteApprover(approver.id)}>
                                <DeleteIcon />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>
          )}
        </Box>
      </Box>

      {/* User Modal */}
      <ResizableDialog id="userModal" open={showUserModal} onClose={() => setShowUserModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Username"
            value={userForm.username}
            onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={userForm.email}
            onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Phone"
            value={userForm.phone}
            onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
            margin="normal"
          />
          <TextField
            fullWidth
            label={editingUser ? 'New Password (leave blank to keep current)' : 'Password'}
            type="password"
            value={userForm.password}
            onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
            margin="normal"
            required={!editingUser}
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Role</InputLabel>
            <Select
              value={userForm.role}
              label="Role"
              onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
            >
              <MenuItem value="floor">Floor</MenuItem>
              <MenuItem value="floor_manager">Floor Manager</MenuItem>
              <MenuItem value="engineer">Engineer</MenuItem>
              <MenuItem value="finance">Finance</MenuItem>
              <MenuItem value="system">System</MenuItem>
              <MenuItem value="viewer">Viewer (read-only)</MenuItem>
              <MenuItem value="admin">Admin</MenuItem>
            </Select>
          </FormControl>
          <Alert severity="info" sx={{ mt: 2 }}>
            <strong>Floor:</strong> Can view BOMs, Parts, Purchases (receive PO and split orders only), and Robot Assembly
            <br />
            <strong>Floor Manager:</strong> Can view Dashboard, Assembly Tree, edit Assembly BOM table, create Standard Parts RFQ, export PO, and receive parts
            <br />
            <strong>Engineer:</strong> Can import, export, create RFQ/PO
            <br />
            <strong>Finance:</strong> Can access Purchases tab and BOM Cost tab with all options
            <br />
            <strong>System:</strong> Same as Finance plus Robot Assembly access
            <br />
            <strong>Admin:</strong> Full access including user management
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowUserModal(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveUser}>
            {editingUser ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Badge Modal */}
      <ResizableDialog id="badgeModal" open={showBadgeModal} onClose={() => setShowBadgeModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LabelIcon />
            {editingBadge ? 'Edit Badge' : 'Add New Badge'}
          </Box>
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Badge Name"
            value={badgeForm.name}
            onChange={(e) => setBadgeForm({ ...badgeForm, name: e.target.value })}
            margin="normal"
            placeholder="e.g., V3.1"
            required
          />
          <Box sx={{ mt: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Badge Color
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TextField
                type="color"
                value={badgeForm.color}
                onChange={(e) => setBadgeForm({ ...badgeForm, color: e.target.value })}
                sx={{ width: 100 }}
              />
              <TextField
                fullWidth
                label="Color (Hex)"
                value={badgeForm.color}
                onChange={(e) => setBadgeForm({ ...badgeForm, color: e.target.value })}
                placeholder="#1976d2"
              />
            </Box>
            <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">Preview:</Typography>
              <Chip
                label={badgeForm.name || 'Badge Name'}
                sx={{
                  backgroundColor: badgeForm.color,
                  color: '#fff',
                  fontWeight: 'bold',
                }}
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowBadgeModal(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveBadge} disabled={!badgeForm.name.trim()}>
            {editingBadge ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Clear Database Confirmation Modal */}
      <ResizableDialog open={showClearConfirm} onClose={() => setShowClearConfirm(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ bgcolor: 'error.main', color: 'white' }}>
          ⚠️ DANGER: Clear All Database Data
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            <strong>This action will PERMANENTLY DELETE ALL DATA from the following tables:</strong>
            <List dense>
              <ListItem>BOMData, BOMInstance, BOMItem, BOMPart</ListItem>
              <ListItem>Part</ListItem>
              <ListItem>RFQ, RFQItem</ListItem>
              <ListItem>PO, POItem</ListItem>
              <ListItem>BOMVersion, BOMChange</ListItem>
              <ListItem>CustomBOMColumn, BOMItemCustomData</ListItem>
            </List>
            <strong className="mt-2 d-block">User accounts will be preserved.</strong>
          </Alert>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            <strong>This action:</strong>
            <ul>
              <li>Is PERMANENT and CANNOT be undone</li>
              <li>Requires typing "DELETE ALL" to confirm</li>
              <li>Will remove all BOMs, Parts, RFQs, POs, and related data</li>
              <li>Preserves user accounts for login</li>
            </ul>
          </Typography>
          <TextField
            fullWidth
            label='Type "DELETE ALL" to confirm'
            value={clearConfirmText}
            onChange={(e) => setClearConfirmText(e.target.value)}
            margin="normal"
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowClearConfirm(false)
            setClearConfirmText('')
          }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleClearDatabase}
            disabled={clearConfirmText !== 'DELETE ALL'}
          >
            Clear Database
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Classification Rule Modal */}
      <ResizableDialog open={showRuleModal} onClose={() => setShowRuleModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CategoryIcon />
            {editingRule ? 'Edit Classification Rule' : 'Add New Classification Rule'}
          </Box>
        </DialogTitle>
        <DialogContent>
          <FormControl fullWidth margin="normal" required>
            <InputLabel>Part Type</InputLabel>
            <Select
              value={ruleForm.part_type}
              label="Part Type"
              onChange={(e) => setRuleForm({ ...ruleForm, part_type: e.target.value })}
            >
              {availablePartTypesForRules.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              Select from managed part types. Create new types in Part Types tab.
            </Typography>
          </FormControl>
          <TextField
            fullWidth
            label="Keyword/Pattern"
            value={ruleForm.keyword}
            onChange={(e) => setRuleForm({ ...ruleForm, keyword: e.target.value })}
            margin="normal"
            placeholder="e.g., SKF, -MP-, 3D"
            required
            helperText="The keyword or pattern to match in part numbers, state, or description"
          />
          <FormControl fullWidth margin="normal">
            <InputLabel>Classification Method</InputLabel>
            <Select
              value={ruleForm.classification_method}
              label="Classification Method"
              onChange={(e) => setRuleForm({ ...ruleForm, classification_method: e.target.value })}
            >
              <MenuItem value="keyword">Keyword (matches in part number)</MenuItem>
              <MenuItem value="pattern">Pattern (matches pattern in part number)</MenuItem>
              <MenuItem value="3d_printing">3D Printing (matches in state/description)</MenuItem>
            </Select>
          </FormControl>
          <TextField
            fullWidth
            type="number"
            label="Priority"
            value={ruleForm.priority}
            onChange={(e) => setRuleForm({ ...ruleForm, priority: parseInt(e.target.value) || 100 })}
            margin="normal"
            helperText="Lower number = higher priority. Rules are evaluated in priority order."
            inputProps={{ min: 0 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={ruleForm.is_active}
                onChange={(e) => setRuleForm({ ...ruleForm, is_active: e.target.checked })}
              />
            }
            label="Active"
            sx={{ mt: 2 }}
          />
          {ruleTestResults && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <Typography variant="subtitle2">Test Results:</Typography>
              <Typography variant="body2">
                Found {ruleTestResults.total_matches} matching part(s). Showing {ruleTestResults.matches?.length || 0} sample(s).
              </Typography>
              {ruleTestResults.matches && ruleTestResults.matches.length > 0 && (
                <Box sx={{ mt: 1, maxHeight: '25vh', overflow: 'auto' }}>
                  {ruleTestResults.matches.map((match, idx) => (
                    <Typography key={idx} variant="caption" display="block">
                      • {match.part_number} ({match.current_type || 'Unknown'})
                    </Typography>
                  ))}
                </Box>
              )}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowRuleModal(false)
            setRuleTestResults(null)
          }}>Cancel</Button>
          {editingRule && (
            <Button
              variant="outlined"
              onClick={() => handleTestRule(editingRule.id)}
              disabled={testingRule === editingRule.id || !ruleForm.keyword.trim()}
            >
              {testingRule === editingRule.id ? 'Testing...' : 'Test Rule'}
            </Button>
          )}
          <Button
            variant="contained"
            onClick={handleSaveRule}
            disabled={!ruleForm.part_type.trim() || !ruleForm.keyword.trim()}
          >
            {editingRule ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Part Type Modal */}
      <ResizableDialog id="partTypeModal" open={showPartTypeModal} onClose={() => setShowPartTypeModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingPartType ? 'Edit Part Type' : 'Add New Part Type'}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {editingPartType
              ? `Renaming "${editingPartType.name}" will update all parts and classification rules using this type. This action cannot be undone.`
              : 'Part types are used throughout the system for classification and filtering.'}
          </Alert>
          <TextField
            fullWidth
            label="Part Type Name"
            value={partTypeForm.name}
            onChange={(e) => setPartTypeForm({ ...partTypeForm, name: e.target.value })}
            margin="normal"
            placeholder="e.g., Bearings, Fasteners, Assembly"
            required
            autoFocus
            disabled={editingPartType?.name === 'Unknown'}
            helperText={editingPartType?.name === 'Unknown' ? 'The "Unknown" type cannot be renamed' : 'Enter a unique part type name'}
          />
          <Box sx={{ mt: 2, mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Part Type Color
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TextField
                type="color"
                value={partTypeForm.color}
                onChange={(e) => setPartTypeForm({ ...partTypeForm, color: e.target.value })}
                sx={{ width: 100 }}
                disabled={editingPartType?.name === 'Unknown'}
              />
              <TextField
                fullWidth
                label="Color (Hex)"
                value={partTypeForm.color}
                onChange={(e) => setPartTypeForm({ ...partTypeForm, color: e.target.value })}
                placeholder="#6c757d"
                disabled={editingPartType?.name === 'Unknown'}
              />
            </Box>
            <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">Preview:</Typography>
              <Chip
                label={partTypeForm.name || 'Part Type Name'}
                sx={{
                  backgroundColor: partTypeForm.color || '#6c757d',
                  color: '#fff',
                  fontWeight: 'bold',
                }}
              />
            </Box>
          </Box>
          {editingPartType && editingPartType.part_count > 0 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              This type is currently used by {editingPartType.part_count} part(s). All will be updated when you rename it.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowPartTypeModal(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSavePartType}
            disabled={!partTypeForm.name.trim() || editingPartType?.name === 'Unknown'}
          >
            {editingPartType ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* Delete Unused Parts Confirmation Modal */}
      <ResizableDialog open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ bgcolor: 'error.main', color: 'white' }}>
          ⚠️ Confirm Deletion
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            <strong>You are about to delete {selectedPartIds.length} unused part(s).</strong>
            <br />
            This action cannot be undone. The parts will be permanently removed from the database.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            Only parts that are confirmed to be unused in all BOMs will be deleted. 
            If any part is now in use, the deletion will be cancelled.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowDeleteConfirm(false)} disabled={deletingParts}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmDeleteParts}
            disabled={deletingParts}
            startIcon={deletingParts ? <CircularProgress size={20} /> : <DeleteIcon />}
          >
            {deletingParts ? 'Deleting...' : 'Delete Parts'}
          </Button>
        </DialogActions>
      </ResizableDialog>

      {/* PO Approver Modal */}
      <ResizableDialog id="approverModal" open={showApproverModal} onClose={() => setShowApproverModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingApprover ? 'Edit Approver' : 'Add New Approver'}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Name"
            value={approverForm.name}
            onChange={(e) => setApproverForm({ ...approverForm, name: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Title"
            value={approverForm.title}
            onChange={(e) => setApproverForm({ ...approverForm, title: e.target.value })}
            margin="normal"
            required
          />
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={approverForm.email}
            onChange={(e) => setApproverForm({ ...approverForm, email: e.target.value })}
            margin="normal"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowApproverModal(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveApprover}>
            {editingApprover ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </ResizableDialog>
    </Box>
  )
}

export default Admin
