import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material'
import { Settings as SettingsIcon } from '@mui/icons-material'
import { useAuth } from '../context/AuthContext'
import { authService } from '../services/authService'
import { useNotification } from '../context/NotificationContext'

const UserSettingsModal = ({ open, onClose }) => {
  const { user, checkAuth } = useAuth()
  const { showNotification } = useNotification()
  const [saving, setSaving] = useState(false)

  const [profileForm, setProfileForm] = useState({
    username: '',
    email: '',
    phone: '',
  })

  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  })

  useEffect(() => {
    if (open && user) {
      setProfileForm({
        username: user.username || '',
        email: user.email || '',
        phone: user.phone || '',
      })
      setPasswordForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      })
    }
  }, [open, user])

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      const response = await authService.updateSettings(profileForm)
      if (response.data.success) {
        showNotification('Profile updated successfully', 'success')
        await checkAuth()
      } else {
        showNotification(response.data.error || 'Error updating profile', 'error')
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error updating profile', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      showNotification('New passwords do not match', 'error')
      return
    }
    if (passwordForm.new_password.length < 4) {
      showNotification('Password must be at least 4 characters', 'error')
      return
    }
    setSaving(true)
    try {
      const response = await authService.updateSettings({
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      })
      if (response.data.success) {
        showNotification('Password changed successfully', 'success')
        setPasswordForm({ current_password: '', new_password: '', confirm_password: '' })
      } else {
        showNotification(response.data.error || 'Error changing password', 'error')
      }
    } catch (error) {
      showNotification(error.response?.data?.error || 'Error changing password', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <SettingsIcon />
          User Settings
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="subtitle1" fontWeight="bold" sx={{ mt: 1, mb: 1 }}>
          Profile
        </Typography>
        <TextField
          fullWidth
          label="Username"
          value={profileForm.username}
          onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
          margin="dense"
          size="small"
        />
        <TextField
          fullWidth
          label="Email"
          type="email"
          value={profileForm.email}
          onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
          margin="dense"
          size="small"
        />
        <TextField
          fullWidth
          label="Phone"
          value={profileForm.phone}
          onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
          margin="dense"
          size="small"
        />
        <Box sx={{ mt: 1, mb: 2 }}>
          <Button
            variant="contained"
            size="small"
            onClick={handleSaveProfile}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={16} /> : null}
          >
            Save Profile
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
          Change Password
        </Typography>
        <TextField
          fullWidth
          label="Current Password"
          type="password"
          value={passwordForm.current_password}
          onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
          margin="dense"
          size="small"
        />
        <TextField
          fullWidth
          label="New Password"
          type="password"
          value={passwordForm.new_password}
          onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
          margin="dense"
          size="small"
        />
        <TextField
          fullWidth
          label="Confirm New Password"
          type="password"
          value={passwordForm.confirm_password}
          onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
          margin="dense"
          size="small"
        />
        <Box sx={{ mt: 1 }}>
          <Button
            variant="contained"
            color="warning"
            size="small"
            onClick={handleChangePassword}
            disabled={saving || !passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password}
            startIcon={saving ? <CircularProgress size={16} /> : null}
          >
            Change Password
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

export default UserSettingsModal
