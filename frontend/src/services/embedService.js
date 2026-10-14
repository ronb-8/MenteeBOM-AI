import axios from 'axios'

/**
 * Embed service for MenteeBOM views embedded in MenteeFlow iframes.
 * Uses token-based auth via query parameter instead of cookies.
 *
 * For limb-process methods the `processNumber` is bound via closure, so the
 * method signatures match robotAssemblyService (`fn(processId, stageLabel, ...)`)
 * — the processId argument is ignored. This lets the same modal components be
 * reused in both native and embed contexts by simply swapping the service.
 */
const createEmbedService = (token, processNumber = null) => {
  const instance = axios.create({
    baseURL: '',
    withCredentials: false,
  })

  // Append token to every request
  instance.interceptors.request.use((config) => {
    const separator = config.url.includes('?') ? '&' : '?'
    config.url = `${config.url}${separator}token=${token}`
    return config
  })

  return {
    /** Get picking parts */
    getPickingParts: (processNumber) =>
      instance.get(`/api/embed/process/${processNumber}/picking-parts`),

    /** Get stage-specific parts */
    getStageParts: (processNumber, stage) =>
      instance.get(`/api/embed/process/${processNumber}/stage-parts/${stage}`),

    /** Complete a stage */
    completeStage: (processNumber, stage, data = {}) =>
      instance.post(`/api/embed/process/${processNumber}/stage/${stage}/complete`, data),

    /** Submit picking data (final — completes stage) */
    submitPicking: (processNumber, data) =>
      instance.post(`/api/embed/process/${processNumber}/stage/2/pick`, data),

    /** Save partial picking progress (no stage completion) */
    savePicking: (processNumber, data) =>
      instance.post(`/api/embed/process/${processNumber}/stage/2/save-picking`, data),

    /** Re-pick parts */
    repickParts: (processNumber, data) =>
      instance.post(`/api/embed/process/${processNumber}/repick`, data),

    /** Check unpicked blocking */
    checkUnpickedBlocking: (processNumber, stage) =>
      instance.get(`/api/embed/process/${processNumber}/stage/${stage}/unpicked-check`),

    /** Build a PDF URL with embed token */
    getPartPdfUrl: (partNumber, revision) =>
      `/api/embed/part-pdf/${partNumber}/${revision}?token=${token}&t=${Date.now()}`,

    /** Build an AI instructions PDF URL with embed token */
    getPartAiUrl: (partNumber) =>
      `/api/embed/part-ai/${partNumber}?token=${token}&t=${Date.now()}`,

    /** Get default assembly drawing for a stage */
    getDefaultDrawing: (processNumber, stage) =>
      instance.get(`/api/embed/process/${processNumber}/stage/${stage}/default-drawing`),

    /** Get all available drawing defaults for a stage (fallback picker when auto-resolution fails) */
    getDrawingOptions: (processNumber, stage) =>
      instance.get(`/api/embed/process/${processNumber}/stage/${stage}/drawing-options`),

    /** Report a damaged part — withdraw replacement from inventory */
    damagedPart: (processNumber, stage, data) =>
      instance.post(`/api/embed/process/${processNumber}/stage/${stage}/damaged-part`, data),

    /** Late pick — pick an unpicked part from an assembly stage */
    pickPart: (processNumber, stage, data) =>
      instance.post(`/api/embed/process/${processNumber}/stage/${stage}/pick-part`, data),

    /** Batch late pick — pick all missing parts in a single request (check-all) */
    pickAllMissing: (processNumber, stage, data) =>
      instance.post(`/api/embed/process/${processNumber}/stage/${stage}/pick-all-missing`, data),

    // ─── Limb-process methods ─────────────────────────────────────────────
    // Signatures match robotAssemblyService so the same modal components can
    // be reused. The processId argument is ignored — the processNumber is
    // already bound to this service instance via closure.

    /** Picking parts for a limb stage (fasteners filtered out — auto-withdrawn) */
    getLimbStageParts: (_processId, stageLabel) =>
      instance.get(`/api/embed/limb-process/${processNumber}/stage/${stageLabel}/picking-parts`),

    /** Submit picking selections for a limb stage */
    submitLimbPicking: (_processId, stageLabel, data) =>
      instance.post(`/api/embed/limb-process/${processNumber}/stage/${stageLabel}/pick`, data),

    /** Fire stage-DOF / EL notification when user opens picking UI */
    notifyLimbPickingStarted: (_processId, stageLabel) =>
      instance.post(`/api/embed/limb-process/${processNumber}/stage/${stageLabel}/picking-started`),

    /** Complete a limb stage (assembly phase done) */
    completeLimbStage: (_processId, stageLabel, data) =>
      instance.post(`/api/embed/limb-process/${processNumber}/stage/${stageLabel}/complete`, data || {}),

    /** Check if any picked parts are blocking the stage */
    checkLimbUnpickedBlocking: (_processId, stageLabel) =>
      instance.get(`/api/embed/limb-process/${processNumber}/stage/${stageLabel}/unpicked-check`),

    /** Re-pick missing parts from inventory */
    repickLimbParts: (_processId, data) =>
      instance.post(`/api/embed/limb-process/${processNumber}/repick`, data),

    /** Status of the full limb process (stages + phases) */
    getLimbProcessStatus: () =>
      instance.get(`/api/embed/limb-process/${processNumber}/status`),

    /** Match LimbAssemblyWorkflowDialog's refresh path — same payload as status */
    getLimbProcess: (_processId) =>
      instance.get(`/api/embed/limb-process/${processNumber}/status`),

    /** Begin a stage that's still pending (rarely needed — backend auto-begins) */
    beginLimbStage: (_processId, stageLabel) =>
      instance.post(`/api/embed/limb-process/${processNumber}/stage/${stageLabel}/begin`, {}),

    /** Force-complete a stage (Forward button) — password-gated, no inventory */
    skipLimbStage: (_processId, stageLabel, password) =>
      instance.post(`/api/embed/limb-process/${processNumber}/stage/${stageLabel}/skip-stage`,
                    { password }),

    // ─── Operations not exposed in embed mode (admin actions) ──────────────
    // Provide stubs that reject so the dialog falls back gracefully if a
    // user ever triggers them in embed mode.
    getLimbProcesses: () =>
      Promise.resolve({ data: { processes: [] } }),
    rollbackLimbStage: () =>
      Promise.reject(new Error('Rollback not available in embed mode')),
    skipLimbPicking: () =>
      Promise.reject(new Error('Skip not available in embed mode')),
    cancelLimbProcess: () =>
      Promise.reject(new Error('Cancel not available in embed mode')),
    startLimbProcess: () =>
      Promise.reject(new Error('Start not available in embed mode')),
  }
}

export default createEmbedService
