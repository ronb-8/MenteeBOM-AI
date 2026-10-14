import { useState } from 'react'
import {
  Box,
  Typography,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Avatar,
  CircularProgress,
  Alert,
  TextField,
  MenuItem,
  useTheme,
} from '@mui/material'
import {
  Close as CloseIcon,
  SwapHoriz as SwapHorizIcon,
  Image as ImageIcon,
} from '@mui/icons-material'
import ResizableDialog from '../ResizableDialog'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import { getThumbSrc } from '../../utils/thumbnail'

const REASONS = [
  { value: 'broken', label: 'Broken' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong_revision', label: 'Wrong Revision' },
  { value: 'defective', label: 'Defective' },
  { value: 'other', label: 'Other' },
]

const ReplacePartModal = ({ open, onClose, process, stage, partToReplace, onComplete }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { showNotification } = useNotification()

  const [reason, setReason] = useState('')
  const [otherReason, setOtherReason] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!reason) {
      showNotification('Please select a reason for replacement', 'warning')
      return
    }

    const finalReason = reason === 'other' ? otherReason || 'Other' : reason

    setSubmitting(true)
    try {
      const response = await robotAssemblyService.replacePart(process.id, {
        old_part_id: partToReplace.part_id,
        quantity: quantity,
        reason: finalReason,
        stage: stage,
      })

      if (response.data.success) {
        showNotification('Part replaced successfully', 'success')
        if (onComplete) onComplete()
        onClose()
      }
    } catch (error) {
      const errMsg = error.response?.data?.error || 'Failed to replace part'
      showNotification(errMsg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!partToReplace) return null

  return (
    <ResizableDialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      defaultHeight={420}
      id="replace-part-modal"
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SwapHorizIcon color="warning" />
            <Typography variant="h6">Replace Part</Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Part being replaced */}
        <Alert severity="info" sx={{ mb: 2 }}>
          The old part will be returned to inventory and a new one (same part number) will be taken.
        </Alert>

        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 2, p: 1.5, mb: 2,
          border: `1px solid ${theme.palette.divider}`, borderRadius: 1,
          bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        }}>
          {partToReplace.thumbnail ? (
            <Avatar
              src={getThumbSrc(partToReplace.thumbnail)}
              variant="rounded"
              sx={{ width: 48, height: 48 }}
            />
          ) : (
            <Avatar variant="rounded" sx={{ width: 48, height: 48, bgcolor: theme.palette.action.hover }}>
              <ImageIcon />
            </Avatar>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              {partToReplace.part_number}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {partToReplace.description || 'No description'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Rev {partToReplace.revision || '-'}
            </Typography>
          </Box>
        </Box>

        {/* Reason */}
        <TextField
          select
          fullWidth
          label="Reason for replacement"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          sx={{ mb: 2 }}
          size="small"
        >
          {REASONS.map(r => (
            <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>
          ))}
        </TextField>

        {reason === 'other' && (
          <TextField
            fullWidth
            label="Describe reason"
            value={otherReason}
            onChange={(e) => setOtherReason(e.target.value)}
            sx={{ mb: 2 }}
            size="small"
          />
        )}

        {/* Quantity */}
        <TextField
          fullWidth
          type="number"
          label="Quantity to replace"
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          inputProps={{ min: 1, max: partToReplace.quantity || 10 }}
          size="small"
        />
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          color="warning"
          startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <SwapHorizIcon />}
          onClick={handleSubmit}
          disabled={submitting || !reason}
        >
          {submitting ? 'Replacing...' : 'Replace Part'}
        </Button>
      </DialogActions>
    </ResizableDialog>
  )
}

export default ReplacePartModal
