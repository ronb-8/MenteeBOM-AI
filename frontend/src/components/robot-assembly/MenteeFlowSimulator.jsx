import { useState, useEffect } from 'react'
import {
  Box,
  Typography,
  Button,
  TextField,
  Paper,
  Chip,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Grid,
  CircularProgress,
  Divider,
  IconButton,
  Tooltip,
  Link,
} from '@mui/material'
import {
  PlayArrow as PlayIcon,
  Add as AddIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckIcon,
  RadioButtonUnchecked as PendingIcon,
  HourglassEmpty as InProgressIcon,
  Delete as DeleteIcon,
  OpenInNew as OpenInNewIcon,
  CallSplit as ParallelIcon,
} from '@mui/icons-material'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'

const STAGE_ORDER = [2, 3.1, 3.2, 4, 5, 6]

const stageStatusIcon = (status) => {
  if (status === 'completed') return <CheckIcon color="success" fontSize="small" />
  if (status === 'in_progress') return <InProgressIcon color="warning" fontSize="small" />
  return <PendingIcon color="disabled" fontSize="small" />
}

const MenteeFlowSimulator = () => {
  const { showNotification } = useNotification()

  const [availableDOFs, setAvailableDOFs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDOF, setSelectedDOF] = useState('')
  const [processNumber, setProcessNumber] = useState('')
  const [processName, setProcessName] = useState('')
  const [creating, setCreating] = useState(false)

  // Active simulated processes
  const [processes, setProcesses] = useState([])

  // Response log
  const [responseLog, setResponseLog] = useState([])

  useEffect(() => {
    loadAvailableDOFs()
  }, [])

  const loadAvailableDOFs = async () => {
    setLoading(true)
    try {
      const response = await robotAssemblyService.devGetAvailableDOFs()
      if (response.data.success) {
        setAvailableDOFs(response.data.dofs)
      }
    } catch (error) {
      if (error.response?.status === 403) {
        showNotification('Simulator only available on dev server', 'warning')
      }
    } finally {
      setLoading(false)
    }
  }

  const addLog = (action, response, isError = false) => {
    setResponseLog(prev => [{
      time: new Date().toLocaleTimeString(),
      action,
      status: isError ? 'error' : 'success',
      data: response,
    }, ...prev].slice(0, 20))
  }

  // When DOF is selected, auto-generate a process number
  const handleDOFSelect = (dofId) => {
    setSelectedDOF(dofId)
    const dof = availableDOFs.find(d => d.dof_id === dofId)
    if (dof) {
      const suffix = String(Math.floor(Math.random() * 900) + 100)
      setProcessNumber(`${dof.badge_digit}-${dof.dof_number}-${suffix}`)
      setProcessName(`${dof.limb_name} ${dof.dof_name} #${suffix}`)
    }
  }

  const handleCreateProcess = async () => {
    if (!processNumber) return
    setCreating(true)
    try {
      const response = await robotAssemblyService.devCreateProcess({
        process_number: processNumber,
        name: processName || `Dev Process ${processNumber}`,
      })
      addLog(`CREATE ${processNumber}`, response.data)
      showNotification(response.data.message || 'Process created', 'success')
      await loadProcessStatus(processNumber)
      setProcessNumber('')
      setProcessName('')
      setSelectedDOF('')
    } catch (error) {
      const errMsg = error.response?.data?.error || 'Failed to create process'
      addLog(`CREATE ${processNumber}`, { error: errMsg }, true)
      showNotification(errMsg, 'error')
    } finally {
      setCreating(false)
    }
  }

  const loadProcessStatus = async (pn) => {
    try {
      const response = await robotAssemblyService.devGetProcessStatus(pn)
      if (response.data.success) {
        setProcesses(prev => {
          const existing = prev.findIndex(p => p.process_number === pn)
          const updated = { ...response.data }
          if (existing >= 0) {
            const newList = [...prev]
            newList[existing] = updated
            return newList
          }
          return [updated, ...prev]
        })
      }
    } catch (error) {
      console.error('Failed to load process status:', error)
    }
  }

  const handleAdvanceStage = async (processNumber, stage) => {
    try {
      const response = await robotAssemblyService.devAdvanceProcess({
        process_number: processNumber,
        stage: stage,
      })
      addLog(`ADVANCE ${processNumber} → Stage ${stage}`, response.data)
      showNotification(response.data.message || `Stage ${stage} activated`, 'success')
      await loadProcessStatus(processNumber)
    } catch (error) {
      const errMsg = error.response?.data?.error || 'Failed to advance'
      addLog(`ADVANCE ${processNumber} → Stage ${stage}`, { error: errMsg }, true)
      showNotification(errMsg, 'error')
    }
  }

  const handleRemoveProcess = (pn) => {
    setProcesses(prev => prev.filter(p => p.process_number !== pn))
  }

  /** Build the deep-link URL for a stage */
  const getStageDeepLink = (processNumber, stageNum) => {
    return `/robot-assembly/process/${processNumber}/stage/${stageNum}`
  }

  /** Open a stage deep-link in a new window */
  const openStageInNewWindow = (processNumber, stageNum) => {
    const url = getStageDeepLink(processNumber, stageNum)
    window.open(url, `menteebom-stage-${processNumber}-${stageNum}`, 'width=1200,height=800')
  }

  if (loading) return <CircularProgress size={20} />

  return (
    <Box>
      <Alert severity="warning" sx={{ mb: 2 }}>
        <strong>DEV ONLY</strong> — This simulates MenteeFlow API calls to test the process workflow.
        These endpoints are disabled on the production server.
      </Alert>

      {/* Create Process */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
          Simulate: Create Process
        </Typography>

        <Grid container spacing={2} alignItems="flex-end">
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel>Select DOF</InputLabel>
              <Select
                value={selectedDOF}
                label="Select DOF"
                onChange={(e) => handleDOFSelect(e.target.value)}
              >
                {availableDOFs.map((dof) => (
                  <MenuItem key={dof.dof_id} value={dof.dof_id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip label={dof.badge_name} size="small" sx={{ fontSize: '0.7rem', height: 20 }} />
                      <Typography variant="body2">
                        {dof.limb_name} / DOF #{dof.dof_number} — {dof.dof_name}
                      </Typography>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              label="Process Number (X-XXX-XXX)"
              value={processNumber}
              onChange={(e) => setProcessNumber(e.target.value)}
              placeholder="2-200-001"
              inputProps={{ style: { fontFamily: 'monospace', fontWeight: 700 } }}
            />
          </Grid>

          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              label="Process Name"
              value={processName}
              onChange={(e) => setProcessName(e.target.value)}
              placeholder="Right Arm Shoulder DOF"
            />
          </Grid>

          <Grid item xs={12} md={2}>
            <Button
              fullWidth
              variant="contained"
              color="primary"
              startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
              onClick={handleCreateProcess}
              disabled={!processNumber || creating}
            >
              Create
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Active Simulated Processes */}
      {processes.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
            Simulated Processes
          </Typography>

          {processes.map((proc) => {
            // Identify parallel stages (3.1 and 3.2)
            const stage31 = proc.stages?.find(s => String(s.stage_number) === '3.1')
            const stage32 = proc.stages?.find(s => String(s.stage_number) === '3.2')
            const hasParallel = stage31 && stage32

            return (
              <Paper
                key={proc.process_number}
                variant="outlined"
                sx={{ p: 1.5, mb: 1.5, bgcolor: 'background.default' }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography fontFamily="monospace" fontWeight={700} fontSize="0.95rem">
                    {proc.process_number}
                  </Typography>
                  <Chip label={proc.badge} size="small" color="primary" sx={{ fontSize: '0.7rem', height: 20 }} />
                  <Typography variant="body2" color="text.secondary">
                    {proc.limb} / {proc.dof_name}
                  </Typography>
                  <Chip
                    label={proc.status}
                    size="small"
                    color={proc.status === 'active' ? 'success' : 'default'}
                    sx={{ fontSize: '0.7rem', height: 20, ml: 'auto' }}
                  />
                  <Tooltip title="Refresh status">
                    <IconButton size="small" onClick={() => loadProcessStatus(proc.process_number)}>
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remove from list">
                    <IconButton size="small" onClick={() => handleRemoveProcess(proc.process_number)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* Stage buttons + deep links */}
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                  {proc.stages?.map((stage) => {
                    const stageLabel = stage.stage_name
                    const canAdvance = stage.status === 'pending'
                    const stageNum = stage.stage_number
                    const isParallel = stageNum === 3.1 || stageNum === 3.2

                    return (
                      <Box key={stageNum} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        {/* Parallel indicator before 3.1 */}
                        {stageNum === 3.1 && (
                          <Tooltip title="Stages 3.1 & 3.2 run in parallel">
                            <ParallelIcon sx={{ fontSize: 14, color: 'info.main', mr: 0.25 }} />
                          </Tooltip>
                        )}

                        <Tooltip
                          title={
                            stage.status === 'completed' ? `${stageLabel}: Completed`
                              : stage.status === 'in_progress' ? `${stageLabel}: In Progress — click link icon to open in MenteeBOM`
                              : `Click to advance to ${stageLabel}`
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              variant={stage.status === 'in_progress' ? 'contained' : 'outlined'}
                              color={
                                stage.status === 'completed' ? 'success'
                                  : stage.status === 'in_progress' ? 'warning'
                                  : 'inherit'
                              }
                              startIcon={stageStatusIcon(stage.status)}
                              onClick={() => handleAdvanceStage(proc.process_number, stageNum)}
                              disabled={!canAdvance || stageNum === 1}
                              sx={{
                                fontSize: '0.7rem',
                                py: 0.3,
                                textTransform: 'none',
                                opacity: stageNum === 1 ? 0.7 : 1,
                                borderRight: (stage.status === 'in_progress' && stageNum !== 1)
                                  ? 'none' : undefined,
                                borderTopRightRadius: (stage.status === 'in_progress' && stageNum !== 1)
                                  ? 0 : undefined,
                                borderBottomRightRadius: (stage.status === 'in_progress' && stageNum !== 1)
                                  ? 0 : undefined,
                              }}
                            >
                              {stageNum === 1 ? 'Created' : `${stageNum}: ${stageLabel}`}
                            </Button>
                          </span>
                        </Tooltip>

                        {/* Deep-link button — shown for in_progress or completed stages (not stage 1) */}
                        {stageNum !== 1 && (stage.status === 'in_progress' || stage.status === 'completed') && (
                          <Tooltip title={`Open Stage ${stageNum} in MenteeBOM (new window)`}>
                            <IconButton
                              size="small"
                              onClick={() => openStageInNewWindow(proc.process_number, stageNum)}
                              sx={{
                                border: '1px solid',
                                borderColor: stage.status === 'in_progress' ? 'warning.main' : 'success.main',
                                borderLeft: 'none',
                                borderTopLeftRadius: 0,
                                borderBottomLeftRadius: 0,
                                borderTopRightRadius: 4,
                                borderBottomRightRadius: 4,
                                bgcolor: stage.status === 'in_progress'
                                  ? 'rgba(237, 108, 2, 0.08)'
                                  : 'rgba(46, 125, 50, 0.08)',
                                height: 28,
                                width: 28,
                              }}
                            >
                              <OpenInNewIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                        )}

                        {/* Parallel bracket end after 3.2 */}
                        {stageNum === 3.2 && (
                          <Tooltip title="Stages 3.1 & 3.2 run in parallel">
                            <ParallelIcon sx={{ fontSize: 14, color: 'info.main', ml: 0.25, transform: 'scaleX(-1)' }} />
                          </Tooltip>
                        )}
                      </Box>
                    )
                  })}
                </Box>

                {/* Deep-link URLs display for in-progress stages */}
                {proc.stages?.some(s => s.status === 'in_progress' && s.stage_number !== 1) && (
                  <Box sx={{ mt: 1, pt: 1, borderTop: '1px dashed', borderColor: 'divider' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                      MenteeBOM Deep Links (for MenteeFlow integration):
                    </Typography>
                    {proc.stages.filter(s => s.status === 'in_progress' && s.stage_number !== 1).map((stage) => (
                      <Box key={stage.stage_number} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                        <Chip
                          label={`${stage.stage_number}`}
                          size="small"
                          color="warning"
                          sx={{ fontSize: '0.65rem', height: 18, minWidth: 32 }}
                        />
                        <Link
                          href={getStageDeepLink(proc.process_number, stage.stage_number)}
                          target="_blank"
                          rel="noopener"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                            wordBreak: 'break-all',
                          }}
                        >
                          {window.location.origin}{getStageDeepLink(proc.process_number, stage.stage_number)}
                        </Link>
                        <Tooltip title="Open in new window">
                          <IconButton
                            size="small"
                            onClick={() => openStageInNewWindow(proc.process_number, stage.stage_number)}
                          >
                            <OpenInNewIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    ))}
                  </Box>
                )}
              </Paper>
            )
          })}
        </Paper>
      )}

      {/* Response Log */}
      {responseLog.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              API Response Log
            </Typography>
            <Button size="small" onClick={() => setResponseLog([])}>Clear</Button>
          </Box>

          <Box sx={{ maxHeight: '35vh', overflow: 'auto' }}>
            {responseLog.map((log, i) => (
              <Box
                key={i}
                sx={{
                  display: 'flex',
                  gap: 1,
                  py: 0.5,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  alignItems: 'flex-start',
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 70, fontFamily: 'monospace' }}>
                  {log.time}
                </Typography>
                <Chip
                  label={log.status}
                  size="small"
                  color={log.status === 'error' ? 'error' : 'success'}
                  sx={{ fontSize: '0.65rem', height: 18 }}
                />
                <Typography variant="caption" fontWeight={600} sx={{ minWidth: 180, fontFamily: 'monospace' }}>
                  {log.action}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                  {JSON.stringify(log.data, null, 0).substring(0, 200)}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {availableDOFs.length === 0 && !loading && (
        <Alert severity="info">
          No DOFs configured yet. Add limbs with assemblies and set DOF mappings in the Robot Configurations section first.
        </Alert>
      )}
    </Box>
  )
}

export default MenteeFlowSimulator
