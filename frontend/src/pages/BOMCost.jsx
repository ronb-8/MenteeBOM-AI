import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
    Box,
    Typography,
    CircularProgress,
    Chip,
    Tabs,
    Tab,
} from '@mui/material'
import { useNotification } from '../context/NotificationContext'
import { bomCostService } from '../services/bomCostService'
import { formatPrice } from '../utils/priceFormatter'
import CostSummaryCards from '../components/bom-cost/CostSummaryCards'
import ConsolidatedBomView from '../components/bom-cost/ConsolidatedBomView'

/** Convert polygon points to a smooth closed Catmull-Rom spline SVG path */
const pointsToSmoothPath = (points, tension = 0.3) => {
    if (points.length < 3) return points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') + ' Z'

    const n = points.length
    // Wrap around for closed curve
    const pts = [...points, points[0], points[1], points[2]]

    let d = `M${points[0][0]},${points[0][1]}`
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n]
        const p1 = pts[i]
        const p2 = pts[i + 1]
        const p3 = pts[i + 2]

        const cp1x = p1[0] + (p2[0] - p0[0]) * tension
        const cp1y = p1[1] + (p2[1] - p0[1]) * tension
        const cp2x = p2[0] - (p3[0] - p1[0]) * tension
        const cp2y = p2[1] - (p3[1] - p1[1]) * tension

        d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`
    }
    d += ' Z'
    return d
}

const BOMCost = () => {
    const { showNotification } = useNotification()

    // Robot figures (tabs)
    const [figures, setFigures] = useState([])
    const [activeFigureIdx, setActiveFigureIdx] = useState(0)
    const [figuresLoading, setFiguresLoading] = useState(true)

    // Per-figure data
    const [dissolvedBoms, setDissolvedBoms] = useState([])  // with region_coords
    const [selectedIds, setSelectedIds] = useState([])
    const [limbsLoading, setLimbsLoading] = useState(false)
    const [detailedResults, setDetailedResults] = useState(null)
    const [calculating, setCalculating] = useState(false)

    // Robot image sizing
    const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })
    const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0 })
    const imgRef = useRef(null)

    // Load all robot figures
    useEffect(() => {
        setFiguresLoading(true)
        bomCostService.getRobotFigures().then(res => {
            if (res.data.success) {
                setFigures(res.data.figures || [])
            }
        }).catch(err => {
            console.error('Failed to load robot figures:', err)
            showNotification('Error loading robot figures', 'error')
        }).finally(() => setFiguresLoading(false))
    }, [])

    const activeFigure = figures[activeFigureIdx] || null
    const badgeId = activeFigure?.badge_id

    // Robot image src
    const robotImageSrc = useMemo(() => {
        if (!activeFigure) return null
        if (activeFigure.robot_image_data) return `data:image/png;base64,${activeFigure.robot_image_data}`
        if (activeFigure.robot_image_path) return `/${activeFigure.robot_image_path}`
        return null
    }, [activeFigure])

    // Load dissolved BOMs with polygon data for active figure
    useEffect(() => {
        if (!badgeId) {
            setDissolvedBoms([])
            setSelectedIds([])
            setDetailedResults(null)
            return
        }
        loadLimbs()
    }, [badgeId])

    const loadLimbs = useCallback(async () => {
        if (!badgeId) return
        setLimbsLoading(true)
        setSelectedIds([])
        setDetailedResults(null)
        try {
            const res = await bomCostService.getDissolvedBomLimbs(badgeId)
            setDissolvedBoms(res.data.dissolved_bom_limbs || [])
        } catch (err) {
            console.error('Failed to load limbs:', err)
        } finally {
            setLimbsLoading(false)
        }
    }, [badgeId])

    // Auto-calculate when selection changes
    useEffect(() => {
        if (selectedIds.length === 0) {
            setDetailedResults(null)
            return
        }
        const timer = setTimeout(() => performCalculation(), 250)
        return () => clearTimeout(timer)
    }, [selectedIds])

    const performCalculation = async () => {
        if (selectedIds.length === 0) return
        setCalculating(true)
        try {
            const items = selectedIds.map(id => ({ type: 'dissolved', id }))
            const res = await bomCostService.calculateMixedCosts(items, badgeId)
            setDetailedResults(res.data)
        } catch (err) {
            console.error('Calculation failed:', err)
            showNotification('Cost calculation failed', 'error')
        } finally {
            setCalculating(false)
        }
    }

    const handleToggle = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        )
    }

    // Robot image helpers
    const handleImageLoad = (e) => {
        setImageNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })
        updateDisplaySize()
    }

    const updateDisplaySize = () => {
        if (imgRef.current) {
            setImageDisplaySize({ width: imgRef.current.clientWidth, height: imgRef.current.clientHeight })
        }
    }

    useEffect(() => {
        const observer = new ResizeObserver(updateDisplaySize)
        if (imgRef.current) observer.observe(imgRef.current)
        return () => observer.disconnect()
    }, [robotImageSrc])

    const scaleToDisplay = useCallback((coords) => {
        if (!coords || !imageNaturalSize.width || !imageDisplaySize.width) return []
        const sx = imageDisplaySize.width / imageNaturalSize.width
        const sy = imageDisplaySize.height / imageNaturalSize.height
        return coords.map(([x, y]) => [x * sx, y * sy])
    }, [imageNaturalSize, imageDisplaySize])

    const totalCost = detailedResults?.project_total || 0

    // Only show dissolved BOMs that have regions mapped to this robot figure
    const activeBoms = dissolvedBoms.filter(d => d.region_coords)

    // Top limb (most expensive selected)
    const topLimb = useMemo(() => {
        if (!detailedResults?.boms?.length) return null
        const sorted = [...detailedResults.boms].sort((a, b) => b.total_cost - a.total_cost)
        return sorted[0] ? { name: sorted[0].bom_name, cost: sorted[0].total_cost } : null
    }, [detailedResults])

    return (
        <Box sx={{ width: '100%', height: 'calc(100vh - 44px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <Box sx={{
                px: 1.5, py: 0.75, flexShrink: 0,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: 1, borderColor: 'divider',
            }}>
                <Box>
                    <Typography variant="h5" sx={{ fontSize: '0.95rem', fontWeight: 600 }}>
                        BOM Cost Dashboard
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Cost analysis by robot figure with breakdowns by type, vendor, and category
                    </Typography>
                </Box>
            </Box>

            {figuresLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            )}

            {!figuresLoading && figures.length === 0 && (
                <Box sx={{ textAlign: 'center', py: 8 }}>
                    <Typography color="text.secondary" variant="h6">
                        No robot figures found
                    </Typography>
                    <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
                        Upload a robot image in Admin &gt; Robot Assembly first
                    </Typography>
                </Box>
            )}

            {!figuresLoading && figures.length > 0 && (
                <>
                    {/* Robot Figure Tabs */}
                    <Box sx={{ px: 1.5, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
                        <Tabs
                            value={activeFigureIdx}
                            onChange={(e, v) => {
                                setActiveFigureIdx(v)
                                setSelectedIds([])
                                setDetailedResults(null)
                            }}
                            sx={{ minHeight: 36 }}
                            variant="scrollable"
                            scrollButtons="auto"
                        >
                            {figures.map((fig, idx) => (
                                <Tab
                                    key={fig.badge_id}
                                    label={fig.badge_name}
                                    sx={{ minHeight: 36, textTransform: 'none', fontWeight: activeFigureIdx === idx ? 700 : 400 }}
                                />
                            ))}
                        </Tabs>
                    </Box>

                    {/* Limbs BOM selection chips */}
                    <Box sx={{ px: 1.5, py: 0.75, flexShrink: 0, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ flexShrink: 0 }}>
                            Limbs BOM:
                        </Typography>
                        {limbsLoading ? (
                            <CircularProgress size={20} />
                        ) : (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                {activeBoms.map((d) => {
                                    const isSelected = selectedIds.includes(d.dissolved_bom_id)
                                    return (
                                        <Chip
                                            key={d.dissolved_bom_id}
                                            label={`${d.name} — $${formatPrice(d.cost)}`}
                                            onClick={() => handleToggle(d.dissolved_bom_id)}
                                            color={isSelected ? 'primary' : 'default'}
                                            variant={isSelected ? 'filled' : 'outlined'}
                                            size="small"
                                            sx={{ fontWeight: isSelected ? 600 : 400 }}
                                        />
                                    )
                                })}
                                {activeBoms.length === 0 && (
                                    <Typography variant="body2" color="text.secondary">
                                        No Limbs BOMs mapped to this robot figure. Map them in Admin &gt; BOM Cost Robot.
                                    </Typography>
                                )}
                                {selectedIds.length > 0 && (
                                    <Chip
                                        label="Clear"
                                        size="small"
                                        variant="outlined"
                                        onClick={() => setSelectedIds([])}
                                    />
                                )}
                            </Box>
                        )}
                    </Box>

                    {/* Main content */}
                    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 3 }}>
                        <CostSummaryCards
                            totalCost={totalCost}
                            bomCount={selectedIds.length}
                            limbCount={activeBoms.length}
                            topLimb={topLimb}
                        />

                        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
                            {/* Left: Robot figure */}
                            {robotImageSrc && activeBoms.length > 0 && (
                                <Box sx={{ width: { xs: '100%', md: 380 }, flexShrink: 0 }}>
                                    <Box sx={{ position: 'relative', display: 'inline-block', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                                        <img
                                            ref={imgRef}
                                            src={robotImageSrc}
                                            alt="Robot"
                                            onLoad={handleImageLoad}
                                            style={{ maxWidth: '100%', maxHeight: '55vh', display: 'block', userSelect: 'none' }}
                                        />
                                        {imageDisplaySize.width > 0 && (
                                            <svg style={{ position: 'absolute', top: 0, left: 0, width: imageDisplaySize.width, height: imageDisplaySize.height }}>
                                                <defs>
                                                    <filter id="costGlow">
                                                        <feGaussianBlur stdDeviation="2" result="blur" />
                                                        <feMerge>
                                                            <feMergeNode in="blur" />
                                                            <feMergeNode in="SourceGraphic" />
                                                        </feMerge>
                                                    </filter>
                                                </defs>
                                                {activeBoms.map(d => {
                                                    if (!d.region_coords) return null
                                                    const scaled = scaleToDisplay(d.region_coords)
                                                    if (scaled.length < 3) return null
                                                    const isSelected = selectedIds.includes(d.dissolved_bom_id)
                                                    const path = pointsToSmoothPath(scaled)
                                                    const cx = scaled.reduce((s, p) => s + p[0], 0) / scaled.length
                                                    const cy = scaled.reduce((s, p) => s + p[1], 0) / scaled.length

                                                    return (
                                                        <g
                                                            key={d.dissolved_bom_id}
                                                            style={{ cursor: 'pointer' }}
                                                            onClick={() => handleToggle(d.dissolved_bom_id)}
                                                            pointerEvents="all"
                                                        >
                                                            <path
                                                                d={path}
                                                                fill={isSelected ? 'rgba(46, 125, 50, 0.08)' : 'rgba(75, 44, 111, 0.03)'}
                                                                stroke={isSelected ? 'rgba(46, 125, 50, 0.35)' : 'rgba(75, 44, 111, 0.12)'}
                                                                strokeWidth={isSelected ? 1.5 : 0.75}
                                                                filter={isSelected ? 'url(#costGlow)' : undefined}
                                                                style={{ transition: 'fill 0.3s, stroke 0.3s, stroke-width 0.3s' }}
                                                            />
                                                            <text
                                                                x={cx}
                                                                y={cy - 6}
                                                                textAnchor="middle"
                                                                fill={isSelected ? 'rgba(46, 125, 50, 0.75)' : 'rgba(75, 44, 111, 0.35)'}
                                                                fontSize={isSelected ? '11' : '9'}
                                                                fontWeight={isSelected ? '600' : '400'}
                                                                style={{ pointerEvents: 'none' }}
                                                            >
                                                                {d.name}
                                                            </text>
                                                            <text
                                                                x={cx}
                                                                y={cy + 10}
                                                                textAnchor="middle"
                                                                fill={isSelected ? 'rgba(46, 125, 50, 0.65)' : 'rgba(75, 44, 111, 0.3)'}
                                                                fontSize="9"
                                                                fontWeight="500"
                                                                style={{ pointerEvents: 'none' }}
                                                            >
                                                                ${formatPrice(d.cost)}
                                                            </text>
                                                        </g>
                                                    )
                                                })}
                                            </svg>
                                        )}
                                    </Box>
                                </Box>
                            )}

                            {/* Right: Results */}
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                {calculating && (
                                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                        <CircularProgress size={32} />
                                    </Box>
                                )}

                                {!calculating && !detailedResults && selectedIds.length === 0 && (
                                    <Box sx={{ textAlign: 'center', py: 6, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
                                        <Typography color="text.secondary" variant="body1">
                                            {activeBoms.length > 0
                                                ? 'Select a Limbs BOM above or click a region on the robot'
                                                : 'Select one or more Limbs BOMs above to see cost breakdowns'
                                            }
                                        </Typography>
                                    </Box>
                                )}

                                {!calculating && detailedResults && (
                                    <ConsolidatedBomView
                                        detailedResults={detailedResults}
                                        selectedItems={selectedIds.map(id => ({ type: 'dissolved', id }))}
                                        badgeId={badgeId}
                                    />
                                )}
                            </Box>
                        </Box>

                    </Box>
                </>
            )}
        </Box>
    )
}

export default BOMCost
