/**
 * LimbAssemblyTree
 * Shows the effective assembly tree for a limb with dissolve/undo capabilities.
 * Dissolves are per-limb design decisions (persisted in LimbAssemblySnapshot).
 * DOF assembly nodes are marked but cannot be dissolved (handled by MenteeFlow separately).
 * - Engineers/admins: full controls (dissolve, rebuild, configure)
 * - Floor users: read-only tree with wrench (AI drawing) and PDF icons
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  Typography,
  CircularProgress,
  Alert,
  IconButton,
  Chip,
  Tooltip,
  Collapse,
  Button,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material'
import {
  ChevronRight as ChevronRightIcon,
  CallMerge as DissolveIcon,
  Undo as UndoIcon,
  Refresh as RefreshIcon,
  Build as BuildIcon,
  ClearAll as ResetIcon,
  AccountTree as StageIcon,
  PictureAsPdf as PdfIcon,
  Sync as DrawingRefreshIcon,
  PlayArrow as AssembleIcon,
  Construction as RebuildIcon,
} from '@mui/icons-material'
import { useTheme } from '@mui/material/styles'
import { useAuth } from '../../context/AuthContext'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'
import LimbStageConfigurator from './LimbStageConfigurator'
import ThumbnailZoom from './ThumbnailZoom'
import { getThumbSrc } from '../../utils/thumbnail'

// ─── Single tree node ──────────────────────────────────────────────────────────

const TreeNode = ({ node, limbId, dissolvedIds, dofPartNumbers, canDissolve, canControl, onDissolve, onUndissolve, onDOFAssemble, depth = 0 }) => {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const [expanded, setExpanded] = useState(depth < 2)

  // AI drawing state (wrench / assembly nodes)
  const [aiUrl, setAiUrl] = useState(null)
  // Part PDF drawing state (PDF icon / part nodes)
  const [partPdfUrl, setPartPdfUrl] = useState(null)

  const hasChildren = node.children && node.children.length > 0
  const isDOF = dofPartNumbers.has(node.part_number)
  const isAssembly = node.is_assembly

  const assemblyColor = isDOF
    ? (isDark ? theme.palette.success.dark : '#e8f5e9')
    : (isDark ? 'rgba(25,118,210,0.08)' : '#e3f2fd')

  const toggleAiDrawing = () => {
    if (aiUrl) {
      setAiUrl(null)
    } else {
      setAiUrl(`/api/part-ai/${node.part_number}?t=${Date.now()}#toolbar=1&navpanes=0`)
    }
  }

  const refreshAiDrawing = () => {
    setAiUrl(`/api/part-ai/${node.part_number}?t=${Date.now()}#toolbar=1&navpanes=0`)
  }

  const togglePartPdf = () => {
    if (partPdfUrl) {
      setPartPdfUrl(null)
    } else {
      setPartPdfUrl(`/api/part-ai/${node.part_number}?t=${Date.now()}#toolbar=1&navpanes=0`)
    }
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          pl: depth * 2.5,
          py: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: isAssembly ? assemblyColor : 'transparent',
          '&:hover': { bgcolor: isDark ? 'rgba(255,255,255,0.05)' : 'action.hover' },
          minHeight: 38,
        }}
      >
        {/* Expand/collapse */}
        <IconButton
          size="small"
          onClick={() => setExpanded(!expanded)}
          sx={{
            width: 22, height: 22,
            visibility: hasChildren ? 'visible' : 'hidden',
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>

        {/* Thumbnail */}
        <ThumbnailZoom
          src={node.thumbnail ? getThumbSrc(node.thumbnail) : null}
          alt={node.part_number}
          size={24}
        />

        {/* Part number */}
        <Typography
          fontFamily="monospace"
          fontSize="0.78rem"
          fontWeight={isAssembly ? 700 : 400}
          sx={{ minWidth: 130, color: isAssembly ? 'primary.main' : 'text.primary' }}
        >
          {node.part_number}
        </Typography>

        {/* Description */}
        <Typography variant="caption" sx={{ flex: 1, color: 'text.secondary' }} noWrap title={node.description || node.part_name}>
          {node.description || node.part_name}
        </Typography>

        {/* Qty */}
        <Typography variant="caption" sx={{ minWidth: 28, textAlign: 'right', color: 'text.secondary', flexShrink: 0 }}>
          ×{node.quantity}
        </Typography>

        {/* DOF chip */}
        {isDOF && (
          <Chip label="DOF" color="success" size="small" sx={{ fontSize: '0.65rem', height: 18, flexShrink: 0 }} />
        )}

        {/* Actions for assembly nodes */}
        {isAssembly && !isDOF && (
          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
            {/* Wrench: load AI assembly instructions */}
            <Tooltip title={aiUrl ? 'Close assembly instructions' : 'View assembly instructions (AI)'}>
              <IconButton size="small" onClick={toggleAiDrawing} sx={{ p: 0.3, color: aiUrl ? 'warning.main' : undefined }}>
                <BuildIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            {/* Refresh drawing — only shown when drawing is open */}
            {aiUrl && (
              <Tooltip title="Refresh drawing (re-fetch latest AI)">
                <IconButton size="small" onClick={refreshAiDrawing} sx={{ p: 0.3 }}>
                  <DrawingRefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}

            {/* Dissolve button — engineers/admins only */}
            {canDissolve && hasChildren && (
              <Tooltip title="Dissolve: flatten this sub-assembly into the parent (reversible)">
                <IconButton size="small" onClick={() => onDissolve(node.bom_part_id)} sx={{ p: 0.3 }}>
                  <DissolveIcon fontSize="small" color="action" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}

        {/* PDF icon for part nodes (non-assembly) */}
        {!isAssembly && (
          <Box sx={{ flexShrink: 0 }}>
            <Tooltip title={partPdfUrl ? 'Close drawing' : 'View drawing (AI)'}>
              <IconButton size="small" onClick={togglePartPdf} sx={{ p: 0.3, color: partPdfUrl ? 'error.main' : undefined }}>
                <PdfIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {/* AI drawing inline viewer (assembly nodes) */}
      {aiUrl && (
        <Box sx={{ pl: depth * 2.5 + 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <iframe
            src={aiUrl}
            style={{ width: '100%', height: 500, border: 'none', display: 'block' }}
            title={`AI Instructions — ${node.part_number}`}
          />
        </Box>
      )}

      {/* Part PDF inline viewer */}
      {partPdfUrl && (
        <Box sx={{ pl: depth * 2.5 + 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          <iframe
            src={partPdfUrl}
            style={{ width: '100%', height: 500, border: 'none', display: 'block' }}
            title={`Drawing — ${node.part_number}`}
          />
        </Box>
      )}

      {/* Children */}
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {node.children.map((child, idx) => (
            <TreeNode
              key={`${child.bom_part_id}-${idx}`}
              node={child}
              limbId={limbId}
              dissolvedIds={dissolvedIds}
              dofPartNumbers={dofPartNumbers}
              canDissolve={canDissolve}
              canControl={canControl}
              onDissolve={onDissolve}
              onUndissolve={onUndissolve}
              onDOFAssemble={onDOFAssemble}
              depth={depth + 1}
            />
          ))}
        </Collapse>
      )}

    </Box>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

const LimbAssemblyTree = ({ limb, dofList = [], onDOFAssemble }) => {
  const { showNotification } = useNotification()
  const { user } = useAuth()
  const canDissolve = ['admin', 'engineer'].includes(user?.role)
  const canControl = canDissolve // same gate: engineers & admins

  const [loading, setLoading] = useState(false)
  const [snapshot, setSnapshot] = useState(null)   // { effective_tree, dissolved_node_ids, stale_diff (= last re-sync summary) }
  const [acting, setActing] = useState(false)
  const [stageConfigOpen, setStageConfigOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null) // 'rebuild' | 'reset' | null

  // "BOM auto-synced" notice: dismissed per limb per re-sync (resynced_at), remembered in this browser
  const dismissKey = `limbResyncDismissed:${limb?.id}`
  const [dismissedResync, setDismissedResync] = useState(() => {
    try { return localStorage.getItem(dismissKey) } catch { return null }
  })
  const dismissResync = (resyncedAt) => {
    setDismissedResync(resyncedAt)
    try { localStorage.setItem(dismissKey, resyncedAt) } catch { /* private mode etc. */ }
  }

  const dofPartNumbers = new Set(dofList.map(d => d.assembly_description).filter(Boolean))

  const load = useCallback(async () => {
    if (!limb?.id) return
    setLoading(true)
    try {
      const resp = await robotAssemblyService.getLimbAssemblySnapshot(limb.id)
      if (resp.data.success) setSnapshot(resp.data)
    } catch {
      showNotification('Failed to load limb assembly tree', 'error')
    } finally {
      setLoading(false)
    }
  }, [limb?.id])

  useEffect(() => { load() }, [load])

  const handleDissolve = async (nodeId) => {
    setActing(true)
    try {
      const resp = await robotAssemblyService.dissolveNode(limb.id, nodeId)
      if (resp.data.success) {
        setSnapshot(prev => ({
          ...prev,
          effective_tree: resp.data.effective_tree,
          dissolved_node_ids: resp.data.dissolved_node_ids,
        }))
        showNotification('Sub-assembly dissolved and parts consolidated', 'success')
      }
    } catch {
      showNotification('Failed to dissolve assembly', 'error')
    } finally {
      setActing(false)
    }
  }

  const handleUndissolve = async (nodeId) => {
    setActing(true)
    try {
      const resp = await robotAssemblyService.undissolveNode(limb.id, nodeId)
      if (resp.data.success) {
        setSnapshot(prev => ({
          ...prev,
          effective_tree: resp.data.effective_tree,
          dissolved_node_ids: resp.data.dissolved_node_ids,
        }))
        showNotification('Dissolve undone', 'success')
      }
    } catch {
      showNotification('Failed to undo dissolve', 'error')
    } finally {
      setActing(false)
    }
  }

  const handleReset = async () => {
    setConfirmAction(null)
    setActing(true)
    try {
      const resp = await robotAssemblyService.resetDissolves(limb.id)
      if (resp.data.success) {
        setSnapshot(prev => ({ ...prev, effective_tree: resp.data.effective_tree, dissolved_node_ids: [] }))
        showNotification('All dissolves reset', 'success')
      }
    } catch {
      showNotification('Failed to reset dissolves', 'error')
    } finally {
      setActing(false)
    }
  }

  const handleRebuild = async () => {
    setConfirmAction(null)
    setActing(true)
    try {
      await robotAssemblyService.rebuildLimbSnapshot(limb.id)
      await load()
      showNotification('Assembly tree rebuilt from current BOM', 'success')
    } catch {
      showNotification('Failed to rebuild snapshot', 'error')
    } finally {
      setActing(false)
    }
  }

  if (!limb) return null

  const dissolvedIds = snapshot?.dissolved_node_ids || []
  const dissolvedCount = dissolvedIds.length
  const tree = snapshot?.effective_tree || []

  // Snapshots re-sync automatically when the BOM version moves; stale_diff holds the last re-sync summary.
  const lastResync = snapshot?.stale_diff?.resynced_at ? snapshot.stale_diff : null
  const RESYNC_NOTICE_DAYS = 14
  const showResyncNotice = lastResync
    && dismissedResync !== lastResync.resynced_at
    && (Date.now() - new Date(lastResync.resynced_at).getTime()) < RESYNC_NOTICE_DAYS * 86400000
  const resyncHasChanges = lastResync && (
    lastResync.added?.length > 0 || lastResync.removed?.length > 0 || lastResync.deactivated_stage_labels?.length > 0
  )

  const confirmMessages = {
    reset: {
      title: 'Reset All Dissolves?',
      body: 'This will undo all dissolves and restore the original tree structure. Stage definitions are not affected.',
    },
    rebuild: {
      title: 'Force Re-sync from BOM?',
      body: 'Re-syncs the tree from the current BOM. Dissolves and configured stages are preserved where the part numbers still exist; stages whose assembly is no longer in the BOM are deactivated. Normally unnecessary — this happens automatically when the BOM version changes.',
    },
  }

  return (
    <Box sx={{ mt: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" fontWeight={600}>
          Assembly Tree — {limb.name}
          {limb.assembly_part_number && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              [{limb.assembly_part_number}]
            </Typography>
          )}
        </Typography>

        {dissolvedCount > 0 && canControl && (
          <Tooltip title="Reset all dissolves to original tree">
            <Chip
              icon={<ResetIcon fontSize="small" />}
              label={`${dissolvedCount} dissolved`}
              size="small"
              variant="outlined"
              color="warning"
              onClick={() => setConfirmAction('reset')}
              disabled={acting}
            />
          </Tooltip>
        )}

        {/* Refresh from server — engineers/admins only */}
        {canControl && (
          <Tooltip title="Refresh tree from server">
            <IconButton size="small" onClick={load} disabled={loading || acting}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {/* Limb Assembly button — available to all users when tree is loaded */}
        {onDOFAssemble && tree.length > 0 && (
          <Button
            variant="contained"
            size="small"
            color="success"
            startIcon={<AssembleIcon />}
            onClick={onDOFAssemble}
            sx={{ ml: 'auto', textTransform: 'none', fontSize: '0.75rem' }}
          >
            Limb Assembly
          </Button>
        )}

        {canControl && tree.length > 0 && !stageConfigOpen && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<StageIcon />}
            onClick={() => setStageConfigOpen(true)}
            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
          >
            Configure Stages
          </Button>
        )}
        {canControl && (
          <Tooltip title="Force re-sync from the current BOM (dissolves and stages are preserved where part numbers still exist). Happens automatically when the BOM version changes.">
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<RebuildIcon fontSize="small" />}
              onClick={() => setConfirmAction('rebuild')}
              disabled={acting}
              sx={{ textTransform: 'none', fontSize: '0.72rem', ml: 0.5, py: 0.25 }}
            >
              Re-sync BOM
            </Button>
          </Tooltip>
        )}
      </Box>

      {/* Auto re-sync notice — the tree was rebuilt from a newer BOM version */}
      {showResyncNotice && (
        <Alert
          severity={lastResync.deactivated_stage_labels?.length > 0 ? 'warning' : 'info'}
          onClose={() => dismissResync(lastResync.resynced_at)}
          sx={{ mb: 1, py: 0.5 }}
        >
          <strong>BOM auto-synced</strong>
          {lastResync.new_bom_version && ` to ${lastResync.new_bom_version}`}
          {lastResync.old_bom_version && ` (was ${lastResync.old_bom_version})`}
          {' — '}{new Date(lastResync.resynced_at).toLocaleString()}
          {lastResync.trigger === 'manual' && ' (manual)'}
          {resyncHasChanges ? (
            <Typography variant="caption" display="block">
              {lastResync.added?.length > 0 && `Added: ${lastResync.added.join(', ')}. `}
              {lastResync.removed?.length > 0 && `Removed: ${lastResync.removed.join(', ')}. `}
              {lastResync.deactivated_stage_labels?.length > 0 &&
                `Stages deactivated (assembly no longer in BOM): ${lastResync.deactivated_stage_labels.join(', ')}.`}
            </Typography>
          ) : (
            <Typography variant="caption" display="block">No part changes — stages and dissolves carried over.</Typography>
          )}
        </Alert>
      )}

      {/* Dissolved-node undo list — engineers/admins only */}
      {dissolvedCount > 0 && canControl && (
        <Box sx={{ mb: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Dissolved:
          </Typography>
          {dissolvedIds.map(id => (
            <Chip
              key={id}
              label={`#${id}`}
              size="small"
              icon={<UndoIcon fontSize="inherit" />}
              onClick={() => handleUndissolve(id)}
              disabled={acting}
              sx={{ fontSize: '0.65rem', height: 20 }}
            />
          ))}
        </Box>
      )}

      {/* Tree */}
      <Paper variant="outlined" sx={{ borderRadius: 1, overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : tree.length === 0 ? (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {limb.assembly_part_number
                ? 'No BOM found for this limb\'s assembly.'
                : 'No assembly linked to this limb. Link an assembly in Admin → Robot Assembly.'}
            </Typography>
          </Box>
        ) : (
          tree.map((node, idx) => (
            <TreeNode
              key={`${node.bom_part_id}-${idx}`}
              node={node}
              limbId={limb.id}
              dissolvedIds={dissolvedIds}
              dofPartNumbers={dofPartNumbers}
              canDissolve={canDissolve && !acting}
              canControl={canControl}
              onDissolve={handleDissolve}
              onUndissolve={handleUndissolve}
              onDOFAssemble={onDOFAssemble}
              depth={0}
            />
          ))
        )}
      </Paper>

      {canControl && tree.length > 0 && !stageConfigOpen && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          Click <DissolveIcon sx={{ fontSize: 12, verticalAlign: 'middle' }} /> to dissolve a sub-assembly (flattens its parts into the parent, auto-consolidates duplicates).
          Click the dissolved chip to undo.
        </Typography>
      )}

      {/* Stage Configurator */}
      {stageConfigOpen && (
        <Paper variant="outlined" sx={{ mt: 1.5, p: 1.5, borderColor: 'primary.main' }}>
          <LimbStageConfigurator
            limb={limb}
            tree={tree}
            dofPartNumbers={dofPartNumbers}
            onSaved={() => setStageConfigOpen(false)}
            onClose={() => setStageConfigOpen(false)}
          />
        </Paper>
      )}

      {/* Warning dialog for rebuild / reset */}
      <Dialog open={confirmAction !== null} onClose={() => setConfirmAction(null)} maxWidth="xs" fullWidth>
        {confirmAction && (
          <>
            <DialogTitle>{confirmMessages[confirmAction].title}</DialogTitle>
            <DialogContent>
              <DialogContentText>{confirmMessages[confirmAction].body}</DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmAction(null)}>Cancel</Button>
              <Button
                variant="contained"
                color="warning"
                onClick={confirmAction === 'rebuild' ? handleRebuild : handleReset}
              >
                Confirm
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  )
}

export default LimbAssemblyTree
