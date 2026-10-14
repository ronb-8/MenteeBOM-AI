import api from './api'

export const adminService = {
  createBackup: () => api.post('/api/admin/backup/create'),

  restoreBackup: (backupFile) => {
    const formData = new FormData()
    formData.append('backup_file', backupFile)
    return api.post('/api/admin/backup/restore', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  },

  getLastBackup: () => api.get('/api/admin/backup/last'),

  getLogs: (params) => api.get('/api/admin/logs', { params }),

  getUsers: () => api.get('/api/users'),

  getUsersList: () => api.get('/api/users/list'),

  createUser: (userData) => api.post('/api/users', userData),

  updateUser: (userId, userData) => api.put('/api/users', { ...userData, id: userId }),

  deleteUser: (userId) => api.delete('/api/users', { data: { id: userId } }),

  getCustomColumns: () => api.get('/api/custom-columns'),

  createCustomColumn: (columnData) => api.post('/api/custom-columns', columnData),

  updateCustomColumn: (columnId, columnData) => api.put(`/api/custom-columns/${columnId}`, columnData),

  deleteCustomColumn: (columnId) => api.delete(`/api/custom-columns/${columnId}`),

  reorderCustomColumns: (order) => api.post('/api/custom-columns/reorder', { order }),

  getSystemInfo: () => api.get('/api/system-info'),

  cleanupDatabase: (data) => api.post('/api/cleanup-database', data),

  clearDatabase: (data) => api.post('/api/clear-database', data),

  getBadges: () => api.get('/api/badges'),

  createBadge: (badgeData) => api.post('/api/badges', badgeData),

  updateBadge: (badgeId, badgeData) => api.put(`/api/badges/${badgeId}`, badgeData),

  deleteBadge: (badgeId) => api.delete(`/api/badges/${badgeId}`),

  // Part Classification Rules
  getClassificationRules: () => api.get('/api/admin/part-classifier/rules'),
  createClassificationRule: (rule) => api.post('/api/admin/part-classifier/rules', rule),
  updateClassificationRule: (ruleId, rule) => api.put(`/api/admin/part-classifier/rules/${ruleId}`, rule),
  deleteClassificationRule: (ruleId) => api.delete(`/api/admin/part-classifier/rules/${ruleId}`),
  reloadPartClassifier: () => api.post('/api/admin/part-classifier/reload'),
  reclassifyAllParts: () => api.post('/api/admin/part-classifier/reclassify-all'),

  getPDMConfig: () => api.get('/api/pdm-config'),

  savePDMConfig: (config) => api.post('/api/pdm-config', config),

  // PDM Process Management
  getPDMProcessStatus: () => api.get('/api/pdm-import/status'),

  killPDMProcess: (processId) => api.post('/api/pdm-import/kill', { process_id: processId }),

  killAllPDMProcesses: () => api.post('/api/pdm-import/kill', { kill_all: true }),

  // Vendor List
  getVendors: () => api.get('/api/admin/vendor-list'),
  createVendor: (vendorData) => api.post('/api/admin/vendor-list', vendorData),
  updateVendor: (vendorId, vendorData) => api.put(`/api/admin/vendor-list/${vendorId}`, vendorData),
  deleteVendor: (vendorId) => api.delete(`/api/admin/vendor-list/${vendorId}`),
  getUnmatchedVendors: () => api.get('/api/admin/vendor-list/unmatched'),
  bulkRemapVendors: (mappings) => api.post('/api/admin/vendor-list/bulk-remap', { mappings }),

  // Vendor Contacts
  getVendorContacts: (vendorId) => api.get(`/api/admin/vendor-list/${vendorId}/contacts`),
  createVendorContact: (vendorId, data) => api.post(`/api/admin/vendor-list/${vendorId}/contacts`, data),
  updateVendorContact: (vendorId, contactId, data) => api.put(`/api/admin/vendor-list/${vendorId}/contacts/${contactId}`, data),
  deleteVendorContact: (vendorId, contactId) => api.delete(`/api/admin/vendor-list/${vendorId}/contacts/${contactId}`),

  // PO Approvers
  getPOApprovers: () => api.get('/api/admin/po-approvers'),
  createPOApprover: (data) => api.post('/api/admin/po-approvers', data),
  updatePOApprover: (id, data) => api.put(`/api/admin/po-approvers/${id}`, data),
  deletePOApprover: (id) => api.delete(`/api/admin/po-approvers/${id}`),

  // Unused Parts
  getUnusedParts: () => api.get('/api/admin/unused-parts'),
  deleteUnusedParts: (partIds) => api.delete('/api/admin/unused-parts', { data: { part_ids: partIds } }),

  // Part Types Management
  getPartTypes: () => api.get('/api/admin/part-types'),
  createPartType: (partTypeData) => api.post('/api/admin/part-types', partTypeData),
  updatePartType: (typeId, partTypeData) => api.put(`/api/admin/part-types/${typeId}`, partTypeData),
  deletePartType: (typeId) => api.delete(`/api/admin/part-types/${typeId}`),
  migratePartTypes: () => api.post('/api/admin/part-types/migrate'),

  // Enhanced Classification Rules
  testClassificationRule: (ruleId) => api.get(`/api/admin/part-classifier/rules/${ruleId}/test`),
  getRuleMatches: (ruleId) => api.get(`/api/admin/part-classifier/rules/${ruleId}/matches`),
  reorderClassificationRules: (rulePriorities) => api.put('/api/admin/part-classifier/rules/reorder', { rule_priorities: rulePriorities }),
  bulkUpdateClassificationRules: (ruleIds, isActive) => api.post('/api/admin/part-classifier/rules/bulk-update', { rule_ids: ruleIds, is_active: isActive }),
  exportClassificationRules: () => api.get('/api/admin/part-classifier/rules/export'),
  importClassificationRules: (rulesData) => api.post('/api/admin/part-classifier/rules/import', { rules: rulesData }),
}

