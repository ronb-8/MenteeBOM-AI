import api from './api'

const robotAssemblyService = {
  // ==========================================
  // URL builders (no API call — return URL string for direct <iframe>/<img> use)
  // ==========================================

  /** Part drawing PDF URL (session-authenticated) */
  getPartPdfUrl: (partNumber, revision) =>
    `/api/part-pdf/${encodeURIComponent(partNumber)}/${encodeURIComponent(revision || 'A')}?t=${Date.now()}`,

  /** Part AI instructions PDF URL (session-authenticated) */
  getPartAiUrl: (partNumber) =>
    `/api/part-ai/${encodeURIComponent(partNumber)}?t=${Date.now()}`,

  // ==========================================
  // Robot Config & Navigation
  // ==========================================

  /** Get badges displayed in Robot Assembly tab */
  getDisplayedBadges: () => api.get('/api/robot-assembly/displayed-badges'),

  /** Get robot config (image, limbs, DOFs) for a badge */
  getRobotConfig: (badgeId) => api.get(`/api/robot-assembly/config/${badgeId}`),

  /** Get DOF list for a limb */
  getLimbDOFs: (limbId) => api.get(`/api/robot-assembly/limb/${limbId}/dofs`),

  /** Get dissolved assembly tree for a DOF */
  getDOFTree: (dofId) => api.get(`/api/robot-assembly/dof/${dofId}/tree`),

  /** Get or check existing ProcessBOMInstance for a DOF */
  getProcessBOM: (dofId) => api.get(`/api/robot-assembly/dof/${dofId}/process-bom`),

  /** Force re-dissolution and rebuild of ProcessBOMInstance */
  rebuildProcessBOM: (dofId) => api.post(`/api/robot-assembly/dof/${dofId}/rebuild-process-bom`),

  // ==========================================
  // Manufacturing Processes
  // ==========================================

  /** List processes with filters (badge_id, status: active|completed|all) */
  getProcesses: (params) => api.get('/api/robot-assembly/processes', { params }),

  /** Get detailed process info with all stages */
  getProcess: (processId) => api.get(`/api/robot-assembly/process/${processId}`),

  /** Look up process by process_number (for deep-linking) */
  getProcessByNumber: (processNumber) => api.get(`/api/robot-assembly/process/by-number/${processNumber}`),

  /** Complete a stage (stages 3-6) */
  completeStage: (processId, stageNumber, data) =>
    api.post(`/api/robot-assembly/process/${processId}/stage/${stageNumber}/complete`, data),

  /** Get picking parts list for a process (fully dissolved + consolidated) */
  getPickingParts: (processId) => api.get(`/api/robot-assembly/process/${processId}/picking-parts`),

  /** Get stage-specific assembly + parts (stages 3-6) */
  getStageParts: (processId, stage) => api.get(`/api/robot-assembly/process/${processId}/stage-parts/${stage}`),

  /** Submit picking data (stage 2) */
  submitPicking: (processId, data) =>
    api.post(`/api/robot-assembly/process/${processId}/stage/2/pick`, data),

  /** Check if unpicked parts block a stage */
  checkUnpickedBlocking: (processId, stage) =>
    api.get(`/api/robot-assembly/process/${processId}/stage/${stage}/unpicked-check`),

  /** Re-pick parts that were missed in Stage 2 */
  repickParts: (processId, data) =>
    api.post(`/api/robot-assembly/process/${processId}/repick`, data),

  /** Replace a broken part (same part number, possibly different revision) */
  replacePart: (processId, data) =>
    api.post(`/api/robot-assembly/process/${processId}/replace-part`, data),

  /** Get replacement history for a process */
  getReplacements: (processId) =>
    api.get(`/api/robot-assembly/process/${processId}/replacements`),

  // ==========================================
  // Admin: Robot Config
  // ==========================================

  /** List all robot configs */
  getAdminConfigs: () => api.get('/api/robot-assembly/admin/config'),

  /** Create a new robot config for a badge */
  createAdminConfig: (data) => api.post('/api/robot-assembly/admin/config', data),

  /** Update a robot config */
  updateAdminConfig: (configId, data) => api.put(`/api/robot-assembly/admin/config/${configId}`, data),

  /** Delete (deactivate) a robot config */
  deleteAdminConfig: (configId) => api.delete(`/api/robot-assembly/admin/config/${configId}`),

  /** Upload robot image */
  uploadRobotImage: (configId, formData) =>
    api.post(`/api/robot-assembly/admin/config/${configId}/upload-image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // ==========================================
  // Admin: Limbs
  // ==========================================

  /** List limbs for a robot config */
  getLimbs: (configId) => api.get(`/api/robot-assembly/admin/limbs/${configId}`),

  /** Create a new limb */
  createLimb: (configId, data) => api.post(`/api/robot-assembly/admin/limbs/${configId}`, data),

  /** Update a limb */
  updateLimb: (limbId, data) => api.put(`/api/robot-assembly/admin/limb/${limbId}`, data),

  /** Delete (deactivate) a limb */
  deleteLimb: (limbId) => api.delete(`/api/robot-assembly/admin/limb/${limbId}`),

  /** Search BOMs for linking to a limb */
  searchBOMs: (badgeId, query) => api.get('/api/robot-assembly/admin/bom-search', {
    params: { badge_id: badgeId, q: query },
  }),

  /** Get child assemblies of a limb's linked BOM */
  getLimbChildAssemblies: (limbId) => api.get(`/api/robot-assembly/admin/limb/${limbId}/child-assemblies`),

  // ==========================================
  // Admin: DOF Mappings
  // ==========================================

  /** List DOF mappings for a limb */
  getDOFMappings: (limbId) => api.get(`/api/robot-assembly/admin/dof-mappings/${limbId}`),

  /** Create a new DOF mapping */
  createDOFMapping: (limbId, data) => api.post(`/api/robot-assembly/admin/dof-mappings/${limbId}`, data),

  /** Update a DOF mapping */
  updateDOFMapping: (mappingId, data) => api.put(`/api/robot-assembly/admin/dof-mapping/${mappingId}`, data),

  /** Delete (deactivate) a DOF mapping */
  deleteDOFMapping: (mappingId) => api.delete(`/api/robot-assembly/admin/dof-mapping/${mappingId}`),

  /** List read-only DOF template processes (one per DOF) for a badge, with embed links */
  getDofTemplates: (badgeId) => api.get('/api/robot-assembly/admin/dof-templates', { params: { badge_id: badgeId } }),

  /** List external DOFs (not tied to any limb) */
  getExternalDOFs: () => api.get('/api/robot-assembly/admin/external-dofs'),

  // ==========================================
  // Limb Assembly Snapshot & Dissolve
  // ==========================================

  /** Get limb assembly snapshot (builds from BOM if not exists, checks staleness) */
  getLimbAssemblySnapshot: (limbId) =>
    api.get(`/api/robot-assembly/limb/${limbId}/assembly-snapshot`),

  /** Force-rebuild snapshot from current BOM (clears all dissolves) */
  rebuildLimbSnapshot: (limbId) =>
    api.post(`/api/robot-assembly/limb/${limbId}/assembly-snapshot/rebuild`),

  /** Dissolve a sub-assembly node (replace with its children, auto-consolidate) */
  dissolveNode: (limbId, nodeId) =>
    api.post(`/api/robot-assembly/limb/${limbId}/assembly-snapshot/dissolve`, { node_id: nodeId }),

  /** Undo dissolve for a node */
  undissolveNode: (limbId, nodeId) =>
    api.delete(`/api/robot-assembly/limb/${limbId}/assembly-snapshot/dissolve/${nodeId}`),

  /** Reset all dissolves for a limb */
  resetDissolves: (limbId) =>
    api.delete(`/api/robot-assembly/limb/${limbId}/assembly-snapshot/dissolve-all`),

  /** Get parts data for building a sub-assembly (for build modal) */
  getAssemblyBuildData: (bomInstanceId) =>
    api.get(`/api/robot-assembly/assembly/${bomInstanceId}/build-data`),

  /** Collect parts for an assembly (reduce inventory) */
  collectAssemblyParts: (bomInstanceId, parts) =>
    api.post(`/api/robot-assembly/assembly/${bomInstanceId}/collect-parts`, { parts }),

  /** Collect parts directly by part_id (no BOM instance required) */
  collectPartsDirect: (parts) =>
    api.post('/api/robot-assembly/collect-parts', { parts }),

  /** Get stale status for all limbs of a robot config */
  getAdminLimbStaleness: (configId) =>
    api.get('/api/robot-assembly/admin/limb-staleness', { params: { config_id: configId } }),

  // ==========================================
  // Admin: MenteeFlow Config
  // ==========================================

  /** Get MenteeFlow configuration */
  getMenteeFlowConfig: () => api.get('/api/robot-assembly/admin/menteeflow-config'),

  /** Update MenteeFlow configuration */
  saveMenteeFlowConfig: (data) => api.put('/api/robot-assembly/admin/menteeflow-config', data),

  /** List saved API key pairs */
  getApiKeyHistory: () => api.get('/api/robot-assembly/admin/menteeflow-api-keys'),

  /** Save current API key + webhook secret pair */
  saveApiKeyPair: (data) => api.post('/api/robot-assembly/admin/menteeflow-api-keys', data),

  /** Revoke a saved API key pair */
  revokeApiKey: (keyId) => api.post(`/api/robot-assembly/admin/menteeflow-api-keys/${keyId}/revoke`),

  /** Activate a saved API key pair (applies it to config) */
  activateApiKey: (keyId) => api.post(`/api/robot-assembly/admin/menteeflow-api-keys/${keyId}/activate`),

  // ==========================================
  // Admin: Embed Tokens
  // ==========================================

  /** List active embed tokens */
  getEmbedTokens: () => api.get('/api/robot-assembly/admin/embed-tokens'),

  /** Revoke a specific embed token */
  revokeEmbedToken: (tokenId) => api.delete(`/api/robot-assembly/admin/embed-token/${tokenId}`),

  /** Revoke all active embed tokens */
  revokeAllEmbedTokens: () => api.post('/api/robot-assembly/admin/embed-tokens/revoke-all'),

  // ==========================================
  // Admin: Assembly Drawing Defaults
  // ==========================================

  /** List all drawing defaults grouped by assembly type */
  getDrawingDefaults: () => api.get('/api/robot-assembly/admin/drawing-defaults'),

  /** Create a new drawing default mapping */
  createDrawingDefault: (data) => api.post('/api/robot-assembly/admin/drawing-defaults', data),

  /** Update a drawing default mapping */
  updateDrawingDefault: (id, data) => api.put(`/api/robot-assembly/admin/drawing-default/${id}`, data),

  /** Delete (deactivate) a drawing default mapping */
  deleteDrawingDefault: (id) => api.delete(`/api/robot-assembly/admin/drawing-default/${id}`),

  /** Upload a fallback drawing file for a mapping */
  uploadDrawingFile: (id, formData) =>
    api.post(`/api/robot-assembly/admin/drawing-default/${id}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),

  // ==========================================
  // Stage Default Drawing Resolution
  // ==========================================

  /** Resolve the default assembly drawing for a process stage */
  getStageDefaultDrawing: (processId, stage) =>
    api.get(`/api/robot-assembly/process/${processId}/stage/${stage}/default-drawing`),

  // ==========================================
  // Limb Assembly Stage Definitions
  // ==========================================

  /** Get stage definitions for a limb (includes suggested prefix) */
  getLimbStageDefinitions: (limbId) =>
    api.get(`/api/robot-assembly/limb/${limbId}/stage-definitions`),

  /** Bulk-save stage definitions for a limb */
  saveLimbStageDefinitions: (limbId, data) =>
    api.post(`/api/robot-assembly/limb/${limbId}/stage-definitions`, data),

  /** Clear all stage definitions for a limb */
  clearLimbStageDefinitions: (limbId) =>
    api.delete(`/api/robot-assembly/limb/${limbId}/stage-definitions`),

  /** Update a limb's stage prefix */
  updateLimbStagePrefix: (limbId, prefix) =>
    api.put(`/api/robot-assembly/admin/limb/${limbId}/stage-prefix`, { prefix }),

  // ==========================================
  // Limb Assembly Processes
  // ==========================================

  /** List limb assembly processes (filter: badge_id, limb_id, status) */
  getLimbProcesses: (params) =>
    api.get('/api/robot-assembly/limb-processes', { params }),

  /** Get detailed limb process with all stage states */
  getLimbProcess: (processId) =>
    api.get(`/api/robot-assembly/limb-process/${processId}`),

  /** Get parts for a limb process stage (picking or assembly) */
  getLimbStageParts: (processId, stageLabel) =>
    api.get(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/parts`),

  notifyLimbPickingStarted: (processId, stageLabel) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/picking-started`),

  /** Submit picking for a limb process stage */
  submitLimbPicking: (processId, stageLabel, data) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/pick`, data),

  /** Complete a limb process stage */
  completeLimbStage: (processId, stageLabel, data) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/complete`, data || {}),

  /** Check unpicked parts blocking for a limb stage */
  checkLimbUnpickedBlocking: (processId, stageLabel) =>
    api.get(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/unpicked-check`),

  /** Re-pick parts for a limb process */
  repickLimbParts: (processId, data) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/repick`, data),

  /** Replace a part in a limb process */
  replaceLimbPart: (processId, data) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/replace-part`, data),

  /** Create (or return existing active) limb assembly process natively */
  startLimbProcess: (limbId, badgeId) =>
    api.post(`/api/robot-assembly/limb/${limbId}/start-process`, { badge_id: badgeId }),

  /** Advance a limb stage from pending → picking phase */
  beginLimbStage: (processId, stageLabel) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/begin`),

  /** Admin: cancel a limb process and return picked parts to stock */
  cancelLimbProcess: (processId) =>
    api.delete(`/api/robot-assembly/limb-process/${processId}/cancel`),

  /** Admin: roll back a completed stage to picking phase (returns inventory to stock) */
  rollbackLimbStage: (processId, stageLabel) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/rollback`),

  /** Admin: skip picking phase without deducting inventory (for drawing tests) */
  skipLimbPicking: (processId, stageLabel) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/skip-picking`),

  /** Admin: force-complete an entire stage (picking + assembly) with NO inventory
   *  deduction. For already-built limbs. Requires password re-confirmation. */
  skipLimbStage: (processId, stageLabel, password) =>
    api.post(`/api/robot-assembly/limb-process/${processId}/stage/${stageLabel}/skip-stage`,
             { password }),
}

export default robotAssemblyService
