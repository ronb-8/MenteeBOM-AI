import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Breadcrumbs,
  Link as MuiLink,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Tooltip as MuiTooltip,
  Chip,
} from '@mui/material'
import {
  PrecisionManufacturing as RobotIcon,
  NavigateNext as NavigateNextIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Visibility as EyeIcon,
  BlockOutlined as NoDrawingIcon,
  PlayArrow as AssembleIcon,
} from '@mui/icons-material'
import { useNotification } from '../context/NotificationContext'
import { useAuth } from '../context/AuthContext'
import robotAssemblyService from '../services/robotAssemblyService'
import RobotFigure from '../components/robot-assembly/RobotFigure'
import ProcessFlexbox from '../components/robot-assembly/ProcessFlexbox'
import LimbProcessFlexbox from '../components/robot-assembly/LimbProcessFlexbox'
import PickingModal from '../components/robot-assembly/PickingModal'
import AssemblyStageModal from '../components/robot-assembly/AssemblyStageModal'
import LimbPickingModal from '../components/robot-assembly/LimbPickingModal'
import LimbAssemblyModal from '../components/robot-assembly/LimbAssemblyModal'
import LimbAssemblyTree from '../components/robot-assembly/LimbAssemblyTree'
import LimbAssemblyWorkflowDialog from '../components/robot-assembly/LimbAssemblyWorkflowDialog'

