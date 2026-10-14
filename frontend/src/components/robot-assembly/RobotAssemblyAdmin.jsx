import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box,
  Typography,
  Button,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Chip,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Grid,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Checkbox,
  Tooltip,
  Avatar,
  Collapse,
  InputAdornment,
} from '@mui/material'
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  Link as LinkIcon,
  VpnKey as KeyIcon,
  Undo as UndoIcon,
  ClearAll as ClearAllIcon,
  Search as SearchIcon,
  AccountTree as TreeIcon,
  WarningAmber as WarningIcon,
  Code as CodeIcon,
  ContentCopy as CopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  Extension as ExtensionIcon,
} from '@mui/icons-material'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import { adminService } from '../../services/adminService'
import { getThumbSrc } from '../../utils/thumbnail'

const RobotAssemblyAdmin = () => {
  const { showNotification } = useNotification()

  // MenteeFlow Config
  const [mfConfig, setMfConfig] = useState(null)
  const [mfForm, setMfForm] = useState({
    base_url: '',
    api_key: '',
    webhook_secret: '',
    is_active: true,
    badge_digit_mapping: {},
    displayed_badge_ids: [],
    embed_url_template: '',
  })
  const [loadingMF, setLoadingMF] = useState(true)
  const [savingMF, setSavingMF] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showWebhookSecret, setShowWebhookSecret] = useState(false)

  // API Key History
  const [apiKeys, setApiKeys] = useState([])
  const [loadingApiKeys, setLoadingApiKeys] = useState(false)
  const [saveKeyLabel, setSaveKeyLabel] = useState('')
  const [showSaveKeyDialog, setShowSaveKeyDialog] = useState(false)

  // Embed Tokens
  const [embedTokens, setEmbedTokens] = useState([])
  const [loadingTokens, setLoadingTokens] = useState(false)
  const [revokingAll, setRevokingAll] = useState(false)

  // DOF process templates (read-only stage preview, one per DOF)
  const [templateBadgeId, setTemplateBadgeId] = useState('')
  const [dofTemplates, setDofTemplates] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // Robot Configs
  const [robotConfigs, setRobotConfigs] = useState([])
  const [badges, setBadges] = useState([])
  const [loadingConfigs, setLoadingConfigs] = useState(true)
  const [selectedConfigId, setSelectedConfigId] = useState(null)

  // Limbs for selected config
  const [limbs, setLimbs] = useState([])
  const [loadingLimbs, setLoadingLimbs] = useState(false)
  const [newLimbName, setNewLimbName] = useState('')
  const [newLimbAssembly, setNewLimbAssembly] = useState('')
  const [limbStaleness, setLimbStaleness] = useState({}) // { [limbId]: { is_stale, dissolved_count } }

  // DOF mappings for selected limb
  const [selectedLimbId, setSelectedLimbId] = useState(null)
  const [dofMappings, setDofMappings] = useState([])
  const [loadingDOFs, setLoadingDOFs] = useState(false)
  const [dofForm, setDofForm] = useState({ dof_number: '', dof_name: '', assembly_description: '' })

  // BOM search for limb assembly linking
  const [bomSearchQuery, setBomSearchQuery] = useState('')
  const [bomSearchResults, setBomSearchResults] = useState([])
  const [searchingBOMs, setSearchingBOMs] = useState(false)

  // Assembly tree from limb's BOM (for DOF selection)
  const [assemblyTree, setAssemblyTree] = useState([])
  const [loadingChildren, setLoadingChildren] = useState(false)
  const [childBomName, setChildBomName] = useState('')

  // External DOFs
  const [externalDOFs, setExternalDOFs] = useState([])
  const [loadingExternalDOFs, setLoadingExternalDOFs] = useState(false)

  // Assembly Drawing Defaults
  const [drawingDefaults, setDrawingDefaults] = useState({})
  const [loadingDrawings, setLoadingDrawings] = useState(false)
  const [drawingForm, setDrawingForm] = useState({
    assembly_type: 'gear',
    match_key: '',
    drawing_part_number: '',
  })
  const [editingDrawingId, setEditingDrawingId] = useState(null)
  const [editDrawingForm, setEditDrawingForm] = useState({})

  // Polygon region editor
  const [polygonPoints, setPolygonPoints] = useState([])
  const [editingRegion, setEditingRegion] = useState(false)
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0 })
  const regionImageRef = useRef(null)

  // Keep display size in sync on resize
  useEffect(() => {
    const img = regionImageRef.current
    if (!img) return
    const observer = new ResizeObserver(() => {
      setImageDisplaySize({ width: img.clientWidth, height: img.clientHeight })
    })
    observer.observe(img)
    return () => observer.disconnect()
  }, [selectedConfigId, selectedLimbId])

  // Load initial data
  useEffect(() => {
    loadMenteeFlowConfig()
    loadRobotConfigs()
    loadBadges()
    loadEmbedTokens()
    loadApiKeyHistory()
    loadDrawingDefaults()
    loadExternalDOFs()
  }, [])

  const loadMenteeFlowConfig = async () => {
    setLoadingMF(true)
    try {
      const response = await robotAssemblyService.getMenteeFlowConfig()
      if (response.data.success && response.data.config) {
        setMfConfig(response.data.config)
        setMfForm({
          base_url: response.data.config.base_url || '',
          api_key: response.data.config.api_key || '',
          webhook_secret: response.data.config.webhook_secret || '',
          is_active: response.data.config.is_active ?? true,
          badge_digit_mapping: response.data.config.badge_digit_mapping || {},
          displayed_badge_ids: response.data.config.displayed_badge_ids || [],
          embed_url_template: response.data.config.embed_url_template || '',
        })
      }
    } catch (error) {
      console.error('Failed to load MenteeFlow config:', error)
    } finally {
      setLoadingMF(false)
    }
  }

  const loadRobotConfigs = async () => {
    setLoadingConfigs(true)
    try {
      const response = await robotAssemblyService.getAdminConfigs()
      if (response.data.success) {
        setRobotConfigs(response.data.configs)
      }
    } catch (error) {
      console.error('Failed to load robot configs:', error)
    } finally {
      setLoadingConfigs(false)
    }
  }

  const loadBadges = async () => {
    try {
      const response = await adminService.getBadges()
      setBadges(response.data)
    } catch (error) {
      console.error('Failed to load badges:', error)
    }
  }

  const loadLimbs = async (configId) => {
    setLoadingLimbs(true)
    try {
      const [limbsResp, staleResp] = await Promise.all([
        robotAssemblyService.getLimbs(configId),
        robotAssemblyService.getAdminLimbStaleness(configId).catch(() => null),
      ])
      if (limbsResp.data.success) {
        setLimbs(limbsResp.data.limbs)
      }
      if (staleResp?.data?.success) {
        const staleMap = {}
        staleResp.data.limbs.forEach(l => { staleMap[l.limb_id] = l })
        setLimbStaleness(staleMap)
      }
    } catch (error) {
      showNotification('Failed to load limbs', 'error')
    } finally {
      setLoadingLimbs(false)
    }
  }

  const loadDOFMappings = async (limbId) => {
    setLoadingDOFs(true)
    try {
      const response = await robotAssemblyService.getDOFMappings(limbId)
      if (response.data.success) {
        setDofMappings(response.data.dof_mappings)
      }
    } catch (error) {
      showNotification('Failed to load DOF mappings', 'error')
    } finally {
      setLoadingDOFs(false)
    }
  }

  const loadExternalDOFs = async () => {
    setLoadingExternalDOFs(true)
    try {
      const response = await robotAssemblyService.getExternalDOFs()
      if (response.data.success) {
        setExternalDOFs(response.data.external_dofs)
      }
    } catch (error) {
      console.error('Failed to load external DOFs:', error)
    } finally {
      setLoadingExternalDOFs(false)
    }
  }

  const loadChildAssemblies = async (limbId) => {
    setLoadingChildren(true)
    try {
      const response = await robotAssemblyService.getLimbChildAssemblies(limbId)
      if (response.data.success) {
        setAssemblyTree(response.data.tree || [])
        setChildBomName(response.data.bom_name || '')
      }
    } catch (error) {
      console.error('Failed to load assembly tree:', error)
      setAssemblyTree([])
    } finally {
      setLoadingChildren(false)
    }
  }

  // MenteeFlow Config handlers
  const handleSaveMFConfig = async () => {
    setSavingMF(true)
    try {
      await robotAssemblyService.saveMenteeFlowConfig(mfForm)
      showNotification('MenteeFlow configuration saved', 'success')
      loadMenteeFlowConfig()
    } catch (error) {
      showNotification('Failed to save MenteeFlow config', 'error')
    } finally {
      setSavingMF(false)
    }
  }

  // API Key History handlers
  const loadApiKeyHistory = async () => {
    setLoadingApiKeys(true)
    try {
      const response = await robotAssemblyService.getApiKeyHistory()
      if (response.data.success) {
        setApiKeys(response.data.keys)
      }
    } catch (error) {
      console.error('Failed to load API key history:', error)
    } finally {
      setLoadingApiKeys(false)
    }
  }

  // ---- Assembly Drawing Defaults ----
  const loadDrawingDefaults = async () => {
    setLoadingDrawings(true)
    try {
      const response = await robotAssemblyService.getDrawingDefaults()
      if (response.data.success) {
        setDrawingDefaults(response.data.drawing_defaults || {})
      }
    } catch (error) {
      console.error('Failed to load drawing defaults:', error)
    } finally {
      setLoadingDrawings(false)
    }
  }

  const handleCreateDrawingDefault = async (assemblyType) => {
    const form = { ...drawingForm, assembly_type: assemblyType }
    if (!form.match_key.trim()) {
      showNotification('Match key is required', 'warning')
      return
    }
    if (!form.drawing_part_number.trim()) {
      showNotification('Drawing part number is required', 'warning')
      return
    }
    try {
      const response = await robotAssemblyService.createDrawingDefault(form)
      if (response.data.success) {
        showNotification(response.data.warning || 'Drawing default created', response.data.warning ? 'warning' : 'success')
        setDrawingForm({ assembly_type: 'gear', match_key: '', drawing_part_number: '' })
        loadDrawingDefaults()
      } else {
        showNotification(response.data.error || 'Failed to create', 'error')
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to create drawing default', 'error')
    }
  }

  const handleUpdateDrawingDefault = async (id) => {
    try {
      const response = await robotAssemblyService.updateDrawingDefault(id, editDrawingForm)
      if (response.data.success) {
        showNotification('Drawing default updated', 'success')
        setEditingDrawingId(null)
        loadDrawingDefaults()
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to update', 'error')
    }
  }

  const handleDeleteDrawingDefault = async (id) => {
    try {
      const response = await robotAssemblyService.deleteDrawingDefault(id)
      if (response.data.success) {
        showNotification('Drawing default removed', 'success')
        loadDrawingDefaults()
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to delete', 'error')
    }
  }

  const handleUploadDrawingFile = async (id, file) => {
    const formData = new FormData()
    formData.append('file', file)
    try {
      const response = await robotAssemblyService.uploadDrawingFile(id, formData)
      if (response.data.success) {
        showNotification('Drawing file uploaded', 'success')
        loadDrawingDefaults()
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to upload file', 'error')
    }
  }

  const handleSaveApiKeyPair = async () => {
    if (!saveKeyLabel.trim()) {
      showNotification('Please enter a label for this key pair', 'warning')
      return
    }
    if (!mfForm.api_key && !mfForm.webhook_secret) {
      showNotification('Generate or enter API key / webhook secret first', 'warning')
      return
    }
    try {
      await robotAssemblyService.saveApiKeyPair({
        label: saveKeyLabel.trim(),
        api_key: mfForm.api_key,
        webhook_secret: mfForm.webhook_secret,
      })
      showNotification(`API key "${saveKeyLabel}" saved`, 'success')
      setSaveKeyLabel('')
      setShowSaveKeyDialog(false)
      loadApiKeyHistory()
    } catch (error) {
      showNotification('Failed to save API key pair', 'error')
    }
  }

  const handleRevokeApiKey = async (keyId) => {
    try {
      await robotAssemblyService.revokeApiKey(keyId)
      showNotification('API key revoked', 'success')
      loadApiKeyHistory()
    } catch (error) {
      showNotification('Failed to revoke API key', 'error')
    }
  }

  const handleActivateApiKey = async (keyId) => {
    try {
      await robotAssemblyService.activateApiKey(keyId)
      showNotification('API key activated and applied to config', 'success')
      loadApiKeyHistory()
      loadMenteeFlowConfig()
    } catch (error) {
      showNotification('Failed to activate API key', 'error')
    }
  }

  // Embed Token handlers
  const loadEmbedTokens = async () => {
    setLoadingTokens(true)
    try {
      const response = await robotAssemblyService.getEmbedTokens()
      if (response.data.success) {
        setEmbedTokens(response.data.tokens || [])
      }
    } catch (error) {
      console.error('Failed to load embed tokens:', error)
    } finally {
      setLoadingTokens(false)
    }
  }

  const handleRevokeToken = async (tokenId) => {
    try {
      await robotAssemblyService.revokeEmbedToken(tokenId)
      showNotification('Token revoked', 'success')
      loadEmbedTokens()
    } catch (error) {
      showNotification('Failed to revoke token', 'error')
    }
  }

  const handleRevokeAllTokens = async () => {
    setRevokingAll(true)
    try {
      const resp = await robotAssemblyService.revokeAllEmbedTokens()
      showNotification(resp.data.message || 'All tokens revoked', 'success')
      loadEmbedTokens()
    } catch (error) {
      showNotification('Failed to revoke tokens', 'error')
    } finally {
      setRevokingAll(false)
    }
  }

  const loadDofTemplates = async (badgeId) => {
    if (!badgeId) { setDofTemplates([]); return }
    setLoadingTemplates(true)
    try {
      const resp = await robotAssemblyService.getDofTemplates(badgeId)
      setDofTemplates(resp.data.templates || [])
    } catch (error) {
      showNotification('Failed to load DOF templates', 'error')
      setDofTemplates([])
    } finally {
      setLoadingTemplates(false)
    }
  }

  const handleSelectTemplateBadge = (badgeId) => {
    setTemplateBadgeId(badgeId)
    loadDofTemplates(badgeId)
  }

  // First interactive stage (2 = Picking); MenteeFlow can swap the /stage/N segment as needed
  const buildTemplateLink = (t) => `${t.embed_base_url}/stage/2?token=${t.token}`

  const handleCopyTemplateLink = (t) => {
    navigator.clipboard.writeText(buildTemplateLink(t))
    showNotification(`Copied embed link for ${t.process_number}`, 'success')
  }

  const handleBadgeDigitChange = (badgeName, digit) => {
    setMfForm(prev => ({
      ...prev,
      badge_digit_mapping: { ...prev.badge_digit_mapping, [badgeName]: digit },
    }))
  }

  const handleDisplayedBadgeToggle = (badgeId) => {
    setMfForm(prev => {
      const ids = prev.displayed_badge_ids || []
      const newIds = ids.includes(badgeId)
        ? ids.filter(id => id !== badgeId)
        : [...ids, badgeId]
      return { ...prev, displayed_badge_ids: newIds }
    })
  }

  const generateSecureKey = (length = 32) => {
    const array = new Uint8Array(length)
    crypto.getRandomValues(array)
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
  }

  // Robot Config handlers
  const handleCreateConfig = async (badgeId) => {
    try {
      const badge = badges.find(b => b.id === badgeId)
      const badgeName = badge?.name?.replace('V', '') || ''
      await robotAssemblyService.createAdminConfig({
        badge_id: badgeId,
        robot_image_path: `${badgeName}.png`,
      })
      showNotification('Robot config created', 'success')
      loadRobotConfigs()
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to create config', 'error')
    }
  }

  const handleSelectConfig = (configId) => {
    setSelectedConfigId(configId)
    setSelectedLimbId(null)
    setDofMappings([])
    setAssemblyTree([])
    setBomSearchResults([])
    loadLimbs(configId)
  }

  // Limb handlers
  const handleAddLimb = async () => {
    if (!newLimbName.trim() || !selectedConfigId) return
    try {
      await robotAssemblyService.createLimb(selectedConfigId, {
        name: newLimbName.trim(),
        assembly_part_number: newLimbAssembly.trim() || null,
      })
      setNewLimbName('')
      setNewLimbAssembly('')
      showNotification('Limb added', 'success')
      loadLimbs(selectedConfigId)
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to add limb', 'error')
    }
  }

  const handleDeleteLimb = async (limbId) => {
    try {
      await robotAssemblyService.deleteLimb(limbId)
      showNotification('Limb removed', 'success')
      if (selectedLimbId === limbId) {
        setSelectedLimbId(null)
        setDofMappings([])
        setAssemblyTree([])
      }
      loadLimbs(selectedConfigId)
    } catch (error) {
      showNotification('Failed to delete limb', 'error')
    }
  }

  const handleSelectLimb = (limbId) => {
    setSelectedLimbId(limbId)
    loadDOFMappings(limbId)

    // Load existing polygon coords for this limb
    const limb = limbs.find(l => l.id === limbId)
    if (limb?.region_coords) {
      setPolygonPoints(limb.region_coords)
    } else {
      setPolygonPoints([])
    }
    setEditingRegion(false)

    // Load child assemblies if limb has a linked BOM assembly
    if (limb?.assembly_part_number) {
      loadChildAssemblies(limbId)
    } else {
      setAssemblyTree([])
      setChildBomName('')
    }
  }

  // BOM search for linking assembly to limb
  const handleSearchBOM = async (query = bomSearchQuery) => {
    if (!selectedConfigId) return
    const config = robotConfigs.find(c => c.id === selectedConfigId)
    if (!config) return
    setSearchingBOMs(true)
    try {
      const response = await robotAssemblyService.searchBOMs(config.badge_id, query)
      if (response.data.success) {
        setBomSearchResults(response.data.boms)
      }
    } catch (error) {
      showNotification('Failed to search BOMs', 'error')
    } finally {
      setSearchingBOMs(false)
    }
  }

  const handleLinkAssemblyToLimb = async (assemblyPartNumber) => {
    if (!selectedLimbId) return
    try {
      await robotAssemblyService.updateLimb(selectedLimbId, { assembly_part_number: assemblyPartNumber })
      showNotification('Assembly linked to limb', 'success')
      setBomSearchResults([])
      setBomSearchQuery('')
      await loadLimbs(selectedConfigId)
      // Reload child assemblies
      loadChildAssemblies(selectedLimbId)
    } catch (error) {
      showNotification('Failed to link assembly', 'error')
    }
  }

  // Mark a tree node assembly as a DOF
  const handleSetAsDOF = async (child, dofNumber, dofName) => {
    if (!selectedLimbId || !dofNumber) return
    try {
      await robotAssemblyService.createDOFMapping(selectedLimbId, {
        dof_number: dofNumber,
        dof_name: dofName || child.part_name || child.description || '',
        assembly_description: child.part_number,
      })
      showNotification(`DOF ${dofNumber} created from ${child.part_number}`, 'success')
      loadDOFMappings(selectedLimbId)
      loadChildAssemblies(selectedLimbId) // Refresh is_dof flags
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to create DOF', 'error')
    }
  }

  // Manual DOF add (fallback)
  const handleAddDOF = async () => {
    if (!dofForm.dof_number || !dofForm.dof_name || !dofForm.assembly_description || !selectedLimbId) return
    try {
      await robotAssemblyService.createDOFMapping(selectedLimbId, dofForm)
      setDofForm({ dof_number: '', dof_name: '', assembly_description: '' })
      showNotification('DOF mapping added', 'success')
      loadDOFMappings(selectedLimbId)
      if (assemblyTree.length > 0) loadChildAssemblies(selectedLimbId)
    } catch (error) {
      showNotification(error.response?.data?.error || 'Failed to add DOF mapping', 'error')
    }
  }

  const handleDeleteDOF = async (mappingId) => {
    try {
      await robotAssemblyService.deleteDOFMapping(mappingId)
      showNotification('DOF mapping removed', 'success')
      loadDOFMappings(selectedLimbId)
      if (assemblyTree.length > 0) loadChildAssemblies(selectedLimbId)
    } catch (error) {
      showNotification('Failed to delete DOF mapping', 'error')
    }
  }

  // Polygon editor handlers
  const handleRegionImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target
    setImageNaturalSize({ width: naturalWidth, height: naturalHeight })
    setImageDisplaySize({ width: e.target.clientWidth, height: e.target.clientHeight })
  }

  const handleRegionImageClick = useCallback((e) => {
    if (!editingRegion || !imageNaturalSize.width) return
    const rect = regionImageRef.current.getBoundingClientRect()
    const displayX = e.clientX - rect.left
    const displayY = e.clientY - rect.top
    const scaleX = imageNaturalSize.width / regionImageRef.current.clientWidth
    const scaleY = imageNaturalSize.height / regionImageRef.current.clientHeight
    const naturalX = Math.round(displayX * scaleX)
    const naturalY = Math.round(displayY * scaleY)
    setPolygonPoints(prev => [...prev, [naturalX, naturalY]])
  }, [editingRegion, imageNaturalSize])

  const handleSaveRegion = async () => {
    if (!selectedLimbId || polygonPoints.length < 3) {
      showNotification('Need at least 3 points for a polygon', 'warning')
      return
    }
    try {
      await robotAssemblyService.updateLimb(selectedLimbId, { region_coords: polygonPoints })
      showNotification('Limb region saved', 'success')
      setEditingRegion(false)
      loadLimbs(selectedConfigId)
    } catch (error) {
      showNotification('Failed to save region', 'error')
    }
  }

  const scaleToDisplay = useCallback((coords) => {
    if (!coords || !imageNaturalSize.width || !imageDisplaySize.width) return []
    const scaleX = imageDisplaySize.width / imageNaturalSize.width
    const scaleY = imageDisplaySize.height / imageNaturalSize.height
    return coords.map(([x, y]) => [x * scaleX, y * scaleY])
  }, [imageNaturalSize, imageDisplaySize])

  // Computed values
  const selectedConfig = robotConfigs.find(c => c.id === selectedConfigId)
  const regionImageSrc = selectedConfig?.robot_image_path
    ? `/${selectedConfig.robot_image_path}`
    : selectedConfig?.has_image_data
      ? `/api/robot-assembly/config/${selectedConfig.id}/image`
      : null
  const configuredBadgeIds = robotConfigs.map(c => c.badge_id)
  const availableBadges = badges.filter(b => !configuredBadgeIds.includes(b.id))
  const selectedLimb = limbs.find(l => l.id === selectedLimbId)

  return (
    <Box>
      {/* MenteeFlow Configuration */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinkIcon />
            <Typography variant="h6">MenteeFlow Connection</Typography>
            {mfConfig?.is_active && (
              <Chip label="Active" color="success" size="small" />
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {loadingMF ? (
            <CircularProgress />
          ) : (
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="MenteeFlow Base URL"
                  value={mfForm.base_url}
                  onChange={(e) => setMfForm({ ...mfForm, base_url: e.target.value })}
                  placeholder="https://menteeflow.example.com"
                  size="small"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={mfForm.is_active}
                      onChange={(e) => setMfForm({ ...mfForm, is_active: e.target.checked })}
                    />
                  }
                  label="Integration Active"
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    fullWidth
                    label="API Key (for outgoing calls to MenteeFlow)"
                    value={mfForm.api_key}
                    onChange={(e) => setMfForm({ ...mfForm, api_key: e.target.value })}
                    size="small"
                    type={showApiKey ? 'text' : 'password'}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setShowApiKey(!showApiKey)} title={showApiKey ? 'Hide' : 'Show'}>
                            {showApiKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                          </IconButton>
                          {mfForm.api_key && (
                            <IconButton size="small" onClick={() => { navigator.clipboard.writeText(mfForm.api_key) }} title="Copy">
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          )}
                        </InputAdornment>
                      ),
                    }}
                  />
                  <Tooltip title="Generate a random secure API key">
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => setMfForm({ ...mfForm, api_key: generateSecureKey() })}
                      sx={{ minWidth: 'auto', px: 1.5 }}
                    >
                      <KeyIcon fontSize="small" />
                    </Button>
                  </Tooltip>
                </Box>
              </Grid>
              <Grid item xs={12} md={6}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    fullWidth
                    label="Webhook Secret (for incoming calls from MenteeFlow)"
                    value={mfForm.webhook_secret}
                    onChange={(e) => setMfForm({ ...mfForm, webhook_secret: e.target.value })}
                    size="small"
                    type={showWebhookSecret ? 'text' : 'password'}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setShowWebhookSecret(!showWebhookSecret)} title={showWebhookSecret ? 'Hide' : 'Show'}>
                            {showWebhookSecret ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                          </IconButton>
                          {mfForm.webhook_secret && (
                            <IconButton size="small" onClick={() => { navigator.clipboard.writeText(mfForm.webhook_secret) }} title="Copy">
                              <CopyIcon fontSize="small" />
                            </IconButton>
                          )}
                        </InputAdornment>
                      ),
                    }}
                  />
                  <Tooltip title="Generate a random secure webhook secret">
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => setMfForm({ ...mfForm, webhook_secret: generateSecureKey() })}
                      sx={{ minWidth: 'auto', px: 1.5 }}
                    >
                      <KeyIcon fontSize="small" />
                    </Button>
                  </Tooltip>
                </Box>
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Badges Displayed in Robot Assembly</Typography>
                <Alert severity="info" sx={{ mb: 1 }}>
                  Select which badges are visible in the Robot Assembly tab. If none are selected, all badges with a robot config will be shown.
                </Alert>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {badges.map((badge) => (
                    <FormControlLabel
                      key={badge.id}
                      control={
                        <Checkbox
                          checked={(mfForm.displayed_badge_ids || []).includes(badge.id)}
                          onChange={() => handleDisplayedBadgeToggle(badge.id)}
                        />
                      }
                      label={
                        <Chip
                          label={badge.name}
                          size="small"
                          sx={{ backgroundColor: badge.color, color: 'white', fontWeight: 600 }}
                        />
                      }
                    />
                  ))}
                </Box>
              </Grid>

              <Grid item xs={12}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Badge-to-Digit Mapping</Typography>
                <Alert severity="info" sx={{ mb: 1 }}>
                  Map each badge to a single digit used in process numbers (e.g., V3.2 = "2").
                  The first digit of a process number (X-XXX-XXX) identifies the badge.
                </Alert>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  {badges.map((badge) => (
                    <Box key={badge.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        label={badge.name}
                        size="small"
                        sx={{ backgroundColor: badge.color, color: 'white', fontWeight: 600 }}
                      />
                      <TextField
                        size="small"
                        label="Digit"
                        value={mfForm.badge_digit_mapping[badge.name] || ''}
                        onChange={(e) => handleBadgeDigitChange(badge.name, e.target.value)}
                        sx={{ width: 70 }}
                        inputProps={{ maxLength: 1 }}
                      />
                    </Box>
                  ))}
                </Box>
              </Grid>

              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Embed Configuration</Typography>
                <TextField
                  fullWidth
                  label="Embed URL Template (MenteeBOM base URL for iframes)"
                  value={mfForm.embed_url_template}
                  onChange={(e) => setMfForm({ ...mfForm, embed_url_template: e.target.value })}
                  placeholder="https://menteebom.example.com"
                  size="small"
                  helperText="Base URL used for generating embed iframe URLs. Leave empty to use the server's own host."
                />
              </Grid>

              <Grid item xs={12}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={handleSaveMFConfig}
                    disabled={savingMF}
                  >
                    {savingMF ? 'Saving...' : 'Save MenteeFlow Config'}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<KeyIcon />}
                    onClick={() => setShowSaveKeyDialog(true)}
                    disabled={!mfForm.api_key && !mfForm.webhook_secret}
                  >
                    Save to Active Keys
                  </Button>
                </Box>

                {/* Save Key Dialog (inline) */}
                <Collapse in={showSaveKeyDialog}>
                  <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Save Current Keys</Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField
                        size="small"
                        label="Label (e.g. Production Key #1)"
                        value={saveKeyLabel}
                        onChange={(e) => setSaveKeyLabel(e.target.value)}
                        sx={{ flex: 1 }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKeyPair()}
                      />
                      <Button variant="contained" size="small" onClick={handleSaveApiKeyPair}>
                        Save
                      </Button>
                      <Button variant="text" size="small" onClick={() => { setShowSaveKeyDialog(false); setSaveKeyLabel('') }}>
                        Cancel
                      </Button>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      This saves the current API key and webhook secret so you can track and re-activate them later.
                    </Typography>
                  </Box>
                </Collapse>
              </Grid>

              {/* Active API Keys Table */}
              <Grid item xs={12}>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Saved API Keys</Typography>
                {loadingApiKeys ? (
                  <CircularProgress size={20} />
                ) : apiKeys.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No saved API keys yet.</Typography>
                ) : (
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Label</TableCell>
                          <TableCell>API Key</TableCell>
                          <TableCell>Webhook Secret</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Created</TableCell>
                          <TableCell>Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {apiKeys.map((k) => (
                          <TableRow key={k.id} sx={{ opacity: k.is_active ? 1 : 0.5 }}>
                            <TableCell>{k.label}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{k.api_key_preview}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{k.webhook_secret_preview}</TableCell>
                            <TableCell>
                              <Chip
                                label={k.is_active ? 'Active' : 'Revoked'}
                                size="small"
                                color={k.is_active ? 'success' : 'default'}
                              />
                            </TableCell>
                            <TableCell sx={{ fontSize: '0.75rem' }}>
                              {k.created_at ? new Date(k.created_at).toLocaleDateString() : '-'}
                            </TableCell>
                            <TableCell>
                              {k.is_active ? (
                                <Tooltip title="Revoke this key pair">
                                  <IconButton size="small" color="error" onClick={() => handleRevokeApiKey(k.id)}>
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : (
                                <Tooltip title="Re-activate and apply to config">
                                  <IconButton size="small" color="primary" onClick={() => handleActivateApiKey(k.id)}>
                                    <UndoIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </Grid>
            </Grid>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Embed Tokens */}
      <Accordion sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <KeyIcon />
            <Typography variant="h6">Embed Tokens</Typography>
            {embedTokens.length > 0 && (
              <Chip label={`${embedTokens.length} active`} color="info" size="small" />
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Alert severity="info" sx={{ mb: 2 }}>
            Embed tokens allow MenteeFlow to display MenteeBOM stage views in iframes.
            Tokens are generated via the API: <code>POST /api/menteeflow/process/&lt;number&gt;/embed-token</code>
          </Alert>

          {loadingTokens ? (
            <CircularProgress />
          ) : embedTokens.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No active embed tokens.
            </Typography>
          ) : (
            <>
              <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<ClearAllIcon />}
                  onClick={handleRevokeAllTokens}
                  disabled={revokingAll}
                >
                  {revokingAll ? 'Revoking...' : 'Revoke All'}
                </Button>
              </Box>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Process</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Token</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell>Expires</TableCell>
                      <TableCell>Used</TableCell>
                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {embedTokens.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {t.process_number}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip label={t.stage_scope || 'All'} size="small" />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                            {t.token}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">
                            {t.created_at ? new Date(t.created_at).toLocaleString() : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption">
                            {t.expires_at ? new Date(t.expires_at).toLocaleString() : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {t.used_at ? (
                            <Chip label="Used" size="small" color="success" variant="outlined" />
                          ) : (
                            <Chip label="Unused" size="small" variant="outlined" />
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            color="error"
                            variant="outlined"
                            onClick={() => handleRevokeToken(t.id)}
                          >
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </AccordionDetails>
      </Accordion>

      {/* DOF Process Templates */}
      <Accordion sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinkIcon />
            <Typography variant="h6">DOF Process Templates</Typography>
            <Chip label="read-only preview" size="small" variant="outlined" />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Alert severity="info" sx={{ mb: 2 }}>
            One "no serial number" reference process per DOF (e.g. <code>2-201</code>), sourced from the
            DOF mappings configured per limb. MenteeFlow / admins open the embed link to preview a DOF's
            stage flow read-only — without opening a real process. Requires a badge digit mapped in
            MenteeFlow Connection above.
          </Alert>

          <FormControl size="small" sx={{ minWidth: 220, mb: 2 }}>
            <InputLabel>Robot (badge)</InputLabel>
            <Select
              value={templateBadgeId}
              label="Robot (badge)"
              onChange={(e) => handleSelectTemplateBadge(e.target.value)}
            >
              {badges.map((badge) => (
                <MenuItem key={badge.id} value={badge.id}>{badge.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {loadingTemplates ? (
            <CircularProgress />
          ) : !templateBadgeId ? (
            <Typography variant="body2" color="text.secondary">
              Select a robot to list its DOF templates.
            </Typography>
          ) : dofTemplates.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No DOF mappings configured for this robot.
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Limb</TableCell>
                    <TableCell>DOF #</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Process #</TableCell>
                    <TableCell align="right">Embed link</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {dofTemplates.map((t, i) => (
                    <TableRow key={`${t.limb_name}-${t.dof_number}-${i}`}>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">{t.limb_name || '-'}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={t.dof_number} size="small" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{t.dof_name}</Typography>
                      </TableCell>
                      <TableCell>
                        {t.process_number ? (
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {t.process_number}
                          </Typography>
                        ) : (
                          <Tooltip title={t.warning || 'Unavailable'}>
                            <Chip
                              icon={<WarningIcon />}
                              label="No digit mapped"
                              size="small"
                              color="warning"
                              variant="outlined"
                            />
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {t.process_number && (
                          <>
                            <Tooltip title="Copy embed link">
                              <IconButton size="small" onClick={() => handleCopyTemplateLink(t)}>
                                <CopyIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Open preview in new tab">
                              <IconButton
                                size="small"
                                component="a"
                                href={buildTemplateLink(t)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <LinkIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </AccordionDetails>
      </Accordion>

      {/* API Reference */}
      <Accordion sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CodeIcon />
            <Typography variant="h6">MenteeFlow API Reference</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <ApiReferenceSection />
        </AccordionDetails>
      </Accordion>

      {/* Robot Configurations */}
      <Accordion defaultExpanded sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Robot Configurations</Typography>
        </AccordionSummary>
        <AccordionDetails>
          {loadingConfigs ? (
            <CircularProgress />
          ) : (
            <>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                {robotConfigs.map((config) => (
                  <Chip
                    key={config.id}
                    label={`${config.badge_name} (${config.limb_count} limbs)`}
                    onClick={() => handleSelectConfig(config.id)}
                    color={selectedConfigId === config.id ? 'primary' : 'default'}
                    variant={selectedConfigId === config.id ? 'filled' : 'outlined'}
                    sx={{ fontWeight: selectedConfigId === config.id ? 600 : 400 }}
                  />
                ))}

                {availableBadges.length > 0 && (
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel>Add Badge Config</InputLabel>
                    <Select
                      value=""
                      label="Add Badge Config"
                      onChange={(e) => handleCreateConfig(e.target.value)}
                    >
                      {availableBadges.map((badge) => (
                        <MenuItem key={badge.id} value={badge.id}>
                          {badge.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Box>

              {/* Limbs section */}
              {selectedConfigId && (
                <Box>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                    Limbs
                  </Typography>

                  {loadingLimbs ? (
                    <CircularProgress size={20} />
                  ) : (
                    <>
                      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <TextField
                          size="small"
                          label="Limb Name"
                          value={newLimbName}
                          onChange={(e) => setNewLimbName(e.target.value)}
                          placeholder="e.g., Right Arm"
                          onKeyDown={(e) => e.key === 'Enter' && handleAddLimb()}
                        />
                        <TextField
                          size="small"
                          label="Assembly Part Number (optional)"
                          value={newLimbAssembly}
                          onChange={(e) => setNewLimbAssembly(e.target.value)}
                          placeholder="e.g., 029-AS-00100"
                          sx={{ width: 250 }}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddLimb()}
                        />
                        <Button
                          variant="outlined"
                          startIcon={<AddIcon />}
                          onClick={handleAddLimb}
                          disabled={!newLimbName.trim()}
                        >
                          Add Limb
                        </Button>
                      </Box>

                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                        {limbs.map((limb) => {
                          const stale = limbStaleness[limb.id]
                          return (
                            <Tooltip
                              key={limb.id}
                              title={stale?.is_stale ? 'BOM has been updated — snapshot is stale' : ''}
                            >
                              <Chip
                                label={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {stale?.is_stale && <WarningIcon fontSize="inherit" sx={{ color: 'warning.main' }} />}
                                    {limb.assembly_part_number
                                      ? `${limb.name} [${limb.assembly_part_number}] (${limb.dof_count} DOFs)`
                                      : `${limb.name} (${limb.dof_count} DOFs)`}
                                  </Box>
                                }
                                onClick={() => handleSelectLimb(limb.id)}
                                onDelete={() => handleDeleteLimb(limb.id)}
                                color={selectedLimbId === limb.id ? 'secondary' : stale?.is_stale ? 'warning' : 'default'}
                                variant={selectedLimbId === limb.id ? 'filled' : 'outlined'}
                              />
                            </Tooltip>
                          )
                        })}
                        {limbs.length === 0 && (
                          <Typography variant="body2" color="text.secondary">
                            No limbs defined. Add limbs for the robot figure.
                          </Typography>
                        )}
                      </Box>
                    </>
                  )}

                  {/* Polygon Region Editor */}
                  {selectedLimbId && regionImageSrc && (
                    <Box sx={{ mb: 2 }}>
                      <Divider sx={{ mb: 2 }} />
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                        <Typography variant="subtitle1" fontWeight={600}>
                          Clickable Region for {selectedLimb?.name}
                        </Typography>
                        {!editingRegion ? (
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<EditIcon />}
                            onClick={() => setEditingRegion(true)}
                          >
                            {polygonPoints.length > 0 ? 'Edit Region' : 'Draw Region'}
                          </Button>
                        ) : (
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button variant="outlined" size="small" startIcon={<UndoIcon />}
                              onClick={() => setPolygonPoints(prev => prev.slice(0, -1))}
                              disabled={polygonPoints.length === 0}>Undo</Button>
                            <Button variant="outlined" size="small" color="warning" startIcon={<ClearAllIcon />}
                              onClick={() => setPolygonPoints([])}
                              disabled={polygonPoints.length === 0}>Clear</Button>
                            <Button variant="contained" size="small" startIcon={<SaveIcon />}
                              onClick={handleSaveRegion}
                              disabled={polygonPoints.length < 3}>Save Region</Button>
                            <Button variant="outlined" size="small" startIcon={<CancelIcon />}
                              onClick={() => {
                                setPolygonPoints(selectedLimb?.region_coords || [])
                                setEditingRegion(false)
                              }}>Cancel</Button>
                          </Box>
                        )}
                      </Box>

                      {editingRegion && (
                        <Alert severity="info" sx={{ mb: 1 }}>
                          Click on the robot image to add polygon points. At least 3 points required. Points: {polygonPoints.length}
                        </Alert>
                      )}

                      <Box
                        sx={{
                          position: 'relative', display: 'inline-block',
                          border: editingRegion ? '2px dashed' : '1px solid',
                          borderColor: editingRegion ? 'primary.main' : 'divider',
                          borderRadius: 1, overflow: 'hidden',
                          cursor: editingRegion ? 'crosshair' : 'default',
                        }}
                        onClick={handleRegionImageClick}
                      >
                        <Box component="img" ref={regionImageRef} src={regionImageSrc}
                          alt="Robot figure" onLoad={handleRegionImageLoad}
                          sx={{ maxWidth: '100%', maxHeight: '55vh', display: 'block', userSelect: 'none', pointerEvents: 'none' }} />

                        {imageDisplaySize.width > 0 && (
                          <svg style={{ position: 'absolute', top: 0, left: 0, width: imageDisplaySize.width, height: imageDisplaySize.height, pointerEvents: 'none' }}
                            viewBox={`0 0 ${imageDisplaySize.width} ${imageDisplaySize.height}`}>
                            {limbs.filter(l => l.id !== selectedLimbId && l.region_coords?.length >= 3).map((limb) => {
                              const scaled = scaleToDisplay(limb.region_coords)
                              const pathD = scaled.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') + ' Z'
                              return <path key={limb.id} d={pathD} fill="rgba(150,150,150,0.15)" stroke="rgba(150,150,150,0.4)" strokeWidth={1} strokeDasharray="4 2" />
                            })}
                            {polygonPoints.length >= 2 && (() => {
                              const scaled = scaleToDisplay(polygonPoints)
                              const pathD = scaled.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') + (polygonPoints.length >= 3 ? ' Z' : '')
                              return <path d={pathD} fill={polygonPoints.length >= 3 ? 'rgba(75, 44, 111, 0.25)' : 'none'} stroke="rgba(75, 44, 111, 0.8)" strokeWidth={2} />
                            })()}
                            {scaleToDisplay(polygonPoints).map(([x, y], i) => (
                              <circle key={i} cx={x} cy={y} r={4} fill={i === 0 ? '#4B2C6F' : '#7B4FA2'} stroke="white" strokeWidth={1.5} />
                            ))}
                          </svg>
                        )}
                      </Box>
                    </Box>
                  )}

                  {/* Assembly Link + Child Assemblies for DOF Selection */}
                  {selectedLimbId && (
                    <Box>
                      <Divider sx={{ mb: 2 }} />
                      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                        <TreeIcon sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                        Assembly &amp; DOFs for {selectedLimb?.name}
                      </Typography>

                      {/* Link/Change assembly */}
                      {selectedLimb?.assembly_part_number ? (
                        <Box sx={{ mb: 2 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Typography variant="body2" color="text.secondary">Linked assembly:</Typography>
                            <Chip
                              label={selectedLimb.assembly_part_number}
                              color="primary"
                              size="small"
                              sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                            />
                            <Button
                              size="small"
                              onClick={() => {
                                setBomSearchQuery(selectedLimb.assembly_part_number)
                                handleSearchBOM(selectedLimb.assembly_part_number)
                              }}
                            >
                              Change
                            </Button>
                          </Box>
                        </Box>
                      ) : (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                          No assembly linked. Search and link a BOM assembly to browse its child assemblies for DOF selection.
                        </Alert>
                      )}

                      {/* BOM Search */}
                      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                        <TextField
                          size="small"
                          label="Search BOM assemblies"
                          value={bomSearchQuery}
                          onChange={(e) => setBomSearchQuery(e.target.value)}
                          placeholder="Part number or name..."
                          sx={{ width: 300 }}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearchBOM()}
                        />
                        <Button
                          variant="outlined"
                          startIcon={searchingBOMs ? <CircularProgress size={16} /> : <SearchIcon />}
                          onClick={() => handleSearchBOM()}
                          disabled={searchingBOMs}
                        >
                          Search
                        </Button>
                      </Box>

                      {/* BOM Search Results */}
                      {bomSearchResults.length > 0 && (
                        <Paper variant="outlined" sx={{ mb: 2, maxHeight: '30vh', overflow: 'auto' }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Part Number</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Rev</TableCell>
                                <TableCell width={80}>Action</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {bomSearchResults.map((bom) => (
                                <TableRow key={bom.id} hover sx={{ cursor: 'pointer' }}>
                                  <TableCell>
                                    <Typography fontFamily="monospace" fontSize="0.85rem" fontWeight={600}>
                                      {bom.assembly_part_number}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>{bom.name}</TableCell>
                                  <TableCell>{bom.assembly_revision}</TableCell>
                                  <TableCell>
                                    <Button
                                      size="small"
                                      variant="contained"
                                      onClick={() => handleLinkAssemblyToLimb(bom.assembly_part_number)}
                                    >
                                      Link
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Paper>
                      )}

                      {/* Assembly Tree from BOM (for DOF selection) */}
                      {selectedLimb?.assembly_part_number && (
                        <>
                          <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Assembly Tree: {childBomName || selectedLimb.assembly_part_number}
                            {loadingChildren && <CircularProgress size={14} sx={{ ml: 1 }} />}
                          </Typography>

                          {!loadingChildren && assemblyTree.length === 0 && (
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                              No parts found in this assembly's BOM.
                            </Typography>
                          )}

                          {assemblyTree.length > 0 && (
                            <Paper variant="outlined" sx={{ mb: 2, maxHeight: '60vh', overflow: 'auto', p: 1 }}>
                              {assemblyTree.map((node) => (
                                <AssemblyTreeNode
                                  key={node.bom_part_id}
                                  node={node}
                                  onSetAsDOF={handleSetAsDOF}
                                  depth={0}
                                />
                              ))}
                            </Paper>
                          )}
                        </>
                      )}

                      {/* Existing DOF Mappings */}
                      <Typography variant="subtitle2" sx={{ mb: 1, mt: 2 }}>
                        Mapped DOFs ({dofMappings.length})
                      </Typography>

                      {loadingDOFs ? (
                        <CircularProgress size={20} />
                      ) : dofMappings.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          No DOFs mapped yet. Select child assemblies above, or add manually below.
                        </Typography>
                      ) : (
                        <TableContainer component={Paper} variant="outlined" sx={{ mb: 2 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>DOF #</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Assembly</TableCell>
                                <TableCell>BOM</TableCell>
                                <TableCell width={60}>Actions</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {dofMappings.map((dof) => (
                                <TableRow key={dof.id} hover>
                                  <TableCell>
                                    <Typography fontFamily="monospace" fontWeight={600}>
                                      {dof.dof_number}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>{dof.dof_name}</TableCell>
                                  <TableCell>
                                    <Typography fontFamily="monospace" fontSize="0.8rem">
                                      {dof.assembly_description}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    {dof.bom_instance_id ? (
                                      <Chip label={`BOM #${dof.bom_instance_id}`} size="small" color="success" />
                                    ) : (
                                      <Chip label="By Desc" size="small" variant="outlined" />
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <IconButton size="small" color="error" onClick={() => handleDeleteDOF(dof.id)}>
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      )}

                      {/* Manual DOF add (fallback) */}
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <TextField size="small" label="DOF # (3 digits)" value={dofForm.dof_number}
                          onChange={(e) => setDofForm({ ...dofForm, dof_number: e.target.value })}
                          sx={{ width: 120 }} inputProps={{ maxLength: 3 }} />
                        <TextField size="small" label="DOF Name" value={dofForm.dof_name}
                          onChange={(e) => setDofForm({ ...dofForm, dof_name: e.target.value })}
                          placeholder="e.g., Shoulder Pitch" sx={{ width: 180 }} />
                        <TextField size="small" label="Assembly Part # or Description" value={dofForm.assembly_description}
                          onChange={(e) => setDofForm({ ...dofForm, assembly_description: e.target.value })}
                          placeholder="e.g., 029-AS-00200" sx={{ flex: 1, minWidth: 200 }} />
                        <Button variant="outlined" size="small" startIcon={<AddIcon />}
                          onClick={handleAddDOF}
                          disabled={!dofForm.dof_number || !dofForm.dof_name || !dofForm.assembly_description}>
                          Add Manual
                        </Button>
                      </Box>
                    </Box>
                  )}
                </Box>
              )}
            </>
          )}
        </AccordionDetails>
      </Accordion>

      {/* External DOFs */}
      <Accordion sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ExtensionIcon />
            <Typography variant="h6">External DOFs</Typography>
            <Chip label="4 DOFs" color="secondary" size="small" />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Alert severity="info" sx={{ mb: 2 }}>
            These DOFs are outside the limb structure. MenteeFlow can create processes for them using DOF numbers 801–804,
            exactly like regular limb DOFs. Run <strong>migrate_external_dofs.py</strong> once to seed them into the database.
          </Alert>
          {loadingExternalDOFs ? (
            <CircularProgress size={24} />
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>DOF #</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Part Number</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[
                    { dof: '801', name: 'AII', part: '034-AS-01477' },
                    { dof: '802', name: 'BII', part: '034-AS-01478' },
                    { dof: '803', name: 'CII', part: '034-AS-01479' },
                    { dof: '804', name: 'DII', part: '034-AS-01480' },
                  ].map((row) => {
                    const seeded = externalDOFs.find(d => d.dof_number === row.dof)
                    return (
                      <TableRow key={row.dof}>
                        <TableCell>
                          <Typography fontFamily="monospace" fontWeight={600}>{row.dof}</Typography>
                        </TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>
                          <Typography fontFamily="monospace" fontSize="0.85rem">{row.part}</Typography>
                        </TableCell>
                        <TableCell>
                          {seeded ? (
                            <Chip label="Seeded" color="success" size="small" />
                          ) : (
                            <Chip label="Not seeded" color="warning" size="small" variant="outlined" />
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Assembly Drawing Defaults */}
      <Accordion sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TreeIcon />
            <Typography variant="h6">Assembly Drawing Defaults</Typography>
            {Object.values(drawingDefaults).flat().length > 0 && (
              <Chip label={`${Object.values(drawingDefaults).flat().length} mappings`} color="info" size="small" />
            )}
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Alert severity="info" sx={{ mb: 2 }}>
            Configure default assembly instruction drawings per assembly type. Motor (Stage 3.1) and DOF (Stage 9) use their own part number automatically.
          </Alert>

          {loadingDrawings ? (
            <CircularProgress />
          ) : (
            <>
              {[
                { type: 'gear', label: 'Gear Assembly (Stage 3.2)', description: 'Match by gear type in description (e.g., GA7II). 7 gear assemblies, each with a specific drawing.' },
                { type: 'motor_and_gear', label: 'Motor & Gear Assembly (Stage 5)', description: 'Match by motor type group: MA_MB or MC_MD.' },
                { type: 'actuator', label: 'Actuator Assembly (Stage 7)', description: 'MA/MB motors use key "MA_MB" (shared general drawing). MC/MD motors use the actuator assembly part number as match key (each has its own drawing).' },
              ].map(({ type, label, description }) => (
                <Box key={type} sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 0.5 }}>{label}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{description}</Typography>

                  {/* Existing mappings table */}
                  {(drawingDefaults[type] || []).length > 0 && (
                    <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Match Key</TableCell>
                            <TableCell>Drawing Part #</TableCell>
                            <TableCell>File</TableCell>
                            <TableCell align="right">Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(drawingDefaults[type] || []).map((d) => (
                            <TableRow key={d.id}>
                              {editingDrawingId === d.id ? (
                                <>
                                  <TableCell>
                                    <TextField
                                      size="small"
                                      value={editDrawingForm.match_key || ''}
                                      onChange={(e) => setEditDrawingForm({ ...editDrawingForm, match_key: e.target.value })}
                                      sx={{ width: 120 }}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <TextField
                                      size="small"
                                      value={editDrawingForm.drawing_part_number || ''}
                                      onChange={(e) => setEditDrawingForm({ ...editDrawingForm, drawing_part_number: e.target.value })}
                                      sx={{ width: 150 }}
                                    />
                                  </TableCell>
                                  <TableCell>-</TableCell>
                                  <TableCell align="right">
                                    <IconButton size="small" color="primary" onClick={() => handleUpdateDrawingDefault(d.id)}>
                                      <SaveIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton size="small" onClick={() => setEditingDrawingId(null)}>
                                      <CancelIcon fontSize="small" />
                                    </IconButton>
                                  </TableCell>
                                </>
                              ) : (
                                <>
                                  <TableCell><Chip label={d.match_key} size="small" /></TableCell>
                                  <TableCell><code>{d.drawing_part_number || '-'}</code></TableCell>
                                  <TableCell>
                                    {d.has_uploaded_file ? (
                                      <Chip label="Uploaded" size="small" color="success" variant="outlined" />
                                    ) : '-'}
                                  </TableCell>
                                  <TableCell align="right">
                                    <IconButton size="small" onClick={() => {
                                      setEditingDrawingId(d.id)
                                      setEditDrawingForm({
                                        match_key: d.match_key,
                                        drawing_part_number: d.drawing_part_number || '',
                                      })
                                    }}>
                                      <EditIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                      size="small"
                                      component="label"
                                      title="Upload fallback file"
                                    >
                                      <AddIcon fontSize="small" />
                                      <input
                                        type="file"
                                        hidden
                                        accept=".pdf,.png,.jpg,.jpeg"
                                        onChange={(e) => {
                                          if (e.target.files[0]) handleUploadDrawingFile(d.id, e.target.files[0])
                                        }}
                                      />
                                    </IconButton>
                                    <IconButton size="small" color="error" onClick={() => handleDeleteDrawingDefault(d.id)}>
                                      <DeleteIcon fontSize="small" />
                                    </IconButton>
                                  </TableCell>
                                </>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}

                  {/* Add new mapping form */}
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <TextField
                      size="small"
                      label="Match Key"
                      placeholder={type === 'gear' ? 'e.g. GA7II' : 'e.g. MA_MB'}
                      value={drawingForm.assembly_type === type ? drawingForm.match_key : ''}
                      onChange={(e) => setDrawingForm({ ...drawingForm, assembly_type: type, match_key: e.target.value })}
                      sx={{ width: 130 }}
                    />
                    <TextField
                      size="small"
                      label="Drawing Part #"
                      placeholder="Part number with AI PDF"
                      value={drawingForm.assembly_type === type ? drawingForm.drawing_part_number : ''}
                      onChange={(e) => setDrawingForm({ ...drawingForm, assembly_type: type, drawing_part_number: e.target.value })}
                      sx={{ width: 180 }}
                    />
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<AddIcon />}
                      onClick={() => handleCreateDrawingDefault(type)}
                      disabled={drawingForm.assembly_type !== type || !drawingForm.match_key || !drawingForm.drawing_part_number}
                    >
                      Add
                    </Button>
                  </Box>

                  {type !== 'actuator' && <Divider sx={{ mt: 2 }} />}
                </Box>
              ))}
            </>
          )}
        </AccordionDetails>
      </Accordion>

    </Box>
  )
}

/** Code block with copy button */
const CodeBlock = ({ children, label }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Box sx={{ position: 'relative', mb: 1 }}>
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          {label}
        </Typography>
      )}
      <Box
        sx={{
          bgcolor: '#1e1e1e',
          color: '#d4d4d4',
          borderRadius: 1,
          p: 2,
          fontFamily: 'monospace',
          fontSize: '0.82rem',
          overflow: 'auto',
          whiteSpace: 'pre',
          maxHeight: 400,
        }}
      >
        <IconButton
          size="small"
          onClick={handleCopy}
          sx={{ position: 'absolute', top: label ? 28 : 8, right: 8, color: '#888' }}
          title="Copy"
        >
          <CopyIcon fontSize="small" />
        </IconButton>
        {copied && (
          <Typography
            variant="caption"
            sx={{ position: 'absolute', top: label ? 34 : 14, right: 40, color: '#4caf50' }}
          >
            Copied!
          </Typography>
        )}
        {children}
      </Box>
    </Box>
  )
}

/** Single API endpoint card */
const EndpointCard = ({ method, path, description, headers, requestBody, responseBody, notes }) => (
  <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
      <Chip
        label={method}
        size="small"
        color={method === 'GET' ? 'info' : method === 'POST' ? 'success' : 'default'}
        sx={{ fontWeight: 700, fontFamily: 'monospace' }}
      />
      <Typography variant="subtitle1" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
        {path}
      </Typography>
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
      {description}
    </Typography>
    {headers && (
      <CodeBlock label="Headers">{headers}</CodeBlock>
    )}
    {requestBody && (
      <CodeBlock label="Request Body">{requestBody}</CodeBlock>
    )}
    {responseBody && (
      <CodeBlock label="Response">{responseBody}</CodeBlock>
    )}
    {notes && (
      <Alert severity="info" sx={{ mt: 1 }} variant="outlined">
        {notes}
      </Alert>
    )}
  </Paper>
)

/** MenteeFlow API Reference section displayed in admin panel */
const ApiReferenceSection = () => {
  const [expandedSection, setExpandedSection] = useState(null)
  const toggleSection = (section) => setExpandedSection(expandedSection === section ? null : section)

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2 }}>
        These are the API endpoints for MenteeFlow &harr; MenteeBOM integration.
        All requests use API key authentication via headers. The base URL is{' '}
        <code>/api/menteeflow</code>.
      </Alert>

      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Authentication: All requests require <code>X-MenteeFlow-API-Key: &lt;webhook_secret&gt;</code> header.
        Callbacks from MenteeBOM use <code>X-MenteeBOM-API-Key: &lt;api_key&gt;</code>.
      </Typography>

      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        Process Number Format: <code>X-XXX-XXX</code> &mdash; Badge digit, DOF number, MenteeFlow suffix.
        Example: <code>2-200-349</code>
      </Typography>

      <Divider sx={{ mb: 2 }} />

      {/* Section: Inbound endpoints (MenteeFlow -> MenteeBOM) */}
      <Box
        onClick={() => toggleSection('inbound')}
        sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
      >
        {expandedSection === 'inbound' ? <ExpandMoreIcon /> : <ChevronRightIcon />}
        <Typography variant="h6" sx={{ fontSize: '1rem' }}>
          Inbound Endpoints (MenteeFlow &rarr; MenteeBOM)
        </Typography>
      </Box>
      <Collapse in={expandedSection === 'inbound'}>
        <Box sx={{ pl: 2, mb: 2 }}>
          <EndpointCard
            method="POST"
            path="/api/menteeflow/process/create"
            description="Create a new manufacturing process. The process appears immediately in the Robot Assembly process flexbox."
            headers={`X-MenteeFlow-API-Key: <webhook_secret>\nContent-Type: application/json`}
            requestBody={JSON.stringify({
              process_number: "2-200-349",
              name: "Right Arm Shoulder DOF Assembly #349",
              ticket_id: "MF-2025-00349",
              ticket_url: "https://menteeflow.example.com/tickets/MF-2025-00349"
            }, null, 2)}
            responseBody={JSON.stringify({
              success: true,
              process_id: 42,
              process_number: "2-200-349",
              badge: "V3.2",
              dof_name: "Shoulder Pitch",
              limb: "Right Arm",
              message: "Process created successfully"
            }, null, 2)}
            notes="process_number must be unique. Returns 409 if duplicate. Returns 404 if badge digit or DOF number is not mapped."
          />

          <EndpointCard
            method="POST"
            path="/api/menteeflow/process/{process_number}/advance"
            description="Advance a process to the next stage. MenteeBOM makes the appropriate stage modal available to the floor user."
            headers={`X-MenteeFlow-API-Key: <webhook_secret>\nContent-Type: application/json`}
            requestBody={JSON.stringify({
              stage: 2,
              stage_data: {}
            }, null, 2)}
            responseBody={JSON.stringify({
              success: true,
              process_number: "2-200-349",
              stage: 2,
              stage_status: "in_progress",
              message: "Stage 2 (Picking) activated"
            }, null, 2)}
            notes="Valid stages: 2, 3.1, 3.2, 4, 5, 6. Stages 3.1 and 3.2 can run in parallel. Stage 3.1 accepts stage_data: { motor_type: 'MA'|'MB'|'MC'|'MD' }."
          />

          <EndpointCard
            method="GET"
            path="/api/menteeflow/process/{process_number}/status"
            description="Poll the current state of a process. Use as a fallback if a stage-complete callback was missed."
            headers={`X-MenteeFlow-API-Key: <webhook_secret>`}
            responseBody={JSON.stringify({
              process_number: "2-200-349",
              name: "Right Arm Shoulder DOF Assembly #349",
              badge: "V3.2",
              dof_name: "Shoulder Pitch",
              limb: "Right Arm",
              current_stage: 2,
              status: "active",
              stages: [
                { stage_number: 1, stage_name: "Process Created", status: "completed" },
                { stage_number: 2, stage_name: "Picking", status: "in_progress" },
                { stage_number: 3.1, stage_name: "Motor Assembly", status: "pending" },
                { stage_number: 3.2, stage_name: "Gear Assembly", status: "pending" },
                { stage_number: 4, stage_name: "CHE 1", status: "pending" },
                { stage_number: 5, stage_name: "Motor and Gear Assembly", status: "pending" },
                { stage_number: 6, stage_name: "CHE 2", status: "pending" },
                { stage_number: 7, stage_name: "Actuator Assembly", status: "pending" },
                { stage_number: 8, stage_name: "CHE 3", status: "pending" },
                { stage_number: 9, stage_name: "DOF Assembly", status: "pending" },
              ]
            }, null, 2)}
          />
        </Box>
      </Collapse>

      {/* Section: Outbound callback (MenteeBOM -> MenteeFlow) */}
      <Box
        onClick={() => toggleSection('outbound')}
        sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
      >
        {expandedSection === 'outbound' ? <ExpandMoreIcon /> : <ChevronRightIcon />}
        <Typography variant="h6" sx={{ fontSize: '1rem' }}>
          Outbound Callback (MenteeBOM &rarr; MenteeFlow)
        </Typography>
      </Box>
      <Collapse in={expandedSection === 'outbound'}>
        <Box sx={{ pl: 2, mb: 2 }}>
          <EndpointCard
            method="POST"
            path="/api/webhook/menteebom/stage-complete"
            description="MenteeBOM sends this callback when a floor user completes a stage. MenteeFlow must expose this endpoint."
            headers={`X-MenteeBOM-API-Key: <api_key>\nContent-Type: application/json`}
            requestBody={JSON.stringify({
              process_number: "2-200-349",
              stage: 2,
              status: "completed",
              timestamp: "2025-06-15T11:45:00Z",
              completed_by: "floor_user_1",
              data: {
                all_parts_picked: true,
                picked_count: 24,
                total_count: 24
              }
            }, null, 2)}
            responseBody={JSON.stringify({
              success: true,
              message: "Stage completion acknowledged"
            }, null, 2)}
            notes="If MenteeFlow returns non-200, MenteeBOM logs the failure but does NOT retry. MenteeFlow can poll /status to recover."
          />
        </Box>
      </Collapse>

      {/* Section: Stage data payloads */}
      <Box
        onClick={() => toggleSection('stagedata')}
        sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
      >
        {expandedSection === 'stagedata' ? <ExpandMoreIcon /> : <ChevronRightIcon />}
        <Typography variant="h6" sx={{ fontSize: '1rem' }}>
          Stage Callback Data Payloads
        </Typography>
      </Box>
      <Collapse in={expandedSection === 'stagedata'}>
        <Box sx={{ pl: 2, mb: 2 }}>
          <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Stage 2 (Picking) - All parts picked:</Typography>
            <CodeBlock>{JSON.stringify({ all_parts_picked: true, picked_count: 24, total_count: 24 }, null, 2)}</CodeBlock>

            <Typography variant="subtitle2" sx={{ mb: 1, mt: 2 }}>Stage 2 (Picking) - Some parts NOT picked:</Typography>
            <CodeBlock>{JSON.stringify({
              all_parts_picked: false,
              picked_count: 20,
              total_count: 24,
              unpicked_parts: [
                { part_number: "029-MP-01234", revision: "01", description: "Shoulder Bearing Housing", required_quantity: 2, inventory_available: 0, parent_assembly: "029-AS-00200" }
              ]
            }, null, 2)}</CodeBlock>

            <Typography variant="subtitle2" sx={{ mb: 1, mt: 2 }}>Stage 3.1 (Motor Assembly Finished):</Typography>
            <CodeBlock>{JSON.stringify({ motor_type: "MA", assembly_completed: true }, null, 2)}</CodeBlock>

            <Typography variant="subtitle2" sx={{ mb: 1, mt: 2 }}>Stage 3.2 (Gear Assembly Finished):</Typography>
            <CodeBlock>{JSON.stringify({ gear_assembly_serial: "200", assembly_completed: true }, null, 2)}</CodeBlock>

            <Typography variant="subtitle2" sx={{ mb: 1, mt: 2 }}>Stages 4, 5, 6 (Assembly Finished):</Typography>
            <CodeBlock>{JSON.stringify({ assembly_completed: true }, null, 2)}</CodeBlock>
          </Paper>
        </Box>
      </Collapse>

      {/* Section: Process Flow Diagram */}
      <Box
        onClick={() => toggleSection('flow')}
        sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
      >
        {expandedSection === 'flow' ? <ExpandMoreIcon /> : <ChevronRightIcon />}
        <Typography variant="h6" sx={{ fontSize: '1rem' }}>
          Process Flow
        </Typography>
      </Box>
      <Collapse in={expandedSection === 'flow'}>
        <Box sx={{ pl: 2, mb: 2 }}>
          <CodeBlock>{`MenteeFlow                          MenteeBOM                         Floor User
    |                                   |                                 |
    |-- POST /process/create ---------->|                                 |
    |   {process_number: "2-200-349"}   |-- Process appears in flexbox -->|
    |<-- 201 {success, process_id} -----|                                 |
    |                                   |                                 |
    |-- POST /advance {stage: 2} ----->|-- Picking modal available ----->|
    |<-- 200 {stage: "in_progress"} ---|                                 |
    |                                   |<-- User picks parts ------------|
    |                                   |<-- "Finish Part Picking" -------|
    |<-- POST /stage-complete ---------|                                 |
    |   {stage: 2, data: {...}}        |                                 |
    |-- 200 {success} ---------------->|                                 |
    |                                   |                                 |
    |-- POST /advance {stage: 3.1} --->|-- Motor assembly modal ------->|
    |-- POST /advance {stage: 3.2} --->|-- Gear assembly modal -------->|
    |   (3.1 and 3.2 can be parallel)  |                                 |
    |<-- POST /stage-complete {3.1} ---|                                 |
    |<-- POST /stage-complete {3.2} ---|                                 |
    |                                   |                                 |
    |-- POST /advance {stage: 4} ----->|-- Motor+Gear modal ----------->|
    |<-- POST /stage-complete {4} -----|                                 |
    |                                   |                                 |
    |-- POST /advance {stage: 5} ----->|-- Actuator assembly modal ---->|
    |<-- POST /stage-complete {5} -----|   (raises driver assembled)     |
    |                                   |                                 |
    |-- POST /advance {stage: 6} ----->|-- DOF assembly modal --------->|
    |<-- POST /stage-complete {6} -----|   (ticket closed)              |`}</CodeBlock>
        </Box>
      </Collapse>

      {/* Error codes table */}
      <Box
        onClick={() => toggleSection('errors')}
        sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}
      >
        {expandedSection === 'errors' ? <ExpandMoreIcon /> : <ChevronRightIcon />}
        <Typography variant="h6" sx={{ fontSize: '1rem' }}>
          Error Codes
        </Typography>
      </Box>
      <Collapse in={expandedSection === 'errors'}>
        <Box sx={{ pl: 2, mb: 2 }}>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Code</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Meaning</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[
                  ['400', 'Invalid process_number format, missing required fields, invalid stage number'],
                  ['401', 'Invalid or missing API key'],
                  ['404', 'Badge digit or DOF number not mapped / process not found'],
                  ['409', 'Process number already exists / stage already in_progress or completed'],
                ].map(([code, meaning]) => (
                  <TableRow key={code}>
                    <TableCell><Chip label={code} size="small" color="error" variant="outlined" /></TableCell>
                    <TableCell>{meaning}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Collapse>
    </Box>
  )
}

/** Recursive tree node for assembly browsing + DOF assignment */
const AssemblyTreeNode = ({ node, onSetAsDOF, depth = 0 }) => {
  const [expanded, setExpanded] = useState(depth < 1) // auto-expand first level
  const [dofNumber, setDofNumber] = useState('')
  const [dofName, setDofName] = useState(node.part_name || node.description || '')

  const hasChildren = node.children && node.children.length > 0
  const isAssembly = node.is_assembly

  return (
    <Box>
      {/* Node row */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          pl: depth * 3,
          py: 0.4,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: node.is_dof ? 'success.50' : (isAssembly ? 'action.hover' : 'transparent'),
          '&:hover': { bgcolor: node.is_dof ? 'success.50' : 'action.selected' },
          minHeight: 36,
        }}
      >
        {/* Expand/collapse toggle */}
        <IconButton
          size="small"
          onClick={() => setExpanded(!expanded)}
          sx={{
            width: 24, height: 24,
            visibility: hasChildren ? 'visible' : 'hidden',
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>

        {/* Thumbnail */}
        {node.thumbnail ? (
          <Avatar variant="rounded" src={getThumbSrc(node.thumbnail)} sx={{ width: 24, height: 24 }} />
        ) : (
          <Box sx={{ width: 24 }} />
        )}

        {/* Part number */}
        <Typography
          fontFamily="monospace"
          fontSize="0.8rem"
          fontWeight={isAssembly ? 700 : 400}
          sx={{ minWidth: 140, color: isAssembly ? 'primary.main' : 'text.primary' }}
        >
          {node.part_number}
        </Typography>

        {/* Description */}
        <Typography variant="body2" sx={{ flex: 1, fontSize: '0.8rem' }} noWrap title={node.description || node.part_name}>
          {node.description || node.part_name}
        </Typography>

        {/* Type chip */}
        <Chip
          label={node.part_type || 'Part'}
          size="small"
          variant="outlined"
          color={isAssembly ? 'primary' : 'default'}
          sx={{ fontSize: '0.7rem', height: 20 }}
        />

        {/* Quantity */}
        <Typography variant="caption" sx={{ minWidth: 30, textAlign: 'right' }}>
          x{node.quantity}
        </Typography>

        {/* DOF status / action */}
        {node.is_dof ? (
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', ml: 1 }}>
            <Chip label="DOF" color="success" size="small" sx={{ fontSize: '0.7rem', height: 20 }} />
            {node.shared_with_limbs?.length > 0 && (
              <Chip
                label={`Also: ${node.shared_with_limbs.join(', ')}`}
                size="small"
                color="info"
                variant="outlined"
                sx={{ fontSize: '0.65rem', height: 18 }}
              />
            )}
          </Box>
        ) : isAssembly ? (
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', ml: 1 }}>
            {node.shared_with_limbs?.length > 0 && (
              <Chip
                label={`DOF in: ${node.shared_with_limbs.join(', ')}`}
                size="small"
                color="info"
                variant="outlined"
                sx={{ fontSize: '0.65rem', height: 18 }}
              />
            )}
            <TextField
              size="small"
              placeholder="DOF #"
              value={dofNumber}
              onChange={(e) => setDofNumber(e.target.value)}
              sx={{ width: 65, '& .MuiInputBase-input': { py: 0.3, px: 0.5, fontSize: '0.8rem' } }}
              inputProps={{ maxLength: 3 }}
            />
            <Button
              size="small"
              variant="contained"
              disabled={!dofNumber}
              onClick={() => onSetAsDOF(node, dofNumber, dofName)}
              sx={{ minWidth: 'auto', px: 1, py: 0.2, fontSize: '0.7rem' }}
            >
              Set DOF
            </Button>
          </Box>
        ) : (
          <Box sx={{ width: 130 }} />
        )}
      </Box>

      {/* Children (collapsible) */}
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {node.children.map((child) => (
            <AssemblyTreeNode
              key={child.bom_part_id}
              node={child}
              onSetAsDOF={onSetAsDOF}
              depth={depth + 1}
            />
          ))}
        </Collapse>
      )}
    </Box>
  )
}

export default RobotAssemblyAdmin
