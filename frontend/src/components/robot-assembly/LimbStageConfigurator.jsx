/**
 * LimbStageConfigurator
 * Auto-generates assembly stages that mirror the BOM tree hierarchy.
 *
 * Naming: LL1 (root assembly), LL1.1 (first child), LL1.1.1 (grandchild), etc.
 * Rule: a stage can only start when ALL its sub-stages are completed.
 * Leaf stages (no assembly children) can start immediately and run in parallel.
 *
 * Props:
 * - limb: the selected limb object
 * - tree: effective_tree array from snapshot
 * - dofPartNumbers: Set of DOF assembly descriptions (to exclude)
 * - onSaved: callback after successful save
 * - onClose: callback to close configurator
 */
import { useState, useEffect, useMemo } from 'react'
import {
  Box,
  Typography,
  Button,
  Chip,
  Paper,
  IconButton,
  Tooltip,
  TextField,
  CircularProgress,
  Collapse,
} from '@mui/material'
import {
  Delete as DeleteIcon,
  Save as SaveIcon,
  Close as CloseIcon,
  AutoFixHigh as GenerateIcon,
  AccountTree as StageIcon,
  ChevronRight as ChevronRightIcon,
  PlayArrow as LeafIcon,
  Lock as BlockedIcon,
} from '@mui/icons-material'
import { useNotification } from '../../context/NotificationContext'
import robotAssemblyService from '../../services/robotAssemblyService'

// ─── Tree → Stage generation ───────────────────────────────────────────────────

/**
 * Recursively walk the BOM tree and produce a flat list of stage definitions
 * that mirror the hierarchy. Labels use dotted notation: LL1, LL1.1, LL1.1.1, etc.
 *
 * Only includes assembly nodes that are not DOF.
 */
/**
 * Check if a node or any of its ancestors is a DOF assembly.
 * DOF nodes and ALL their descendants are handled by the DOF process, not limb assembly.
 */
function isDofSubtree(node, dofPartNumbers) {
  return dofPartNumbers.has(node.part_number)
}

function generateStagesFromTree(nodes, dofPartNumbers, prefix, parentLabel = null, parentIdx = [], seen = null) {
  if (!seen) seen = new Set()
  const stages = []
  let childCounter = 0

  for (const node of nodes) {
    if (!node.is_assembly) continue
    // Skip DOF nodes AND all their children (handled by DOF process)
    if (isDofSubtree(node, dofPartNumbers)) continue
    if (seen.has(node.part_number)) continue // skip duplicates

    seen.add(node.part_number)
    childCounter++
    const idxPath = [...parentIdx, childCounter]
    const label = parentLabel
      ? `${parentLabel}.${childCounter}`
      : `${prefix}${childCounter}`

    // Filter children: exclude DOF subtrees and already-seen
    const childAssemblies = (node.children || []).filter(
      c => c.is_assembly && !isDofSubtree(c, dofPartNumbers) && !seen.has(c.part_number)
    )
    const isLeaf = childAssemblies.length === 0

    stages.push({
      label,
      part_number: node.part_number,
      bom_part_id: node.bom_part_id,
      description: node.description || node.part_name || '',
      depth: idxPath.length - 1,
      isLeaf,
      parentLabel,
      children: [], // filled below
    })

    // Recurse into non-DOF children only
    if (childAssemblies.length > 0) {
      const childStages = generateStagesFromTree(
        node.children || [], dofPartNumbers, prefix, label, idxPath, seen
      )
      const parentStage = stages[stages.length - 1]
      // Only record DIRECT children (depth = parent depth + 1), not all descendants
      parentStage.children = childStages
        .filter(s => s.parentLabel === label)
        .map(s => s.label)
      stages.push(...childStages)
    }
  }

  return stages
}

// ─── Stage tree display node ───────────────────────────────────────────────────

