import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Drawer, Box, Typography, IconButton, Tabs, Tab, List, ListItem,
  ListItemButton, ListItemIcon, ListItemText, Button, Chip, Tooltip, Badge,
  Divider,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DoneAllIcon from '@mui/icons-material/DoneAll'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone'
import { useNotification } from '../context/NotificationContext'

const severityIcon = (type) => {
  switch (type) {
    case 'success':
      return <CheckCircleOutlineIcon fontSize="small" color="success" />
    case 'error':
      return <ErrorOutlineIcon fontSize="small" color="error" />
    case 'warning':
    case 'pdm_stale':
      return <WarningAmberIcon fontSize="small" color="warning" />
    default:
      return <InfoOutlinedIcon fontSize="small" color="info" />
  }
}

const relativeTime = (value) => {
  const ts = typeof value === 'number' ? value : Date.parse(value)
  if (Number.isNaN(ts)) return ''
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

const NotificationCenter = ({ open, onClose }) => {
  const navigate = useNavigate()
  const {
    localHistory, clearLocalHistory,
    serverNotifications, hasMoreNotifications, loadMoreNotifications,
    unreadCount, markRead, markAllRead, deleteNotification,
  } = useNotification()
  const [tab, setTab] = useState(0)

  const handleAlertClick = (n) => {
    if (!n.is_read) markRead(n.id)
    if (n.link) {
      onClose()
      navigate(n.link)
    }
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose} keepMounted>
      <Box sx={{ width: 380, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Notifications</Typography>
          {tab === 0 && unreadCount > 0 && (
            <Tooltip title="Mark all as read">
              <IconButton size="small" onClick={markAllRead}>
                <DoneAllIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="fullWidth">
          <Tab label={
            <Badge badgeContent={unreadCount} color="error" max={99}
                   sx={{ '& .MuiBadge-badge': { right: -12 } }}>
              Alerts
            </Badge>
          } />
          <Tab label="This PC" />
        </Tabs>
        <Divider />

        {tab === 0 && (
          <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
            {serverNotifications.length === 0 ? (
              <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
                <NotificationsNoneIcon sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="body2">No alerts</Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {serverNotifications.map((n) => (
                  <ListItem
                    key={n.id}
                    disablePadding
                    secondaryAction={
                      <IconButton edge="end" size="small"
                                  onClick={() => deleteNotification(n.id)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    }
                    sx={{ bgcolor: n.is_read ? 'transparent' : 'action.hover' }}
                  >
                    <ListItemButton onClick={() => handleAlertClick(n)} sx={{ pr: 6 }}>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        {severityIcon(n.type)}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {!n.is_read && (
                              <Box sx={{
                                width: 8, height: 8, borderRadius: '50%',
                                bgcolor: 'error.main', flexShrink: 0,
                              }} />
                            )}
                            <Typography variant="body2"
                                        sx={{ fontWeight: n.is_read ? 400 : 600 }}>
                              {n.title}
                            </Typography>
                          </Box>
                        }
                        secondary={
                          <>
                            {n.message && (
                              <Typography variant="caption" component="span" display="block"
                                          sx={{ whiteSpace: 'normal' }}>
                                {n.message}
                              </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary" component="span">
                              {relativeTime(n.created_at)}
                            </Typography>
                          </>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            )}
            {hasMoreNotifications && (
              <Box sx={{ textAlign: 'center', py: 1 }}>
                <Button size="small" onClick={loadMoreNotifications}>Load more</Button>
              </Box>
            )}
          </Box>
        )}

        {tab === 1 && (
          <Box sx={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                History of actions on this browser
              </Typography>
              {localHistory.length > 0 && (
                <Button size="small" onClick={clearLocalHistory}>Clear history</Button>
              )}
            </Box>
            {localHistory.length === 0 ? (
              <Box sx={{ textAlign: 'center', color: 'text.secondary', mt: 6 }}>
                <NotificationsNoneIcon sx={{ fontSize: 40, mb: 1 }} />
                <Typography variant="body2">No history yet</Typography>
              </Box>
            ) : (
              <List dense disablePadding>
                {localHistory.map((h) => (
                  <ListItem key={h.id}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      {severityIcon(h.type)}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="body2" sx={{ whiteSpace: 'normal' }}>
                            {h.message}
                          </Typography>
                          {h.count > 1 && (
                            <Chip label={`×${h.count}`} size="small" sx={{ height: 18 }} />
                          )}
                        </Box>
                      }
                      secondary={relativeTime(h.ts)}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        )}
      </Box>
    </Drawer>
  )
}

export default NotificationCenter
