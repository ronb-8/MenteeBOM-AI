import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { Snackbar, Alert } from '@mui/material'
import { useAuth } from './AuthContext'
import notificationService from '../services/notificationService'

const NotificationContext = createContext()

const LOCAL_HISTORY_KEY = 'menteebom_toast_history'
const LOCAL_HISTORY_CAP = 200
const LOCAL_DEDUPE_WINDOW_MS = 3000
const POLL_INTERVAL_MS = 10000

const loadLocalHistory = () => {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const saveLocalHistory = (history) => {
  try {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(history))
  } catch {
    // localStorage full or unavailable — history is best-effort
  }
}

export const useNotification = () => {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotification must be used within NotificationProvider')
  }
  return context
}

export const NotificationProvider = ({ children }) => {
  const { user } = useAuth()
  const [notification, setNotification] = useState(null)
  const [open, setOpen] = useState(false)

  // Per-browser history of local toasts ("This PC" tab in the sidebar)
  const [localHistory, setLocalHistory] = useState(loadLocalHistory)

  // Server-side notifications (stale-BOM alerts etc.)
  const [serverNotifications, setServerNotifications] = useState([])
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [stalenessVersion, setStalenessVersion] = useState(0)
  // Generic data channels ('purchases', 'boms', 'parts', ...): pages subscribe
  // with useEffect(..., [liveVersions.<channel>]) to refetch on remote changes
  const [liveVersions, setLiveVersions] = useState({})
  // Running PDM imports/updates across all users (activity channel)
  const [activeImports, setActiveImports] = useState([])

  const cursorRef = useRef(0)
  const staleVersionRef = useRef(null)
  const liveVersionsRef = useRef(null)
  const activityVersionRef = useRef(null)
  const pollInFlightRef = useRef(false)

  const showNotification = (message, type = 'info', duration = 5000) => {
    setNotification({ message, type })
    setOpen(true)

    if (type !== 'error' && duration > 0) {
      setTimeout(() => {
        setOpen(false)
      }, duration)
    }

    // Also record in the per-browser history (sidebar "This PC" tab)
    setLocalHistory((prev) => {
      const now = Date.now()
      const newest = prev[0]
      let next
      if (newest && newest.message === message && newest.type === type
          && now - newest.ts < LOCAL_DEDUPE_WINDOW_MS) {
        next = [{ ...newest, count: (newest.count || 1) + 1, ts: now }, ...prev.slice(1)]
      } else {
        next = [
          { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, message, type, ts: now, count: 1 },
          ...prev,
        ].slice(0, LOCAL_HISTORY_CAP)
      }
      saveLocalHistory(next)
      return next
    })
  }

  const clearLocalHistory = () => {
    setLocalHistory([])
    saveLocalHistory([])
  }

  const refreshNotifications = useCallback(async () => {
    try {
      const res = await notificationService.getNotifications()
      if (res.data?.success) {
        setServerNotifications(res.data.notifications)
        setHasMoreNotifications(!!res.data.has_more)
      }
    } catch {
      // silent — next poll retries
    }
  }, [])

  const loadMoreNotifications = useCallback(async () => {
    try {
      const oldest = serverNotifications[serverNotifications.length - 1]
      if (!oldest) return
      const res = await notificationService.getNotifications(50, oldest.id)
      if (res.data?.success) {
        setServerNotifications((prev) => [...prev, ...res.data.notifications])
        setHasMoreNotifications(!!res.data.has_more)
      }
    } catch {
      // silent
    }
  }, [serverNotifications])

  const markRead = useCallback(async (id) => {
    setServerNotifications((prev) =>
      prev.map((n) => (n.id === id && !n.is_read ? { ...n, is_read: true } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
    try {
      await notificationService.markRead(id)
    } catch {
      // silent — poll will resync the real unread count
    }
  }, [])

  const markAllRead = useCallback(async () => {
    setServerNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    setUnreadCount(0)
    try {
      await notificationService.markAllRead()
    } catch {
      // silent
    }
  }, [])

  const deleteNotification = useCallback(async (id) => {
    setServerNotifications((prev) => {
      const target = prev.find((n) => n.id === id)
      if (target && !target.is_read) setUnreadCount((c) => Math.max(0, c - 1))
      return prev.filter((n) => n.id !== id)
    })
    try {
      await notificationService.deleteNotification(id)
    } catch {
      // silent
    }
  }, [])

  // Live-update poller: every open tab checks the cheap cursor endpoint.
  // Channels are extensible — pages subscribe to staleness via stalenessVersion.
  useEffect(() => {
    if (!user) return undefined

    const tick = async () => {
      if (pollInFlightRef.current || document.hidden) return
      pollInFlightRef.current = true
      try {
        const res = await notificationService.poll()
        const channels = res.data?.channels
        if (!channels) return

        const notif = channels.notifications
        if (notif) {
          setUnreadCount(notif.unread || 0)
          if ((notif.cursor || 0) > cursorRef.current) {
            cursorRef.current = notif.cursor || 0
            refreshNotifications()
          }
        }

        const staleness = channels.bom_staleness
        if (staleness) {
          if (staleVersionRef.current === null) {
            staleVersionRef.current = staleness.version
          } else if (staleness.version !== staleVersionRef.current) {
            staleVersionRef.current = staleness.version
            setStalenessVersion(staleness.version)
          }
        }

        // Running-import activity: show current state immediately (also on first poll)
        const activity = channels.activity
        if (activity && activity.version !== activityVersionRef.current) {
          activityVersionRef.current = activity.version
          setActiveImports(activity.imports || [])
        }

        // Generic data channels: everything except the ones handled above
        const dataChannels = {}
        for (const [name, value] of Object.entries(channels)) {
          if (name !== 'notifications' && name !== 'bom_staleness' && name !== 'activity'
              && value && value.version !== undefined) {
            dataChannels[name] = value.version
          }
        }
        if (liveVersionsRef.current === null) {
          // First poll after mount/login: baseline only, no refetch storm
          liveVersionsRef.current = dataChannels
        } else {
          const prev = liveVersionsRef.current
          const changed = Object.keys(dataChannels).some((k) => dataChannels[k] !== prev[k])
          if (changed) {
            liveVersionsRef.current = dataChannels
            setLiveVersions(dataChannels)
          }
        }
      } catch {
        // silent — 401 is handled by the axios interceptor, transient errors retry next tick
      } finally {
        pollInFlightRef.current = false
      }
    }

    tick()
    const interval = setInterval(tick, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user, refreshNotifications])

  const handleClose = (event, reason) => {
    if (reason === 'clickaway') {
      return
    }
    setOpen(false)
  }

  const getSeverity = (type) => {
    switch (type) {
      case 'success':
        return 'success'
      case 'error':
        return 'error'
      case 'warning':
        return 'warning'
      case 'info':
      default:
        return 'info'
    }
  }

  return (
    <NotificationContext.Provider value={{
      showNotification,
      localHistory,
      clearLocalHistory,
      serverNotifications,
      hasMoreNotifications,
      loadMoreNotifications,
      unreadCount,
      stalenessVersion,
      liveVersions,
      activeImports,
      refreshNotifications,
      markRead,
      markAllRead,
      deleteNotification,
    }}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={notification?.type === 'error' ? null : 5000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ mt: 8 }} // Account for AppBar
      >
        <Alert
          onClose={handleClose}
          severity={notification ? getSeverity(notification.type) : 'info'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {notification?.message}
        </Alert>
      </Snackbar>
    </NotificationContext.Provider>
  )
}
