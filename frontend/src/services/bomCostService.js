import axios from 'axios'

const API_URL = '/api'

const getProjects = () => {
    return axios.get(`${API_URL}/admin/bom-cost/projects`)
}

const getBOMs = (projectId) => {
    return axios.get(`${API_URL}/admin/bom-cost/boms`, {
        params: { project_id: projectId }
    })
}

const calculateCosts = (bomIds) => {
    return axios.post(`${API_URL}/admin/bom-cost/calculate`, {
        bom_ids: bomIds
    })
}

const calculateDetailedCosts = (bomIds) => {
    return axios.post(`${API_URL}/admin/bom-cost/calculate-detailed`, {
        bom_ids: bomIds
    })
}

const getPartTypes = () => {
    return axios.get(`${API_URL}/parts/types`)
}

const getPartsByType = (type) => {
    return axios.get(`${API_URL}/parts/by-type`, {
        params: { type }
    })
}

const getPartsByTypes = (types) => {
    return axios.get(`${API_URL}/parts/by-type`, {
        params: { types: types.join(',') }
    })
}

const updatePartPrices = (updates, po_number = null) => {
    return axios.post(`${API_URL}/parts/update-prices`, {
        updates,
        po_number
    })
}

const processQuotationsForUpdate = (formData) => {
    return axios.post(`${API_URL}/parts/process-quotations-for-update`, formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    })
}

const getSumByType = (type) => {
    return axios.get(`${API_URL}/admin/bom-cost/sum-by-type`, {
        params: { type }
    })
}

const refreshCascadeCosts = (bomIds) => {
    return axios.post(`${API_URL}/admin/bom-cost/refresh-cascade`, {
        bom_ids: bomIds
    })
}

// Cost Robot Config (separate from Robot Assembly)
const getRobotConfig = (badgeId) => {
    return axios.get(`${API_URL}/admin/bom-cost/robot-config`, {
        params: { badge_id: badgeId }
    })
}

const createOrUpdateRobotConfig = (formData) => {
    return axios.post(`${API_URL}/admin/bom-cost/robot-config`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    })
}

const getCostLimbs = (badgeId) => {
    return axios.get(`${API_URL}/admin/bom-cost/limbs`, {
        params: { badge_id: badgeId }
    })
}

const createCostLimb = (data) => {
    return axios.post(`${API_URL}/admin/bom-cost/limbs`, data)
}

const updateCostLimb = (limbId, data) => {
    return axios.put(`${API_URL}/admin/bom-cost/limbs/${limbId}`, data)
}

const deleteCostLimb = (limbId) => {
    return axios.delete(`${API_URL}/admin/bom-cost/limbs/${limbId}`)
}

const updateLimbMappings = (limbId, items) => {
    return axios.put(`${API_URL}/admin/bom-cost/limb-mappings/${limbId}`, {
        items  // [{ type: 'dissolved', id: 5 }, { type: 'bom', id: 12 }]
    })
}

const getAvailableBoms = (badgeId) => {
    return axios.get(`${API_URL}/admin/bom-cost/available-boms`, {
        params: { badge_id: badgeId }
    })
}

const getRobotOverview = () => {
    return axios.get(`${API_URL}/admin/bom-cost/robot-overview`)
}

const getRobotFigures = () => {
    return axios.get(`${API_URL}/admin/bom-cost/robot-figures`)
}

const getAllDissolvedBoms = () => {
    return axios.get(`${API_URL}/admin/bom-cost/dissolved-boms`)
}

// Dissolved BOM limbs (polygon regions)
const getDissolvedBomLimbs = (badgeId) => {
    return axios.get(`${API_URL}/admin/bom-cost/dissolved-bom-limbs`, {
        params: { badge_id: badgeId }
    })
}

const saveDissolvedBomRegion = (dissolvedBomId, badgeId, regionCoords) => {
    return axios.put(`${API_URL}/admin/bom-cost/dissolved-bom-limbs/${dissolvedBomId}/region`, {
        badge_id: badgeId,
        region_coords: regionCoords,
    })
}

// Vendor categories
const getVendorCategories = (badgeId) => {
    return axios.get(`${API_URL}/admin/bom-cost/vendor-categories`, {
        params: { badge_id: badgeId }
    })
}

const createVendorCategory = (data) => {
    return axios.post(`${API_URL}/admin/bom-cost/vendor-categories`, data)
}

const updateVendorCategory = (catId, data) => {
    return axios.put(`${API_URL}/admin/bom-cost/vendor-categories/${catId}`, data)
}

const deleteVendorCategory = (catId) => {
    return axios.delete(`${API_URL}/admin/bom-cost/vendor-categories/${catId}`)
}

const updateCategoryAssignments = (catId, vendorStrings) => {
    return axios.put(`${API_URL}/admin/bom-cost/vendor-categories/${catId}/assignments`, {
        vendor_strings: vendorStrings
    })
}

const getDistinctVendors = (badgeId) => {
    return axios.get(`${API_URL}/admin/bom-cost/distinct-vendors`, {
        params: { badge_id: badgeId }
    })
}

const calculateMixedCosts = (items, badgeId = null) => {
    return axios.post(`${API_URL}/admin/bom-cost/calculate-mixed`, { items, badge_id: badgeId })
}

const createRobotFigure = (formData) => {
    return axios.post(`${API_URL}/admin/bom-cost/robot-figures`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    })
}

const deleteRobotFigure = (badgeId) => {
    return axios.delete(`${API_URL}/admin/bom-cost/robot-figures/${badgeId}`)
}

const calculateByCategory = (bomIds, badgeId) => {
    return axios.post(`${API_URL}/admin/bom-cost/calculate-by-category`, {
        bom_ids: bomIds,
        badge_id: badgeId
    })
}

const exportCostExcel = (items, badgeId, exportName, groupBy) => {
    return axios.post(`${API_URL}/admin/bom-cost/export-cost-excel`, {
        items,
        badge_id: badgeId,
        export_name: exportName,
        group_by: groupBy,
    }, { responseType: 'blob' })
}

const exportCostToDrive = (items, badgeId, exportName, groupBy) => {
    return axios.post(`${API_URL}/admin/bom-cost/export-cost-drive`, {
        items,
        badge_id: badgeId,
        export_name: exportName,
        group_by: groupBy,
    })
}

export const bomCostService = {
    getProjects,
    getBOMs,
    calculateCosts,
    calculateDetailedCosts,
    getPartTypes,
    getPartsByType,
    getPartsByTypes,
    updatePartPrices,
    processQuotationsForUpdate,
    getSumByType,
    refreshCascadeCosts,
    getRobotConfig,
    createOrUpdateRobotConfig,
    getCostLimbs,
    createCostLimb,
    updateCostLimb,
    deleteCostLimb,
    updateLimbMappings,
    getAvailableBoms,
    getRobotOverview,
    getRobotFigures,
    getAllDissolvedBoms,
    getDissolvedBomLimbs,
    saveDissolvedBomRegion,
    getVendorCategories,
    createVendorCategory,
    updateVendorCategory,
    deleteVendorCategory,
    updateCategoryAssignments,
    getDistinctVendors,
    calculateMixedCosts,
    calculateByCategory,
    createRobotFigure,
    deleteRobotFigure,
    exportCostExcel,
    exportCostToDrive,
}
