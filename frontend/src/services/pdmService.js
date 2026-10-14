import api from './api'

export const pdmService = {
  importBOM: (formData) => api.post('/api/pdm-import', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),

  importBOMByName: (formData) => api.post('/api/pdm-import-by-name', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),

  updateBOM: (data) => api.post('/api/pdm-update', data),

  updateBOMWithECO: (data) => api.post('/api/pdm-update-with-eco', data),

  getConfig: () => api.get('/api/pdm-config'),

  updateConfig: (config) => api.post('/api/pdm-config', config),
}