const RobotAssembly = () => {
  const { limbSlug, dofNumber, processNumber, stageNumber } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { showNotification } = useNotification()
  const { user } = useAuth()

  // All roles see the assembly tree (floor users see read-only, engineers/admins see full controls)
  const canSeeAssemblyTree = true

  // Badge state
  const [badges, setBadges] = useState([])
  const [selectedBadgeId, setSelectedBadgeId] = useState(null)
  const [loadingBadges, setLoadingBadges] = useState(true)

  // Robot config state
  const [robotConfig, setRobotConfig] = useState(null)
  const [loadingConfig, setLoadingConfig] = useState(false)

  // Selected limb and DOFs state
  const [selectedLimb, setSelectedLimb] = useState(null)
  const [limbDOFs, setLimbDOFs] = useState([])
  const [loadingDOFs, setLoadingDOFs] = useState(false)

  // Process state
  const [processes, setProcesses] = useState([])
  const [processFilter, setProcessFilter] = useState('active')
  const [loadingProcesses, setLoadingProcesses] = useState(false)

  // Modal state
  const [pickingModalOpen, setPickingModalOpen] = useState(false)
  const [assemblyModalOpen, setAssemblyModalOpen] = useState(false)
  const [selectedProcess, setSelectedProcess] = useState(null)
  const [activeStage, setActiveStage] = useState(null)

  // Stage instruction browser (view-only, replaces process-card click behavior)
  const [stageBrowserOpen, setStageBrowserOpen] = useState(false)
  const [stageBrowserProcess, setStageBrowserProcess] = useState(null)
  const [stageBrowserIsLimb, setStageBrowserIsLimb] = useState(false)
  const [stageBrowserStages, setStageBrowserStages] = useState([])

  // Whether the assembly modal was opened from the browser (preview) vs deep link (normal)
  const [assemblyPreviewMode, setAssemblyPreviewMode] = useState(false)

  // Limb assembly process state
  const [limbProcesses, setLimbProcesses] = useState([])
  const [loadingLimbProcesses, setLoadingLimbProcesses] = useState(false)
  const [limbPickingOpen, setLimbPickingOpen] = useState(false)
  const [limbAssemblyOpen, setLimbAssemblyOpen] = useState(false)
  const [selectedLimbProcess, setSelectedLimbProcess] = useState(null)
  const [activeLimbStage, setActiveLimbStage] = useState(null) // stage_label like "LL1"

  // Limb assembly workflow dialog (native floor user flow)
  const [limbWorkflowOpen, setLimbWorkflowOpen] = useState(false)
  const [limbWorkflowTarget, setLimbWorkflowTarget] = useState({ limb: null, process: null })

  // Collapse state for process sections
  const [processesExpanded, setProcessesExpanded] = useState(false)
  const [limbProcessesExpanded, setLimbProcessesExpanded] = useState(false)

  // Track if deep-link has been handled
  const deepLinkHandled = useRef(false)

  // Load displayed badges on mount
  useEffect(() => {
    const loadBadges = async () => {
      try {
        const response = await robotAssemblyService.getDisplayedBadges()
        if (response.data.success) {
          setBadges(response.data.badges)

          // Check URL for badge param
          const badgeParam = searchParams.get('badge')
          if (badgeParam && response.data.badges.length > 0) {
            const badge = response.data.badges.find(b => b.name.includes(badgeParam) || b.id === parseInt(badgeParam))
            if (badge) {
              setSelectedBadgeId(badge.id)
            }
          } else if (response.data.badges.length > 0) {
            setSelectedBadgeId(response.data.badges[0].id)
          }
        }
      } catch (error) {
        showNotification('Failed to load badges', 'error')
      } finally {
        setLoadingBadges(false)
      }
    }
    loadBadges()
  }, [])

  // Load robot config when badge changes
  useEffect(() => {
    if (!selectedBadgeId) return

    const loadConfig = async () => {
      setLoadingConfig(true)
      try {
        const response = await robotAssemblyService.getRobotConfig(selectedBadgeId)
        if (response.data.success) {
          setRobotConfig(response.data.config)
        } else {
          setRobotConfig(null)
        }
      } catch (error) {
        if (error.response?.status !== 404) {
          showNotification('Failed to load robot config', 'error')
        }
        setRobotConfig(null)
      } finally {
        setLoadingConfig(false)
      }
    }
    loadConfig()
  }, [selectedBadgeId])

  // Load processes when badge changes
  useEffect(() => {
    if (!selectedBadgeId) return
    loadProcesses()
  }, [selectedBadgeId, processFilter])

  const loadProcesses = useCallback(async () => {
    if (!selectedBadgeId) return
    setLoadingProcesses(true)
    try {
      const response = await robotAssemblyService.getProcesses({
        badge_id: selectedBadgeId,
        status: processFilter,
      })
      if (response.data.success) {
        setProcesses(response.data.processes)
      }
    } catch (error) {
      console.error('Failed to load processes:', error)
    } finally {
      setLoadingProcesses(false)
    }
  }, [selectedBadgeId, processFilter])

  // Load limb assembly processes
  useEffect(() => {
    if (!selectedBadgeId) return
    loadLimbProcesses()
  }, [selectedBadgeId, processFilter])

  const loadLimbProcesses = useCallback(async () => {
    if (!selectedBadgeId) return
    setLoadingLimbProcesses(true)
    try {
      const response = await robotAssemblyService.getLimbProcesses({
        badge_id: selectedBadgeId,
        status: processFilter === 'all' ? undefined : processFilter,
      })
      if (response.data.success) {
        setLimbProcesses(response.data.processes)
      }
    } catch (error) {
      console.error('Failed to load limb processes:', error)
    } finally {
      setLoadingLimbProcesses(false)
    }
  }, [selectedBadgeId, processFilter])

  // ========================================================
  // Deep-linking: auto-open modal from URL params
  // URL: /robot-assembly/process/:processNumber/stage/:stageNumber
  // ========================================================
  useEffect(() => {
    if (!processNumber || !stageNumber || deepLinkHandled.current) return

    const openFromDeepLink = async () => {
      try {
        const response = await robotAssemblyService.getProcessByNumber(processNumber)
        if (!response.data.success) {
          showNotification(`Process ${processNumber} not found`, 'error')
          return
        }

        const processDetail = response.data.process
        const stages = response.data.stages || []
        setSelectedProcess(processDetail)

        // Auto-select the badge for this process
        if (processDetail.badge_id) {
          setSelectedBadgeId(processDetail.badge_id)
        }

        const targetStage = stageNumber // e.g. "3.1", "3.2", "2", "4", etc.

        if (targetStage === '2') {
          // Check if stage 2 is in_progress
          const stage2 = stages.find(s =>
            s.stage_number === 2 && s.status === 'in_progress'
          )
          if (stage2) {
            setPickingModalOpen(true)
          } else {
            showNotification(`Stage 2 (Picking) is not currently in progress`, 'info')
          }
        } else if (['3.1', '3.2', '4', '5', '6'].includes(targetStage)) {
          // Check if the target stage is in_progress
          const stageNum = parseInt(targetStage)
          const stageSub = targetStage.includes('.') ? targetStage : null
          const targetRecord = stages.find(s =>
            (stageSub ? s.stage_sub === stageSub : s.stage_number === stageNum && !s.stage_sub) &&
            s.status === 'in_progress'
          )
          if (targetRecord) {
            setActiveStage(targetStage)
            setAssemblyModalOpen(true)
          } else {
            showNotification(`Stage ${targetStage} is not currently in progress`, 'info')
          }
        }

        deepLinkHandled.current = true
      } catch (error) {
        showNotification(`Failed to load process ${processNumber}`, 'error')
      }
    }

    openFromDeepLink()
  }, [processNumber, stageNumber])

  // Handle limb click from robot figure
  const handleLimbClick = useCallback((limb) => {
    setSelectedLimb(limb)
    navigate(`/robot-assembly/limb/${limb.slug}?badge=${selectedBadgeId}`)
  }, [navigate, selectedBadgeId])

  // Load DOFs when limb is selected via URL (only for roles that see the assembly tree)
  useEffect(() => {
    if (!limbSlug || !robotConfig) return

    const limb = robotConfig.limbs?.find(l => l.slug === limbSlug)
    if (limb) {
      setSelectedLimb(limb)
      const loadDOFs = async () => {
        setLoadingDOFs(true)
        try {
          const response = await robotAssemblyService.getLimbDOFs(limb.id)
          if (response.data.success) {
            setLimbDOFs(response.data.dofs)
          }
        } catch (error) {
          showNotification('Failed to load DOFs', 'error')
        } finally {
          setLoadingDOFs(false)
        }
      }
      loadDOFs()
    }
  }, [limbSlug, robotConfig])

  // Handle badge change
  const handleBadgeChange = (event) => {
    const badgeId = event.target.value
    setSelectedBadgeId(badgeId)
    setSelectedLimb(null)
    setLimbDOFs([])
    setSearchParams({ badge: badgeId })
    navigate(`/robot-assembly?badge=${badgeId}`)
  }

  // Handle process card click — open the stage instruction browser (view-only)
  const handleProcessClick = async (process) => {
    try {
      const response = await robotAssemblyService.getProcess(process.id)
      if (!response.data.success) return
      const processDetail = response.data.process
      setStageBrowserProcess(processDetail)
      setStageBrowserStages(response.data.stages || [])
      setStageBrowserIsLimb(false)
      setStageBrowserOpen(true)
    } catch {
      showNotification('Failed to load process details', 'error')
    }
  }

  // Open limb assembly workflow dialog — limb is required, process is optional
  const handleOpenLimbWorkflow = useCallback((limb, process = null) => {
    setLimbWorkflowTarget({ limb, process })
    setLimbWorkflowOpen(true)
  }, [])

  // Handle limb process card click — open the native assembly workflow dialog
  const handleLimbProcessClick = async (proc) => {
    try {
      const response = await robotAssemblyService.getLimbProcess(proc.id)
      if (!response.data.success) return
      const detail = response.data.process
      // Find the limb from robotConfig or use a minimal object
      const limb = robotConfig?.limbs?.find(l => l.id === detail.limb_id) || { id: detail.limb_id, name: detail.limb_name }
      handleOpenLimbWorkflow(limb, detail)
    } catch {
      showNotification('Failed to load limb process details', 'error')
    }
  }

  // Handle DOF node click in assembly tree — open workflow dialog for the whole limb
  const handleDOFAssemble = () => {
    handleOpenLimbWorkflow(selectedLimb, null)
  }

  // Open assembly instruction preview for a specific stage from the browser
  const handleBrowserViewStage = (stageKey) => {
    setSelectedProcess(stageBrowserProcess)
    setActiveStage(stageKey)
    setAssemblyPreviewMode(true)
    setAssemblyModalOpen(true)
    setStageBrowserOpen(false)
  }

  // After modal completes a stage, refresh process list
  const handleModalComplete = () => {
    loadProcesses()
    loadLimbProcesses()
  }

  // Get badge display name
  const selectedBadge = badges.find(b => b.id === selectedBadgeId)

  if (loadingBadges) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Container maxWidth={false} sx={{ mt: 0, px: { xs: 1, sm: 1.5 } }}>
      {/* Badge Selector */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RobotIcon color="primary" />
          <Typography variant="h5" sx={{ fontSize: '0.95rem', fontWeight: 600 }}>
            Robot Assembly
          </Typography>
        </Box>

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Badge</InputLabel>
          <Select
            value={selectedBadgeId || ''}
            onChange={handleBadgeChange}
            label="Badge"
          >
            {badges.map((badge) => (
              <MenuItem key={badge.id} value={badge.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      backgroundColor: badge.color,
                    }}
                  />
                  {badge.name}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Breadcrumbs */}
      {(limbSlug || dofNumber || processNumber) && (
        <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />} sx={{ mb: 1 }}>
          <MuiLink
            component="button"
            underline="hover"
            color="inherit"
            onClick={() => navigate(`/robot-assembly?badge=${selectedBadgeId}`)}
          >
            {selectedBadge?.name || 'Robot'}
          </MuiLink>
          {limbSlug && (
            <MuiLink
              component="button"
              underline="hover"
              color={dofNumber ? 'inherit' : 'text.primary'}
              onClick={() => navigate(`/robot-assembly/limb/${limbSlug}?badge=${selectedBadgeId}`)}
            >
              {selectedLimb?.name || limbSlug}
            </MuiLink>
          )}
          {dofNumber && (
            <Typography color="text.primary">DOF {dofNumber}</Typography>
          )}
          {processNumber && (
            <Typography color="text.primary">Process {processNumber}</Typography>
          )}
          {stageNumber && (
            <Typography color="text.primary">Stage {stageNumber}</Typography>
          )}
        </Breadcrumbs>
      )}

      {/* Main Layout: Robot Figure (left) + Process Flexbox (right) */}
      <Box sx={{ display: 'flex', gap: 1.5, flexDirection: { xs: 'column', lg: 'row' } }}>
        {/* Left: Robot Figure */}
        <Box sx={{ flex: '0 0 auto', width: { xs: '100%', lg: '400px' } }}>
          <Paper
            elevation={2}
            sx={{
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              minHeight: 400,
            }}
          >
            {loadingConfig ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
                <CircularProgress />
              </Box>
            ) : robotConfig ? (
              <RobotFigure
                config={robotConfig}
                badgeId={selectedBadgeId}
                selectedLimb={selectedLimb}
                onLimbClick={handleLimbClick}
              />
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 2 }}>
                <RobotIcon sx={{ fontSize: 80, color: 'text.disabled' }} />
                <Typography color="text.secondary" textAlign="center">
                  No robot configured for {selectedBadge?.name || 'this badge'}.
                  <br />
                  Configure in Admin &gt; Robot Assembly.
                </Typography>
              </Box>
            )}
          </Paper>
        </Box>

        {/* Right: Process Flexbox */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Paper elevation={2} sx={{ p: 2, mb: 1 }}>
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setProcessesExpanded(prev => !prev)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="h6" fontWeight={600}>
                  DOF Processes
                </Typography>
                {!processesExpanded && processes.length > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    ({processes.length})
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {processesExpanded && (
                  <ToggleButtonGroup
                    value={processFilter}
                    exclusive
                    onChange={(e, val) => { e.stopPropagation(); val && setProcessFilter(val) }}
                    size="small"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ToggleButton value="active">Active</ToggleButton>
                    <ToggleButton value="completed">History</ToggleButton>
                    <ToggleButton value="all">All</ToggleButton>
                  </ToggleButtonGroup>
                )}
                <IconButton size="small">
                  {processesExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
              </Box>
            </Box>

            <Collapse in={processesExpanded} timeout="auto">
              <Box sx={{ mt: 1 }}>
                <ProcessFlexbox
                  processes={processes}
                  loading={loadingProcesses}
                  onProcessClick={handleProcessClick}
                />
              </Box>
            </Collapse>
          </Paper>

          {/* Limb Assemblies — direct entry point for floor users */}
          {robotConfig?.limbs?.length > 0 && (
            <Paper elevation={2} sx={{ p: 2, mb: 1 }}>
              <Typography variant="h6" fontWeight={600} fontSize="0.9rem" sx={{ mb: 1.5 }}>
                Limb Assemblies
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                {robotConfig.limbs.map((limb) => {
                  const activeProc = limbProcesses.find(p => p.limb_id === limb.id && p.status === 'active')
                  const statusLabel = activeProc
                    ? (activeProc.current_stage_label ? `Stage ${activeProc.current_stage_label}` : 'In Progress')
                    : 'Not started'
                  return (
                    <Paper
                      key={limb.id}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        minWidth: 160,
                        flex: '1 1 160px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                        borderColor: activeProc ? 'primary.main' : 'divider',
                        bgcolor: activeProc ? 'action.hover' : 'background.paper',
                        cursor: 'pointer',
                        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
                      }}
                      onClick={() => handleOpenLimbWorkflow(limb, activeProc || null)}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Box
                          sx={{
                            width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                            bgcolor: limb.color_highlight || 'primary.main',
                          }}
                        />
                        <Typography variant="body2" fontWeight={700} noWrap sx={{ flex: 1 }}>
                          {limb.name}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color={activeProc ? 'primary.main' : 'text.secondary'} sx={{ fontWeight: activeProc ? 600 : 400 }}>
                        {statusLabel}
                      </Typography>
                      <Button
                        variant={activeProc ? 'outlined' : 'contained'}
                        color="primary"
                        size="small"
                        startIcon={<AssembleIcon sx={{ fontSize: 14 }} />}
                        onClick={(e) => { e.stopPropagation(); handleOpenLimbWorkflow(limb, activeProc || null) }}
                        sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0.4 }}
                      >
                        {activeProc ? 'Continue' : 'Start Assembly'}
                      </Button>
                    </Paper>
                  )
                })}
              </Box>
            </Paper>
          )}

          {/* Limb Assembly Processes */}
          {limbProcesses.length > 0 && (
            <Paper elevation={2} sx={{ p: 2, mb: 1 }}>
              <Box
                sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setLimbProcessesExpanded(prev => !prev)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="h6" fontWeight={600} fontSize="0.9rem">
                    Limb Assembly Processes
                  </Typography>
                  {!limbProcessesExpanded && (
                    <Typography variant="caption" color="text.secondary">
                      ({limbProcesses.length})
                    </Typography>
                  )}
                </Box>
                <IconButton size="small">
                  {limbProcessesExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
              </Box>

              <Collapse in={limbProcessesExpanded} timeout="auto">
                <Box sx={{ mt: 1 }}>
                  <LimbProcessFlexbox
                    processes={limbProcesses}
                    loading={loadingLimbProcesses}
                    onProcessClick={handleLimbProcessClick}
                  />
                </Box>
              </Collapse>
            </Paper>
          )}

          {/* Content Area: Limb Assembly Tree (all roles, controls gated inside) */}
          {limbSlug && selectedLimb && (
            <Paper elevation={2} sx={{ p: 2 }}>
              <LimbAssemblyTree
                limb={selectedLimb}
                dofList={limbDOFs}
                onDOFAssemble={handleDOFAssemble}
              />
            </Paper>
          )}
        </Box>
      </Box>

      {/* Stage Instruction Browser Dialog */}
      {stageBrowserProcess && (() => {
        const DOF_STAGE_DEFS = [
          { key: '1', name: 'Created', hasDrawing: false },
          { key: '2', name: 'Picking', hasDrawing: false },
          { key: '3.1', name: 'Motor Assembly', hasDrawing: true },
          { key: '3.2', name: 'Gear Assembly', hasDrawing: true },
          { key: '4', name: 'CHE 1', hasDrawing: false },
          { key: '5', name: 'Motor & Gear Assembly', hasDrawing: true },
          { key: '6', name: 'CHE 2', hasDrawing: false },
          { key: '7', name: 'Actuator Assembly', hasDrawing: true },
          { key: '8', name: 'CHE 3', hasDrawing: false },
          { key: '9', name: 'DOF Assembly', hasDrawing: true },
        ]
        const statusColor = (s) => s === 'completed' ? 'success' : s === 'in_progress' ? 'primary' : 'default'
        const statusLabel = (s) => s === 'completed' ? 'Done' : s === 'in_progress' ? 'Active' : 'Pending'

        if (!stageBrowserIsLimb) {
          const statuses = stageBrowserProcess.stage_statuses || {}
          return (
            <Dialog open={stageBrowserOpen} onClose={() => setStageBrowserOpen(false)} maxWidth="xs" fullWidth>
              <DialogTitle sx={{ pb: 0.5 }}>
                <Typography variant="h6" fontWeight={600} fontSize="1rem">
                  {stageBrowserProcess.process_number} — Assembly Instructions
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Select a stage to view its assembly instructions
                </Typography>
              </DialogTitle>
              <DialogContent sx={{ p: 0 }}>
                <List dense disablePadding>
                  {DOF_STAGE_DEFS.map((def, idx) => {
                    const rawStatus = statuses[def.key]
                    const status = rawStatus === 'completed' ? 'completed' : rawStatus === 'in_progress' ? 'in_progress' : 'pending'
                    return (
                      <ListItem
                        key={def.key}
                        divider={idx < DOF_STAGE_DEFS.length - 1}
                        sx={{ py: 0.75, px: 2 }}
                        secondaryAction={
                          def.hasDrawing ? (
                            <MuiTooltip title="View assembly instructions">
                              <IconButton size="small" color="primary" onClick={() => handleBrowserViewStage(def.key)}>
                                <EyeIcon fontSize="small" />
                              </IconButton>
                            </MuiTooltip>
                          ) : (
                            <MuiTooltip title="No drawing for this stage">
                              <span>
                                <IconButton size="small" disabled>
                                  <NoDrawingIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </MuiTooltip>
                          )
                        }
                      >
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography variant="body2" fontFamily="monospace" fontWeight={700} sx={{ minWidth: 28 }}>
                                {def.key}
                              </Typography>
                              <Typography variant="body2">{def.name}</Typography>
                              {status !== 'pending' && <Chip label={statusLabel(status)} color={statusColor(status)} size="small" sx={{ height: 18, fontSize: '0.6rem', ml: 'auto', mr: 4 }} />}
                            </Box>
                          }
                        />
                      </ListItem>
                    )
                  })}
                </List>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setStageBrowserOpen(false)}>Close</Button>
              </DialogActions>
            </Dialog>
          )
        }

        // Limb process — dynamic stages
        const limbStages = stageBrowserStages
        const phaseColor = (p) => p === 'completed' ? 'success' : (p === 'picking' || p === 'assembly') ? 'primary' : p === 'skipped' ? 'default' : 'default'
        const phaseLabel = (p) => p === 'completed' ? 'Done' : p === 'picking' ? 'Picking' : p === 'assembly' ? 'Active' : p === 'skipped' ? 'Skip' : 'Pending'
        return (
          <Dialog open={stageBrowserOpen} onClose={() => setStageBrowserOpen(false)} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ pb: 0.5 }}>
              <Typography variant="h6" fontWeight={600} fontSize="1rem">
                {stageBrowserProcess.process_number} — Assembly Instructions
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Select a stage to view its assembly instructions
              </Typography>
            </DialogTitle>
            <DialogContent sx={{ p: 0 }}>
              <List dense disablePadding>
                {limbStages.map((s, idx) => (
                  <ListItem
                    key={s.id || s.stage_label}
                    divider={idx < limbStages.length - 1}
                    sx={{ py: 0.75, px: 2 }}
                    secondaryAction={
                      <MuiTooltip title="View assembly instructions">
                        <IconButton size="small" color="primary" onClick={() => handleBrowserViewStage(s.stage_label)}>
                          <EyeIcon fontSize="small" />
                        </IconButton>
                      </MuiTooltip>
                    }
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" fontFamily="monospace" fontWeight={700} sx={{ minWidth: 40 }}>
                            {s.stage_label}
                          </Typography>
                          <Typography variant="body2" noWrap sx={{ flex: 1 }}>{s.display_name || s.stage_name}</Typography>
                          {s.phase !== 'pending' && <Chip label={phaseLabel(s.phase)} color={phaseColor(s.phase)} size="small" sx={{ height: 18, fontSize: '0.6rem', mr: 4 }} />}
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setStageBrowserOpen(false)}>Close</Button>
            </DialogActions>
          </Dialog>
        )
      })()}

      {/* Picking Modal (Stage 2) */}
      <PickingModal
        open={pickingModalOpen}
        onClose={() => {
          setPickingModalOpen(false)
          setSelectedProcess(null)
        }}
        process={selectedProcess}
        onComplete={handleModalComplete}
      />

      {/* Assembly Stage Modal (Stages 3-9) — opened from deep links or instruction browser */}
      <AssemblyStageModal
        open={assemblyModalOpen}
        onClose={() => {
          setAssemblyModalOpen(false)
          setSelectedProcess(null)
          setActiveStage(null)
          setAssemblyPreviewMode(false)
        }}
        process={selectedProcess}
        stage={activeStage}
        onComplete={handleModalComplete}
        previewMode={assemblyPreviewMode}
      />

      {/* Limb Picking Modal */}
      <LimbPickingModal
        open={limbPickingOpen}
        onClose={() => {
          setLimbPickingOpen(false)
          setSelectedLimbProcess(null)
          setActiveLimbStage(null)
        }}
        process={selectedLimbProcess}
        stageLabel={activeLimbStage}
        onComplete={handleModalComplete}
      />

      {/* Limb Assembly Modal */}
      <LimbAssemblyModal
        open={limbAssemblyOpen}
        onClose={() => {
          setLimbAssemblyOpen(false)
          setSelectedLimbProcess(null)
          setActiveLimbStage(null)
        }}
        process={selectedLimbProcess}
        stageLabel={activeLimbStage}
        onComplete={handleModalComplete}
      />

      {/* Native Limb Assembly Workflow Dialog */}
      <LimbAssemblyWorkflowDialog
        open={limbWorkflowOpen}
        onClose={() => {
          setLimbWorkflowOpen(false)
          setLimbWorkflowTarget({ limb: null, process: null })
          loadLimbProcesses()
        }}
        limb={limbWorkflowTarget.limb}
        badgeId={selectedBadgeId}
        initialProcess={limbWorkflowTarget.process}
        isAdmin={user?.role === 'admin' || user?.can_access_admin}
      />
    </Container>
  )
}

export default RobotAssembly