const StageNode = ({ stage, allStages, onRemove }) => {
  const [expanded, setExpanded] = useState(true)
  const hasChildren = stage.children.length > 0
  const childStages = allStages.filter(s => stage.children.includes(s.label))

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          py: 0.4,
          pl: stage.depth * 3,
          borderBottom: '1px solid',
          borderColor: 'divider',
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {/* Expand/collapse */}
        <IconButton
          size="small"
          onClick={() => setExpanded(!expanded)}
          sx={{
            width: 20, height: 20,
            visibility: hasChildren ? 'visible' : 'hidden',
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}
        >
          <ChevronRightIcon sx={{ fontSize: 16 }} />
        </IconButton>

        {/* Stage label chip */}
        <Chip
          label={stage.label}
          size="small"
          color={stage.isLeaf ? 'success' : 'primary'}
          variant={stage.isLeaf ? 'outlined' : 'filled'}
          sx={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '0.72rem', height: 22, minWidth: 50 }}
        />

        {/* Part number */}
        <Typography fontFamily="monospace" fontSize="0.75rem" fontWeight={600} sx={{ minWidth: 110 }}>
          {stage.part_number}
        </Typography>

        {/* Description */}
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
          {stage.description}
        </Typography>

        {/* DOFs picked in this stage — appended to the stage name shown on the floor and in MenteeFlow */}
        {stage.dof_numbers?.map(n => (
          <Chip
            key={n}
            label={`DOF ${n}`}
            size="small"
            variant="outlined"
            color="secondary"
            sx={{ height: 18, fontSize: '0.65rem' }}
          />
        ))}

        {/* Leaf / blocked indicator */}
        {stage.isLeaf ? (
          <Tooltip title="Leaf stage — can start immediately">
            <LeafIcon sx={{ fontSize: 14, color: 'success.main' }} />
          </Tooltip>
        ) : (
          <Tooltip title={`Blocked until ${stage.children.length} sub-stage(s) complete`}>
            <BlockedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
          </Tooltip>
        )}

        {/* Remove */}
        <Tooltip title="Remove from stages">
          <IconButton size="small" onClick={() => onRemove(stage.label)} sx={{ p: 0.3 }}>
            <DeleteIcon sx={{ fontSize: 14 }} color="error" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Children */}
      {hasChildren && (
        <Collapse in={expanded} timeout="auto">
          {childStages.map(child => (
            <StageNode
              key={child.label}
              stage={child}
              allStages={allStages}
              onRemove={onRemove}
            />
          ))}
        </Collapse>
      )}
    </Box>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

