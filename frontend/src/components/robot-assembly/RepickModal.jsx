import { useState } from 'react'
import {
  Box,
  Typography,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Checkbox,
  Avatar,
  List,
  ListItem,
  Divider,
  CircularProgress,
  Chip,
  Alert,
  useTheme,
} from '@mui/material'
import {
  Close as CloseIcon,
  Image as ImageIcon,
  CheckCircle as CheckCircleIcon,
  ShoppingCart as PickIcon,
} from '@mui/icons-material'
import ResizableDialog from '../ResizableDialog'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'

const RepickModal = ({ open, onClose, process, missingParts, onComplete, customRepickFn }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showNotification } = useNotification()

  const [selectedParts, setSelectedParts] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)

  const handleTogglePart = (idx) => {
    setSelectedParts(prev => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const handleToggleAll = () => {
    if (selectedParts.size === (missingParts || []).length) {
      setSelectedParts(new Set())
    } else {
      setSelectedParts(new Set((missingParts || []).map((_, i) => i)))
    }
  }

  const isAllSelected = (missingParts || []).length > 0 && selectedParts.size === (missingParts || []).length

  const handleSubmit = async () => {
    if (selectedParts.size === 0) {
      showNotification('Select at least one part to re-pick', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const partsToRepick = []
      missingParts.forEach((part, idx) => {
        if (selectedParts.has(idx)) {
          partsToRepick.push({
            part_id: part.part_id,
            part_number: part.part_number,
            revision: part.revision,
            quantity: part.unpicked_quantity || part.required_quantity || 1,
          })
        }
      })

      const response = customRepickFn
        ? await customRepickFn(partsToRepick)
        : await robotAssemblyService.repickParts(process.id, { parts: partsToRepick })

      if (response.data.success) {
        showNotification(
          `${response.data.repicked_count} part(s) re-picked successfully`,
          'success'
        )
        setSelectedParts(new Set())
        if (onComplete) onComplete()
        onClose()
      }
    } catch (error) {
      const errMsg = error.response?.data?.error || 'Failed to re-pick parts'
      showNotification(errMsg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const parts = missingParts || []

  return (
    <ResizableDialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      defaultHeight={500}
      id="repick-modal"
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h6">
              Re-pick Missing Parts
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {process?.process_number} — Select parts you have now collected
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip
              label={`${selectedParts.size}/${parts.length} selected`}
              color={isAllSelected ? 'success' : 'default'}
              size="small"
            />
            <IconButton onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {parts.length === 0 ? (
          <Alert severity="info" sx={{ m: 2 }}>
            No missing parts to re-pick.
          </Alert>
        ) : (
          <List sx={{ p: 0 }}>
            {/* Select All Header */}
            <ListItem
              sx={{
                borderBottom: `2px solid ${isDark ? '#f44336' : '#d32f2f'}`,
                bgcolor: isDark ? 'rgba(244, 67, 54, 0.15)' : '#ffebee',
                position: 'sticky',
                top: 0,
                zIndex: 1,
              }}
            >
              <Checkbox
                checked={isAllSelected}
                indeterminate={selectedParts.size > 0 && !isAllSelected}
                onChange={handleToggleAll}
                sx={{ mr: 1 }}
              />
              <Box sx={{ flex: 1 }}>
                <Typography
                  variant="body1"
                  sx={{ fontWeight: 700, color: isDark ? '#ef9a9a' : '#c62828' }}
                >
                  Select All Missing Parts
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {parts.length} part(s) were not picked
                </Typography>
              </Box>
            </ListItem>

            <Divider />

            {parts.map((part, idx) => {
              const isSelected = selectedParts.has(idx)
              const qty = part.unpicked_quantity || part.required_quantity || 1
              const inventory = part.inventory_available || 0

              let inventoryColor = 'text.primary'
              let inventoryBgColor = 'transparent'
              if (inventory === 0) {
                inventoryColor = isDark ? '#b0b0b0' : '#757575'
                inventoryBgColor = isDark ? 'rgba(128, 128, 128, 0.2)' : 'rgba(128, 128, 128, 0.15)'
              } else if (inventory < qty) {
                inventoryColor = '#f44336'
                inventoryBgColor = isDark ? 'rgba(244, 67, 54, 0.2)' : 'rgba(244, 67, 54, 0.15)'
              }

              return (
                <ListItem
                  key={idx}
                  sx={{
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    bgcolor: isSelected
                      ? (isDark ? 'rgba(56, 142, 60, 0.2)' : '#e8f5e9')
                      : 'transparent',
                    py: 1.5,
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: isSelected
                        ? (isDark ? 'rgba(56, 142, 60, 0.25)' : '#c8e6c9')
                        : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
                    },
                  }}
                  onClick={() => handleTogglePart(idx)}
                >
                  <Checkbox
                    checked={isSelected}
                    onChange={() => handleTogglePart(idx)}
                    onClick={(e) => e.stopPropagation()}
                    sx={{ mr: 1 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {part.part_number}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {part.description || 'No description'}
                        </Typography>
                      </Box>

                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Needed
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 700,
                              color: '#f44336',
                              bgcolor: isDark ? 'rgba(244, 67, 54, 0.2)' : 'rgba(244, 67, 54, 0.1)',
                              px: 1, py: 0.25, borderRadius: 1,
                            }}
                          >
                            {qty}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'center' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Stock
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 700,
                              color: inventoryColor,
                              bgcolor: inventoryBgColor,
                              px: 1, py: 0.25, borderRadius: 1,
                            }}
                          >
                            {inventory}
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                </ListItem>
              )
            })}
          </List>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <PickIcon />}
          onClick={handleSubmit}
          disabled={submitting || selectedParts.size === 0}
          sx={{ minWidth: 200 }}
        >
          {submitting ? 'Re-picking...' : `Re-pick ${selectedParts.size} Part(s)`}
        </Button>
      </DialogActions>
    </ResizableDialog>
  )
}

export default RepickModal
