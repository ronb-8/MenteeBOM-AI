import api from './api'

export const rfqService = {
  createMechanicalRFQ: (data) => api.post('/api/mechanical-rfq', data),

  createMultiBOMRFQ: (data) => api.post('/api/mechanical-rfq/multi', data),

  getLatestRFQFiles: (data) => api.post('/api/mechanical-rfq/get-latest-files', data),

  analyzeRFQFiles: (data) => api.post('/api/mechanical-rfq/analyze', data),

  exportRFQFiles: (data) => api.post('/api/mechanical-rfq/export', data),

  exportStandardPartsRFQ: (data) => api.post('/api/standard-parts-rfq/export', data),

  parseSheetRFQ: (data) => api.post('/api/sheet-rfq/parse', data),

  getPartsBomBreakdown: (partIds, bomIds) => api.post('/api/bom/parts-bom-breakdown', { part_ids: partIds, bom_ids: bomIds }),

  getRFQs: () => api.get('/api/rfqs'),

  getRFQ: (rfqId) => api.get(`/api/rfqs/${rfqId}`),

  deleteRFQ: (rfqId) => api.delete(`/api/rfqs/${rfqId}`),

  reopenRFQ: (rfqId) => api.post(`/api/rfqs/${rfqId}/reopen`),

  editPO: (poId, payload) => api.post(`/api/pos/${poId}/edit`, payload),

  updateRFQQuantities: (rfqId, items, removedItems = []) => api.post(`/api/rfqs/${rfqId}/update_quantities`, { items, removed_items: removedItems }),

  duplicateRFQ: (rfqId, data) => api.post(`/api/rfqs/${rfqId}/duplicate`, data),

  // RFQ Refresh methods (update metadata from Parts DB + regenerate files)
  detectRFQRefresh: (rfqId) => api.post(`/api/rfqs/${rfqId}/refresh?phase=detect`),

  refreshRFQ: (rfqId) => api.post(`/api/rfqs/${rfqId}/refresh?phase=execute`),

  // Parts DB revision inspection/cleanup (used by price-validation revision marks)
  getPartDbRevisions: (partNumber) => api.get(`/api/parts/${encodeURIComponent(partNumber)}/db-revisions`),

  deletePartDbRevision: (partId) => api.delete(`/api/parts/db-revisions/${partId}`),

  validatePrices: (rfqId, formData) => api.post(`/api/rfqs/${rfqId}/validate_prices`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),

  processAdditionalQuotations: (formData) => api.post('/api/quotations/process_additional', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  }),

  createPOFinal: (rfqId, data) => api.post(`/api/rfqs/${rfqId}/create_po_final`, data),

  exportPriceValidation: (data) => api.post('/api/pos/price-validation/export', data, { responseType: 'blob' }),

  getPOs: () => api.get('/api/pos'),

  getPODetails: (poId) => api.get(`/api/pos/${poId}`),

  deletePO: (poId) => api.delete(`/api/pos/${poId}`),

  markPOReceived: (poId, qcData = null, revisionDecisions = null) => {
    const payload = {}
    if (qcData) payload.qc_data = qcData
    if (revisionDecisions) payload.revision_decisions = revisionDecisions
    return api.post(`/api/pos/${poId}/mark_received`, payload)
  },

  partialReceivePO: (poId, qcData, revisionDecisions = null) => {
    const payload = { qc_data: qcData }
    if (revisionDecisions) payload.revision_decisions = revisionDecisions
    return api.post(`/api/pos/${poId}/partial_receive`, payload)
  },

  getRevisionMismatches: (poId) => api.get(`/api/pos/${poId}/revision_mismatches`),

  undoPartReceived: (poId, partNumber, revision) => {
    return api.post(`/api/pos/${poId}/undo_part_received`, { part_number: partNumber, revision })
  },

  undoPOReceived: (poId) => api.post(`/api/pos/${poId}/undo_received`),

  updatePOTracking: (poId, data) => api.post(`/api/pos/${poId}/update_tracking`, data),

  getDeliveryPerformance: (upcomingDays = 7) => api.get(`/api/pos/delivery-performance?upcoming_days=${upcomingDays}`),

  updatePOTotalCost: (poId, totalCost) => api.put(`/api/pos/${poId}/total_cost`, { total_cost: totalCost }),

  getPOQCDetails: (poId) => api.get(`/api/pos/${poId}/qc_data`),

  savePOQCDetails: (poId, qcData) => api.post(`/api/pos/${poId}/qc_data`, { qc_data: qcData }),

  getRemainingQuantities: (poId) => api.get(`/api/pos/${poId}/remaining_quantities`, { params: { _t: Date.now() } }),

  refreshPartRevision: (poId, partNumber, oldRevision) =>
    api.post(`/api/pos/${poId}/refresh_part_revision`, { part_number: partNumber, old_revision: oldRevision }),

  exportPOQCToExcel: (poId) => api.get(`/api/pos/${poId}/qc_data/export`, { responseType: 'blob' }),

  createPOWithoutRFQ: (data) => api.post('/api/pos/create-without-rfq', data),

  updatePOLeadTime: (poId, leadTime) => api.post(`/api/pos/${poId}/update_tracking`, { lead_time: leadTime }),

  addPODelivery: (parentPoId, deliveryData) => api.post(`/api/pos/${parentPoId}/add-delivery`, deliveryData),

  getPODeliveries: (poId) => api.get(`/api/pos/${poId}/deliveries`),

  // PO Regenerate methods
  detectPOChanges: (poId) => api.post(`/api/pos/${poId}/regenerate?phase=detect`),

  regeneratePO: (poId) => api.post(`/api/pos/${poId}/regenerate?phase=execute`),

  getActivePOApprovers: () => api.get('/api/po-approvers'),

  checkWarehouseBoxDuplicate: (warehouseBoxNumber, excludePartId = null) => {
    return api.post('/api/warehouse-box/check-duplicate', {
      warehouse_box_number: warehouseBoxNumber,
      exclude_part_id: excludePartId
    })
  },
}

