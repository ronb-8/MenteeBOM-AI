import api from './api'

export const stockwiseService = {
  getConfig: () => api.get('/api/stockwise/admin/config'),

  setApiKey: (apiKey) => api.put('/api/stockwise/admin/config', { api_key: apiKey }),

  setWritesEnabled: (enabled) => api.put('/api/stockwise/admin/config', { writes_enabled: enabled }),
}
