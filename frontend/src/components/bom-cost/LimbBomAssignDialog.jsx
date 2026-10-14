import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Checkbox, List, ListItem, ListItemButton,
  ListItemIcon, ListItemText, Typography, Box, Chip, CircularProgress,
} from '@mui/material'
import { formatPrice } from '../../utils/priceFormatter'
import { bomCostService } from '../../services/bomCostService'

const LimbBomAssignDialog = ({ open, onClose, limb, badgeId, onSaved }) => {
  const [selectedKeys, setSelectedKeys] = useState([]) // ['dissolved-5', 'bom-12']
  const [dissolvedBoms, setDissolvedBoms] = useState([])
  const [regularBoms, setRegularBoms] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Load available BOMs when dialog opens
  useEffect(() => {
    if (open && badgeId) {
      loadAvailable()
    }
  }, [open, badgeId])

  // Initialize selection from limb's current assigned_items
  useEffect(() => {
    if (limb && open) {
      const keys = (limb.assigned_items || []).map(it =>
        it.type === 'dissolved' ? `dissolved-${it.dissolved_bom_id}` : `bom-${it.bom_id}`
      )
      setSelectedKeys(keys)
    }
  }, [limb, open])

  const loadAvailable = async () => {
    setLoading(true)
    try {
      const res = await bomCostService.getAvailableBoms(badgeId)
      setDissolvedBoms(res.data.dissolved_boms || [])
      setRegularBoms(res.data.boms || [])
    } catch (err) {
      console.error('Failed to load available BOMs:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = (key) => {
    setSelectedKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  const handleSave = async () => {
    if (!limb) return
    setSaving(true)
    try {
      // Convert keys to items array for the API
      const items = selectedKeys.map(key => {
        const [type, id] = key.split('-')
        return { type, id: parseInt(id) }
      })
      await bomCostService.updateLimbMappings(limb.id, items)
      onSaved?.()
      onClose()
    } catch (err) {
      console.error('Failed to save limb mappings:', err)
    } finally {
      setSaving(false)
    }
  }

  const currentKeys = new Set(
    (limb?.assigned_items || []).map(it =>
      it.type === 'dissolved' ? `dissolved-${it.dissolved_bom_id}` : `bom-${it.bom_id}`
    )
  )
  const hasChanges = (() => {
    if (selectedKeys.length !== currentKeys.size) return true
    return selectedKeys.some(k => !currentKeys.has(k))
  })()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">
            Assign BOMs to {limb?.name || 'Limb'}
          </Typography>
          <Chip
            label={`${selectedKeys.length} selected`}
            size="small"
            color="primary"
            variant="outlined"
          />
        </Box>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (dissolvedBoms.length === 0 && regularBoms.length === 0) ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography color="text.secondary">No BOMs available</Typography>
          </Box>
        ) : (
          <List dense sx={{ py: 0 }}>
            {/* Dissolved BOMs section */}
            {dissolvedBoms.length > 0 && (
              <>
                <ListItem sx={{ bgcolor: 'action.hover', py: 0.5 }}>
                  <ListItemText
                    primary="Dissolved BOMs (Limbs BOM)"
                    primaryTypographyProps={{ variant: 'caption', fontWeight: 700, color: 'text.secondary' }}
                  />
                </ListItem>
                {dissolvedBoms.map(d => {
                  const key = `dissolved-${d.id}`
                  const isChecked = selectedKeys.includes(key)
                  return (
                    <ListItem key={key} disablePadding divider>
                      <ListItemButton onClick={() => handleToggle(key)} dense>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <Checkbox edge="start" checked={isChecked} tabIndex={-1} size="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={d.name}
                          secondary={`${d.parts_count} parts • ${d.dissolve_mode || 'full'}`}
                          primaryTypographyProps={{ variant: 'body2', fontWeight: isChecked ? 600 : 400 }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.main' }}>
                          ${formatPrice(d.cost || 0)}
                        </Typography>
                      </ListItemButton>
                    </ListItem>
                  )
                })}
              </>
            )}

            {/* Regular BOMs section */}
            {regularBoms.length > 0 && (
              <>
                <ListItem sx={{ bgcolor: 'action.hover', py: 0.5 }}>
                  <ListItemText
                    primary="Regular BOMs"
                    primaryTypographyProps={{ variant: 'caption', fontWeight: 700, color: 'text.secondary' }}
                  />
                </ListItem>
                {regularBoms.map(b => {
                  const key = `bom-${b.id}`
                  const isChecked = selectedKeys.includes(key)
                  return (
                    <ListItem key={key} disablePadding divider>
                      <ListItemButton onClick={() => handleToggle(key)} dense>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <Checkbox edge="start" checked={isChecked} tabIndex={-1} size="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary={b.name}
                          secondary={b.assembly_part_number || ''}
                          primaryTypographyProps={{ variant: 'body2', fontWeight: isChecked ? 600 : 400 }}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>
                          ${formatPrice(b.cost || 0)}
                        </Typography>
                      </ListItemButton>
                    </ListItem>
                  )
                })}
              </>
            )}
          </List>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          size="small"
          disabled={saving || !hasChanges}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default LimbBomAssignDialog
