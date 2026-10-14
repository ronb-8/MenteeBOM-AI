import { useState, useEffect } from 'react'
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Box,
  Grid,
  Chip,
} from '@mui/material'
import { Storage as DatabaseIcon, Search as SearchIcon, Label as LabelIcon, Cancel as CancelIcon } from '@mui/icons-material'
import { useNotification } from '../context/NotificationContext'
import { pdmService } from '../services/pdmService'
import { adminService } from '../services/adminService'
import ResizableDialog from './ResizableDialog'

const PDMImportModal = ({ onClose, onSuccess }) => {
  const { showNotification } = useNotification()
  const [partName, setPartName] = useState('')
  const [bomLayout, setBomLayout] = useState('MenteeBOM')
  const [configuration, setConfiguration] = useState('Default')
  const [outputMode, setOutputMode] = useState('json')
  const [badgeId, setBadgeId] = useState('')
  const [badges, setBadges] = useState([])
  const [loadingBadges, setLoadingBadges] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeProcesses, setActiveProcesses] = useState([])
  const [pollingInterval, setPollingInterval] = useState(null)

  useEffect(() => {
    loadBadges()
  }, [])

  useEffect(() => {
    // Cleanup polling on unmount
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [pollingInterval])

  const loadBadges = async () => {
    setLoadingBadges(true)
    try {
      const response = await adminService.getBadges()
      setBadges(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      console.error('Error loading badges:', error)
    } finally {
      setLoadingBadges(false)
    }
  }

  const startProcessPolling = () => {
    // Poll for active processes every 2 seconds
    const interval = setInterval(async () => {
      try {
        const response = await adminService.getPDMProcessStatus()
        setActiveProcesses(response.data.active_processes || [])

        // Stop polling if no active processes
        if (response.data.count === 0) {
          clearInterval(interval)
          setPollingInterval(null)
        }
      } catch (error) {
        console.error('Error polling process status:', error)
      }
    }, 2000)

    setPollingInterval(interval)
  }

  const handleCancelImport = async () => {
    if (!window.confirm('Are you sure you want to cancel the import? This will terminate the running process.')) {
      return
    }

    try {
      console.log('Attempting to cancel import...')
      const response = await adminService.killAllPDMProcesses()
      console.log('Cancel response:', response)

      if (response.data.success) {
        console.log('Cancellation successful, closing modal')
        showNotification('Import cancelled successfully', 'info')
        setLoading(false)
        setActiveProcesses([])
        if (pollingInterval) {
          clearInterval(pollingInterval)
          setPollingInterval(null)
        }
        onClose() // Close the modal to give clear feedback
      } else {
        console.error('Cancellation failed:', response.data)
        showNotification(response.data.message || 'Failed to cancel import', 'error')
      }
    } catch (error) {
      console.error('Error cancelling import:', error)
      showNotification('Error cancelling import', 'error')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!partName.trim()) {
      showNotification('Please enter a part name', 'warning')
      return
    }
    // Validate project badge is required
    if (!badgeId) {
      showNotification('Please select a project badge', 'warning')
      return
    }

    setLoading(true)
    startProcessPolling() // Start polling for active processes

    try {
      const formData = new FormData()
      formData.append('part_name', partName.trim())
      formData.append('bom_layout', bomLayout)
      formData.append('configuration', configuration)
      formData.append('output_mode', outputMode)
      formData.append('badge_id', badgeId)

      const response = await pdmService.importBOMByName(formData)
      if (response.data.success) {
        showNotification('BOM imported successfully', 'success')
        onSuccess()
        onClose()
      } else {
        // Check if the import was cancelled
        if (response.data.cancelled) {
          showNotification('BOM import was cancelled', 'info')
          setLoading(false)
          if (pollingInterval) {
            clearInterval(pollingInterval)
            setPollingInterval(null)
          }
        } else {
          showNotification(response.data.error || 'Error importing BOM', 'error')
        }
      }
    } catch (error) {
      console.error('Error importing BOM:', error)
      // Check if the error indicates cancellation
      if (error.response?.data?.cancelled) {
        showNotification('BOM import was cancelled', 'info')
        setLoading(false)
        if (pollingInterval) {
          clearInterval(pollingInterval)
          setPollingInterval(null)
        }
      } else {
        showNotification(error.response?.data?.error || 'Error importing BOM', 'error')
      }
    } finally {
      setLoading(false)
      if (pollingInterval) {
        clearInterval(pollingInterval)
        setPollingInterval(null)
      }
    }
  }

  return (
    <ResizableDialog id="pdmImportModal" open={true} onClose={onClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DatabaseIcon />
            Import BOM by Part Name
          </Box>
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 3 }}>
            <strong>Part Name Search:</strong> Enter the part name (e.g., "029-AS-00855") and the system will search for the file in the PDM vault.
          </Alert>

          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid item xs={12} md={6}>
              <TextField
                autoFocus
                fullWidth
                label="Part Name"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                placeholder="e.g., 029-AS-00855"
                required
                disabled={loading}
                helperText="Enter the unique part name to search for in PDM"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>BOM Layout</InputLabel>
                <Select
                  value={bomLayout}
                  label="BOM Layout"
                  onChange={(e) => setBomLayout(e.target.value)}
                  disabled={loading}
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
                label="Configuration"
                value={configuration}
                onChange={(e) => setConfiguration(e.target.value)}
                disabled={loading}
                helperText="SolidWorks configuration name"
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth>
                <InputLabel>Output Mode</InputLabel>
                <Select
                  value={outputMode}
                  label="Output Mode"
                  onChange={(e) => setOutputMode(e.target.value)}
                  disabled={loading}
                >
                  <MenuItem value="console">Console Output</MenuItem>
                  <MenuItem value="json">JSON File (with thumbnails)</MenuItem>
                  <MenuItem value="both">Both</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                JSON mode includes thumbnail images for visual BOMs
              </Typography>
            </Grid>
            <Grid item xs={12} md={6}>
              <FormControl fullWidth required>
                <InputLabel>Project Badge</InputLabel>
                <Select
                  value={badgeId}
                  label="Project Badge"
                  onChange={(e) => setBadgeId(e.target.value)}
                  disabled={loading || loadingBadges}
                  required
                >
                  {badges.map((badge) => (
                    <MenuItem key={badge.id} value={badge.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={badge.name}
                          size="small"
                          sx={{
                            backgroundColor: badge.color,
                            color: '#fff',
                            fontWeight: 'bold',
                            height: 20,
                          }}
                        />
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Select a project badge to organize this BOM (required)
              </Typography>
            </Grid>
          </Grid>

          <Alert severity="warning" sx={{ mt: 3 }}>
            <strong>Note:</strong> The system will search for files with the specified part name in common PDM vault locations.
            If multiple files are found, the first match will be used.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={loading}>
            Close
          </Button>
          {loading && (
            <Button
              type="button"
              onClick={handleCancelImport}
              color="error"
              variant="outlined"
              startIcon={<CancelIcon />}
            >
              Cancel Import
            </Button>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <SearchIcon />}
          >
            {loading ? 'Searching and Importing...' : 'Search and Import'}
          </Button>
        </DialogActions>
      </form>
    </ResizableDialog>
  )
}

export default PDMImportModal
