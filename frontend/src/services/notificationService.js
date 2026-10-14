import api from './api'

const notificationService = {
  // Cheap cursor poll — hit every ~10 s by every open tab
  poll: () => api.get('/api/poll/updates'),

  getNotifications: (limit = 50, beforeId = null) =>
    api.get('/api/notifications', {
      params: { limit, ...(beforeId ? { before_id: beforeId } : {}) },
    }),

  getUnreadCount: () => api.get('/api/notifications/unread-count'),

  markRead: (id) => api.post(`/api/notifications/${id}/read`),

  markAllRead: () => api.post('/api/notifications/read-all'),

  deleteNotification: (id) => api.delete(`/api/notifications/${id}`),

  // Admin: PDM staleness check
  runStaleCheck: () => api.post('/api/admin/pdm-stale-check/run'),

  getStaleCheckStatus: () => api.get('/api/admin/pdm-stale-check/status'),
}

export default notificationService
