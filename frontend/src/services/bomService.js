import api from './api'

export const bomService = {
  getDashboardStats: () => api.get('/api/dashboard-stats'),
  
  getBOMs: (badgeId) => {
    const params = badgeId ? { badge_id: badgeId } : {}
    return api.get('/api/boms', { params })
  },
  
  getBOMData: (bomId) => api.get(`/api/bom-data/${bomId}`),
  
  getBOMDataNew: (bomId, viewType = 'flat') => api.get(`/api/bom-data-new/${bomId}?view_type=${viewType}`),
  
  updateBOMData: (bomId, data) => api.put(`/api/bom-data/${bomId}`, data),
  
  deleteBOM: (bomId) => api.delete(`/api/bom-data/${bomId}`),
  
  getBOMItems: (bomId) => api.get(`/api/bom-items/${bomId}`),
  
  getBOMTree: (bomId) => api.get(`/api/bom/${bomId}/tree`),
  
  getBOMFlat: (bomId) => api.get(`/api/bom/${bomId}/flat`),
  
  updateBOMItem: (itemId, data) => api.put(`/api/bom/item/${itemId}/update`, data),
  
  updatePart: (partId, data) => api.put(`/api/part/${partId}/update`, data),

  uploadPartThumbnail: (partId, formData) => api.post(`/api/part/${partId}/upload-thumbnail`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),

  getBOMVersions: (bomId) => api.get(`/api/bom-versions/${bomId}`),
  
  getBOMRevisions: (bomId) => api.get(`/api/bom/${bomId}/revisions`),
  
  getBOMVersion: (versionId) => api.get(`/api/bom-version/${versionId}`),
  
  getBOMChanges: (versionId) => api.get(`/api/bom-changes/${versionId}`),
  
  switchBOMVersion: (bomId, versionId) => api.post(`/api/bom-versions/${bomId}/switch`, { version_id: versionId }),
  
  updateBOMName: (bomId, name) => api.post(`/api/bom-instance/${bomId}/update-name`, { name }),
  
  refreshBOMCost: (bomId) => api.post(`/api/bom-instance/${bomId}/refresh-cost`),
  
  getBOMTypes: () => api.get('/api/bom-types'),

  exportBOMToExcel: (bomId) => api.get(`/api/bom-export-excel/${bomId}`, {
    responseType: 'blob',
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  }),

  exportMultipleBOMsToExcel: (bomIds, exportName, dissolveAssemblies = false, bomMultipliers = {}) => api.post('/api/bom-export-excel-multi', {
    bom_ids: bomIds,
    export_name: exportName,
    dissolve_assemblies: dissolveAssemblies,
    bom_multipliers: bomMultipliers,
  }, {
    responseType: 'blob',
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  }),

  exportMultipleBOMsToSheets: (bomIds, exportName, dissolveAssemblies = false, bomMultipliers = {}) => api.post('/api/bom-export-sheets-multi', {
    bom_ids: bomIds,
    export_name: exportName,
    dissolve_assemblies: dissolveAssemblies,
    bom_multipliers: bomMultipliers,
  }),

  replaceBOMPart: (bomPartId, newPartId) => api.post(`/api/bom/item/${bomPartId}/replace-part`, { new_part_id: newPartId }),

  searchParts: (query, limit = 50) => api.get(`/api/parts/search?q=${encodeURIComponent(query)}&limit=${limit}`),

  lookupPart: (partNumber, revision) => api.get(`/api/parts/lookup?part_number=${encodeURIComponent(partNumber)}&revision=${encodeURIComponent(revision)}`),

  getAllPartsLatest: () => api.get('/api/parts/all-latest'),

  getPartInventoryHistory: (partId, limit = 100) => api.get(`/api/parts/${partId}/inventory-history?limit=${limit}`),

  getInventoryTransactions: (params = {}) => api.get('/api/inventory/transactions', { params }),

  exportPartsExcel: () => api.get('/api/parts/export-excel', {
    responseType: 'blob',
    headers: {
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    },
  }),

  exportPartsSheets: () => api.post('/api/parts/export-sheets'),

  uploadPartDatasheet: (partId, formData) => api.post(`/api/part/${partId}/upload-datasheet`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),

  exportArrangement: (bomId, partNumber, exportType) => {
    const config = exportType === 'excel' ? {
      responseType: 'blob',
      headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    } : {}
    return api.post('/api/bom-export-arrangement', {
      bom_id: bomId,
      part_number: partNumber,
      export_type: exportType,
    }, config)
  },

  checkFileAvailability: (parts) => api.post('/api/parts/check-file-availability', { parts }),

  getLatestAndScan: (parts) => api.post('/api/parts/get-latest-and-scan', { parts }),

  lookupPartFromPDM: (partNumber, revision) =>
    api.post('/api/parts/lookup-from-pdm', { part_number: partNumber, revision }),

  createPart: (payload) => api.post('/api/parts/create', payload),

  refreshPartsFromPDM: (payload) => api.post('/api/parts/refresh-from-pdm', payload),

  updateECO: (ecoCode, data) => api.put(`/api/eco/${ecoCode}/update`, data),

  // Dissolved BOMs
  getDissolvedBOMs: () => api.get('/api/dissolved-boms'),
  getDissolvedBOM: (id) => api.get(`/api/dissolved-boms/${id}`),
  createDissolvedBOM: (data) => api.post('/api/dissolved-boms', data),
  deleteDissolvedBOM: (id) => api.delete(`/api/dissolved-boms/${id}`),
  refreshDissolvedBOM: (id) => api.put(`/api/dissolved-boms/${id}/refresh`),
}
