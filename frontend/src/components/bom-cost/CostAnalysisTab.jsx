import { useState, useEffect, useCallback, useMemo } from 'react'
import { Box, CircularProgress, Typography, Chip } from '@mui/material'
import { bomCostService } from '../../services/bomCostService'
import RobotCostFigure from './RobotCostFigure'
import CostSummaryCards from './CostSummaryCards'
import CostDonutChart from './CostDonutChart'
import ConsolidatedBomView from './ConsolidatedBomView'
import BOMCostCard from '../BOMCostCard'

const CostAnalysisTab = ({ selectedProject, showNotification }) => {
  const [robotConfig, setRobotConfig] = useState(null)
  const [selectedLimbIds, setSelectedLimbIds] = useState([]) // limb IDs clicked on robot
  const [detailedResults, setDetailedResults] = useState(null)
  const [calculating, setCalculating] = useState(false)
  const [loading, setLoading] = useState(false)

  const badgeId = selectedProject?.id

  useEffect(() => {
    if (!badgeId) {
      setRobotConfig(null)
      setSelectedLimbIds([])
      setDetailedResults(null)
      return
    }
    loadConfig()
  }, [badgeId])

  const loadConfig = useCallback(async () => {
    if (!badgeId) return
    setLoading(true)
    try {
      const res = await bomCostService.getRobotConfig(badgeId)
      setRobotConfig(res.data.config)
    } catch (err) {
      console.error('Failed to load config:', err)
    } finally {
      setLoading(false)
    }
  }, [badgeId])

  // When limb selection changes, calculate costs for the dissolved BOMs assigned to those limbs
  useEffect(() => {
    if (selectedLimbIds.length === 0) {
      setDetailedResults(null)
      return
    }
    const timer = setTimeout(() => performCalculation(), 200)
    return () => clearTimeout(timer)
  }, [selectedLimbIds, robotConfig])

  const performCalculation = async () => {
    if (!robotConfig?.limbs || selectedLimbIds.length === 0) return

    // Gather all dissolved/bom items from selected limbs
    const items = []
    for (const limbId of selectedLimbIds) {
      const limb = robotConfig.limbs.find(l => l.id === limbId)
      if (!limb) continue
      for (const ai of (limb.assigned_items || [])) {
        const itemKey = ai.type === 'dissolved'
          ? `dissolved-${ai.dissolved_bom_id}`
          : `bom-${ai.bom_id}`
        // Avoid duplicates
        if (!items.some(i => `${i.type}-${i.id}` === itemKey)) {
          items.push({
            type: ai.type,
            id: ai.type === 'dissolved' ? ai.dissolved_bom_id : ai.bom_id,
          })
        }
      }
    }

    if (items.length === 0) {
      setDetailedResults(null)
      return
    }

    setCalculating(true)
    try {
      const res = await bomCostService.calculateMixedCosts(items)
      setDetailedResults(res.data)
    } catch (err) {
      console.error('Calculation failed:', err)
      showNotification?.('Cost calculation failed', 'error')
    } finally {
      setCalculating(false)
    }
  }

  const handleLimbClick = (limb) => {
    // Toggle limb selection
    setSelectedLimbIds(prev =>
      prev.includes(limb.id)
        ? prev.filter(id => id !== limb.id)
        : [...prev, limb.id]
    )
  }

  // Items derived from selected limbs (used for export)
  const selectedItems = useMemo(() => {
    if (!robotConfig?.limbs) return []
    const items = []
    for (const limbId of selectedLimbIds) {
      const limb = robotConfig.limbs.find(l => l.id === limbId)
      if (!limb) continue
      for (const ai of (limb.assigned_items || [])) {
        const itemKey = ai.type === 'dissolved' ? `dissolved-${ai.dissolved_bom_id}` : `bom-${ai.bom_id}`
        if (!items.some(i => `${i.type}-${i.id}` === itemKey)) {
          items.push({ type: ai.type, id: ai.type === 'dissolved' ? ai.dissolved_bom_id : ai.bom_id })
        }
      }
    }
    return items
  }, [selectedLimbIds, robotConfig])

  // Build selectedItemKeys for RobotCostFigure highlighting
  const selectedItemKeys = useMemo(() => {
    if (!robotConfig?.limbs) return []
    const keys = []
    for (const limbId of selectedLimbIds) {
      const limb = robotConfig.limbs.find(l => l.id === limbId)
      if (!limb) continue
      for (const ai of (limb.assigned_items || [])) {
        const key = ai.type === 'dissolved'
          ? `dissolved-${ai.dissolved_bom_id}`
          : `bom-${ai.bom_id}`
        if (!keys.includes(key)) keys.push(key)
      }
    }
    return keys
  }, [selectedLimbIds, robotConfig])

  // Summary metrics
  const limbsWithBoms = useMemo(() => {
    return (robotConfig?.limbs || []).filter(l => l.assigned_items && l.assigned_items.length > 0).length
  }, [robotConfig])

  const topLimb = useMemo(() => {
    const limbs = (robotConfig?.limbs || []).filter(l => l.total_cost > 0)
    if (limbs.length === 0) return null
    const top = limbs.reduce((a, b) => a.total_cost > b.total_cost ? a : b)
    return { name: top.name, cost: top.total_cost }
  }, [robotConfig])

  const totalCost = detailedResults?.project_total || 0

  const typeChartData = useMemo(() => {
    if (!detailedResults?.project_by_type) return []
    return Object.entries(detailedResults.project_by_type)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }))
  }, [detailedResults])

  // Selected limb names for display
  const selectedLimbNames = useMemo(() => {
    if (!robotConfig?.limbs) return []
    return selectedLimbIds
      .map(id => robotConfig.limbs.find(l => l.id === id))
      .filter(Boolean)
      .map(l => l.name)
  }, [selectedLimbIds, robotConfig])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!badgeId) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography color="text.secondary">Select a project to begin cost analysis</Typography>
      </Box>
    )
  }

  return (
    <Box>
      {/* Summary Cards */}
      <CostSummaryCards
        totalCost={totalCost}
        bomCount={selectedLimbIds.length}
        limbCount={limbsWithBoms}
        topLimb={topLimb}
      />

      {/* Main Content: Robot (left) | Results (right) */}
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
        {/* Left Panel - Robot Figure */}
        <Box sx={{ width: { xs: '100%', md: 400 }, flexShrink: 0 }}>
          {robotConfig ? (
            <Box>
              <RobotCostFigure
                config={robotConfig}
                badgeId={badgeId}
                selectedLimb={selectedLimbIds.length === 1
                  ? robotConfig.limbs.find(l => l.id === selectedLimbIds[0])
                  : null
                }
                onLimbClick={handleLimbClick}
                selectedItemKeys={selectedItemKeys}
              />
              {/* Selected limbs indicator */}
              {selectedLimbNames.length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {selectedLimbNames.map(name => (
                    <Chip key={name} label={name} size="small" color="primary" variant="outlined" />
                  ))}
                  <Chip
                    label="Clear all"
                    size="small"
                    variant="outlined"
                    onClick={() => setSelectedLimbIds([])}
                    sx={{ cursor: 'pointer' }}
                  />
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ p: 3, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
              <Typography color="text.secondary" variant="body2">
                No robot configuration found.
                <br />
                Set up limb regions in Admin &gt; BOM Cost Robot.
              </Typography>
            </Box>
          )}
        </Box>

        {/* Right Panel - Results */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {calculating && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          )}

          {!calculating && !detailedResults && selectedLimbIds.length === 0 && (
            <Box sx={{ textAlign: 'center', py: 6, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
              <Typography color="text.secondary" variant="body1">
                Click a limb region on the robot to see its cost breakdown
              </Typography>
              <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
                Click multiple limbs to see a consolidated view
              </Typography>
            </Box>
          )}

          {!calculating && detailedResults && (
            <>
              {/* Single BOM view */}
              {detailedResults.boms?.length === 1 && (
                <Box>
                  <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
                    <CostDonutChart
                      data={typeChartData}
                      title="Cost by Part Type"
                      width={260}
                      height={260}
                    />
                  </Box>
                  <BOMCostCard bomData={detailedResults.boms[0]} />
                </Box>
              )}

              {/* Multiple BOMs view */}
              {detailedResults.boms?.length > 1 && (
                <ConsolidatedBomView
                  detailedResults={detailedResults}
                  selectedItems={selectedItems}
                  badgeId={badgeId}
                />
              )}
            </>
          )}
        </Box>
      </Box>
    </Box>
  )
}

export default CostAnalysisTab
