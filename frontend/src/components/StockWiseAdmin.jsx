import { useState, useEffect } from 'react'
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  CircularProgress,
  Button,
  TextField,
  Alert,
  Chip,
  IconButton,
  InputAdornment,
  Tooltip,
  Divider,
  Switch,
  FormControlLabel,
} from '@mui/material'
import {
  VpnKey as KeyIcon,
  ContentCopy as CopyIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material'
import { useNotification } from '../context/NotificationContext'
import { stockwiseService } from '../services/stockwiseService'

const StockWiseAdmin = () => {
  const { showNotification } = useNotification()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState(null)
  const [keyValue, setKeyValue] = useState('')
  const [showKey, setShowKey] = useState(false)

  const loadConfig = async () => {
    setLoading(true)
    try {
      const response = await stockwiseService.getConfig()
      setConfig(response.data)
      setKeyValue(response.data.api_key || '')
    } catch (error) {
      showNotification('Failed to load StockWise config: ' + (error.response?.data?.error || error.message), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadConfig() }, [])

  const generateSecureKey = (length = 32) => {
    const array = new Uint8Array(length)
    crypto.getRandomValues(array)
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
  }

  const handleSave = async (value) => {
    setSaving(true)
    try {
      const response = await stockwiseService.setApiKey(value)
      setConfig(response.data)
      setKeyValue(response.data.api_key || '')
      showNotification(response.data.message, value ? 'success' : 'info')
    } catch (error) {
      showNotification('Failed to save: ' + (error.response?.data?.error || error.message), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleWrites = async (enabled) => {
    setSaving(true)
    try {
      const response = await stockwiseService.setWritesEnabled(enabled)
      setConfig(response.data)
      showNotification(response.data.message, enabled ? 'warning' : 'info')
    } catch (error) {
      showNotification('Failed to update write toggle: ' + (error.response?.data?.error || error.message), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = () => {
    if (!window.confirm('Disable the StockWise API? The current key will stop working immediately.')) return
    handleSave('')
  }

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
  }

  const keyChanged = keyValue !== (config?.api_key || '')

  return (
    <Card>
      <CardHeader
        title="StockWise API"
        subheader="Read-only integration key for the StockWise storage-location app"
        action={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {config?.environment && (
              <Chip size="small" variant="outlined" label={`env: ${config.environment}`} />
            )}
            <Chip
              size="small"
              label={config?.configured ? 'Enabled' : 'Disabled'}
              color={config?.configured ? 'success' : 'default'}
            />
            <IconButton size="small" onClick={loadConfig} title="Refresh">
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Box>
        }
      />
      <CardContent>
        {!config?.dev_database && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            This server is running on the <b>production database</b>. The StockWise API refuses all
            requests here by design — it only serves the dev server. You can still manage the key,
            but it will only be usable on dev.
          </Alert>
        )}
        {config?.env_override && (
          <Alert severity="info" sx={{ mb: 2 }}>
            The <code>STOCKWISE_API_KEY</code> environment variable is set on this server and
            overrides any key saved here.
          </Alert>
        )}

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', maxWidth: 720 }}>
          <TextField
            fullWidth
            size="small"
            label="API Key (X-StockWise-API-Key header)"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            type={showKey ? 'text' : 'password'}
            helperText={keyChanged
              ? 'Unsaved change — click Save to apply. Saving replaces the previous key immediately.'
              : (config?.configured ? `Source: ${config.key_source === 'env' ? 'environment variable' : 'saved key file'}` : 'No key configured — the StockWise API is disabled.')}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShowKey(!showKey)} title={showKey ? 'Hide' : 'Show'}>
                    {showKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                  </IconButton>
                  {keyValue && (
                    <IconButton
                      size="small"
                      onClick={() => { navigator.clipboard.writeText(keyValue); showNotification('Key copied to clipboard', 'success') }}
                      title="Copy"
                    >
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
              onClick={() => setKeyValue(generateSecureKey())}
              sx={{ minWidth: 'auto', px: 1.5, mt: 0.25 }}
            >
              <KeyIcon fontSize="small" />
            </Button>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<SaveIcon />}
            disabled={saving || !keyValue || !keyChanged}
            onClick={() => handleSave(keyValue)}
          >
            Save Key
          </Button>
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<DeleteIcon />}
            disabled={saving || !config?.configured}
            onClick={handleClear}
          >
            Disable Integration
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Warehouse Box writes</Typography>
        <FormControlLabel
          control={
            <Switch
              checked={Boolean(config?.writes_enabled)}
              disabled={saving || !config?.configured}
              onChange={(e) => handleToggleWrites(e.target.checked)}
            />
          }
          label={config?.writes_enabled
            ? 'Enabled — the API key above can also update warehouse_box_number (nothing else)'
            : 'Disabled — the API is fully read-only'}
        />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          Applies to this server&apos;s environment only ({config?.environment}). Takes effect immediately, no restart needed.
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>Usage</Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          The StockWise API is <b>read-only</b> and served <b>only by the dev server</b> (dev database).
          All requests need the <code>X-StockWise-API-Key</code> header. Base path: <code>{config?.base_path}</code>.
          Full reference: <code>docs/STOCKWISE_INTEGRATION.md</code>.
        </Typography>
        <Box
          component="pre"
          sx={{
            mt: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1,
            fontSize: '0.75rem', fontFamily: 'monospace', overflowX: 'auto',
          }}
        >
          {`curl -H "X-StockWise-API-Key: <key>" http://<dev-host>:5000/api/stockwise/v1/ping`}
        </Box>
      </CardContent>
    </Card>
  )
}

export default StockWiseAdmin