const LimbStageConfigurator = ({ limb, tree, dofPartNumbers, onSaved, onClose }) => {
  const { showNotification } = useNotification()

  const [prefix, setPrefix] = useState('')
  const [suggestedPrefix, setSuggestedPrefix] = useState('')
  const [stages, setStages] = useState([]) // flat list of stage defs
  const [existingDefs, setExistingDefs] = useState([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  // Load existing definitions and prefix
  useEffect(() => {
    if (!limb?.id) return
    const load = async () => {
      setLoading(true)
      try {
        const resp = await robotAssemblyService.getLimbStageDefinitions(limb.id)
        if (resp.data.success) {
          setPrefix(resp.data.stage_prefix || resp.data.suggested_prefix || '')
          setSuggestedPrefix(resp.data.suggested_prefix || '')
          setExistingDefs(resp.data.definitions || [])

          // Reconstruct stages from existing definitions
          if (resp.data.definitions?.length > 0) {
            const reconstructed = resp.data.definitions.map(d => {
              const children = resp.data.definitions
                .filter(s => s.parent_stage_id === d.id)
                .map(s => s.stage_label)
              return {
                label: d.stage_label,
                part_number: d.assembly_part_number,
                bom_part_id: d.bom_part_id,
                description: d.stage_name,
                dof_numbers: d.dof_numbers || [],
                depth: (d.stage_label.match(/\./g) || []).length,
                isLeaf: children.length === 0,
                parentLabel: d.parent_stage_id
                  ? resp.data.definitions.find(x => x.id === d.parent_stage_id)?.stage_label || null
                  : null,
                children,
              }
            })
            setStages(reconstructed)
          }
        }
      } catch {
        // First time — no definitions yet
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [limb?.id])

  // Auto-generate from tree
  const handleGenerate = () => {
    const p = prefix || suggestedPrefix || 'XX'
    const generated = generateStagesFromTree(tree || [], dofPartNumbers || new Set(), p)
    if (generated.length === 0) {
      showNotification('No assemblies found. Dissolve irrelevant assemblies first.', 'warning')
      return
    }
    setStages(generated)
    showNotification(`Generated ${generated.length} stages mirroring the BOM tree`, 'success')
  }

  // Re-generate when prefix changes (if stages exist)
  const handleRegenerateLabels = () => {
    if (stages.length === 0) return
    const p = prefix || 'XX'
    const generated = generateStagesFromTree(tree || [], dofPartNumbers || new Set(), p)
    setStages(generated)
  }

  // Remove a stage (and its children)
  const handleRemove = (label) => {
    setStages(prev => {
      // Remove this stage and all stages whose label starts with it
      return prev.filter(s => s.label !== label && !s.label.startsWith(label + '.'))
        .map(s => ({
          ...s,
          children: s.children.filter(c => c !== label && !c.startsWith(label + '.')),
          isLeaf: s.children.filter(c => c !== label && !c.startsWith(label + '.')).length === 0,
        }))
    })
  }

  // Get root-level stages (no parentLabel)
  const rootStages = stages.filter(s => !s.parentLabel)

  // Count leaves
  const leafCount = stages.filter(s => s.isLeaf).length
  const totalCount = stages.length

  // Save
  const handleSave = async () => {
    if (!prefix) {
      showNotification('Please set a stage prefix', 'warning')
      return
    }
    if (stages.length === 0) {
      showNotification('No stages to save. Generate stages first.', 'warning')
      return
    }

    setSaving(true)
    try {
      // Save prefix
      if (prefix !== limb.stage_prefix) {
        await robotAssemblyService.updateLimbStagePrefix(limb.id, prefix)
      }

      // Build hierarchical stages payload for the backend
      // The backend expects top-level stages with optional sub_stages
      // But our tree can be deeper. We'll send a flat list and let the backend
      // handle parent_stage_id linking via the labels.
      const stagesPayload = buildPayloadFromTree(rootStages, stages)

      const resp = await robotAssemblyService.saveLimbStageDefinitions(limb.id, { stages: stagesPayload })
      if (resp.data.success) {
        showNotification(`Saved ${resp.data.created_count} stage definitions`, 'success')
        onSaved?.()
      }
    } catch (err) {
      showNotification('Failed to save stage definitions', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Clear all
  const handleClear = async () => {
    setSaving(true)
    try {
      await robotAssemblyService.clearLimbStageDefinitions(limb.id)
      setStages([])
      setExistingDefs([])
      showNotification('Stage definitions cleared', 'success')
    } catch {
      showNotification('Failed to clear definitions', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
  }

  return (
    <Box sx={{ mt: 1 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <StageIcon color="primary" fontSize="small" />
        <Typography variant="subtitle2" fontWeight={600}>
          Assembly Stages — {limb.name}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Prefix + Generate */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <TextField
          label="Stage Prefix"
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          size="small"
          sx={{ width: 120 }}
          helperText={suggestedPrefix ? `Suggested: ${suggestedPrefix}` : ''}
        />
        <Button
          variant="contained"
          size="small"
          startIcon={<GenerateIcon />}
          onClick={handleGenerate}
          sx={{ textTransform: 'none' }}
        >
          Generate from Tree
        </Button>
        {stages.length > 0 && prefix && (
          <Button
            variant="outlined"
            size="small"
            onClick={handleRegenerateLabels}
            sx={{ textTransform: 'none', fontSize: '0.75rem' }}
          >
            Update Labels
          </Button>
        )}
      </Box>

      {/* Info */}
      {stages.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {totalCount} stages total. {leafCount} leaf stages (can start in parallel).
          A stage can only start when all its sub-stages are completed.
        </Typography>
      )}

      {/* Stage tree */}
      {stages.length > 0 && (
        <Paper variant="outlined" sx={{ maxHeight: 450, overflow: 'auto', mb: 1.5 }}>
          {rootStages.map(stage => (
            <StageNode
              key={stage.label}
              stage={stage}
              allStages={stages}
              onRemove={handleRemove}
            />
          ))}
        </Paper>
      )}

      {/* Legend */}
      {stages.length > 0 && (
        <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <LeafIcon sx={{ fontSize: 14, color: 'success.main' }} />
            <Typography variant="caption" color="text.secondary">
              Leaf — starts immediately, parallel with siblings
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <BlockedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
            <Typography variant="caption" color="text.secondary">
              Blocked — waits for all sub-stages
            </Typography>
          </Box>
        </Box>
      )}

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        {existingDefs.length > 0 && (
          <Button variant="outlined" color="error" size="small" onClick={handleClear} disabled={saving}>
            Clear All
          </Button>
        )}
        <Button variant="outlined" size="small" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          size="small"
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
          onClick={handleSave}
          disabled={saving || stages.length === 0 || !prefix}
        >
          Save Stages ({totalCount})
        </Button>
      </Box>
    </Box>
  )
}

/**
 * Build the payload for saving — recursively nests sub_stages.
 * Backend expects: { stages: [ { ..., sub_stages: [ { ..., sub_stages: [...] } ] } ] }
 */
function buildPayloadFromTree(rootStages, allStages) {
  return rootStages.map(stage => {
    const childStages = allStages.filter(s => stage.children.includes(s.label))
    const payload = {
      bom_part_id: stage.bom_part_id,
      assembly_part_number: stage.part_number,
      stage_name: stage.description,
      has_drawing: !stage.isLeaf,
    }
    if (childStages.length > 0) {
      payload.sub_stages = buildPayloadFromTree(childStages, allStages)
    }
    return payload
  })
}

export default LimbStageConfigurator
