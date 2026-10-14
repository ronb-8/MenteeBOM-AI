import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Box, Typography, Button, Card, CardContent, CardHeader,
  Chip, CircularProgress, Alert, Paper, Tab, Tabs,
  TextField, IconButton, List, ListItem, ListItemText,
  ListItemSecondaryAction, Collapse, Divider, Autocomplete,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import {
  Save as SaveIcon,
  Cancel as CancelIcon,
  Undo as UndoIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  CloudUpload as CloudUploadIcon,
} from '@mui/icons-material'
import { bomCostService } from '../../services/bomCostService'
import { formatPrice } from '../../utils/priceFormatter'

/** Convert polygon points to a smooth closed Catmull-Rom spline SVG path */
const pointsToSmoothPath = (points, tension = 0.3) => {
  if (points.length < 3) return points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') + ' Z'
  const n = points.length
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

const CostRobotAdmin = () => {
  // Robot figures (sub-tabs)
  const [figures, setFigures] = useState([])
  const [activeFigureIdx, setActiveFigureIdx] = useState(0)
  const [loading, setLoading] = useState(false)

  // Dissolved BOMs as limbs
  const [dissolvedLimbs, setDissolvedLimbs] = useState([])
  const [selectedDissolvedId, setSelectedDissolvedId] = useState(null)
  const [limbsLoading, setLimbsLoading] = useState(false)

  // Image / polygon editing
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 })
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0 })
  const [editingRegion, setEditingRegion] = useState(false)
  const [polygonPoints, setPolygonPoints] = useState([])
  const regionImageRef = useRef(null)

  // Add robot figure dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [newFigureName, setNewFigureName] = useState('')
  const [newFigureImage, setNewFigureImage] = useState(null)
  const [newFigureImagePreview, setNewFigureImagePreview] = useState(null)
  const [addingFigure, setAddingFigure] = useState(false)

  // Vendor category management
  const [categories, setCategories] = useState([])
  const [distinctVendors, setDistinctVendors] = useState([])
  const [expandedCats, setExpandedCats] = useState({})
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState('#1976d2')
  const [catsLoading, setCatsLoading] = useState(false)

  // Load all robot figures
  useEffect(() => {
    setLoading(true)
    bomCostService.getRobotFigures().then(res => {
      if (res.data.success) {
        setFigures(res.data.figures || [])
      }
    }).catch(err => {
      console.error('Failed to load robot figures:', err)
    }).finally(() => setLoading(false))
  }, [])

  const activeFigure = figures[activeFigureIdx] || null
  const badgeId = activeFigure?.badge_id

  // Get robot image src
  const robotImage = activeFigure
    ? (activeFigure.robot_image_data
      ? `data:image/png;base64,${activeFigure.robot_image_data}`
      : activeFigure.robot_image_path
        ? `/${activeFigure.robot_image_path}`
        : null)
    : null

  // Load dissolved BOMs with polygon data when figure changes
  useEffect(() => {
    if (!badgeId) {
      setDissolvedLimbs([])
      setSelectedDissolvedId(null)
      return
    }
    loadLimbs()
  }, [badgeId])

  const loadLimbs = useCallback(async () => {
    if (!badgeId) return
    setLimbsLoading(true)
    try {
      const res = await bomCostService.getDissolvedBomLimbs(badgeId)
      setDissolvedLimbs(res.data.dissolved_bom_limbs || [])
    } catch (err) {
      console.error('Failed to load dissolved limbs:', err)
    } finally {
      setLimbsLoading(false)
    }
  }, [badgeId])

  // Add new robot figure
  const handleAddFigure = async () => {
    if (!newFigureName.trim() || !newFigureImage) return
    setAddingFigure(true)
    try {
      const formData = new FormData()
      formData.append('name', newFigureName.trim())
      formData.append('robot_image', newFigureImage)
      const res = await bomCostService.createRobotFigure(formData)
      if (res.data.success) {
        setFigures(prev => [...prev, res.data.figure])
        setActiveFigureIdx(figures.length) // switch to new tab
        handleCloseAddDialog()
      }
    } catch (err) {
      console.error('Failed to add robot figure:', err)
    } finally {
      setAddingFigure(false)
    }
  }

  const handleDeleteFigure = async (badgeId) => {
    if (!window.confirm('Remove this robot figure? The badge will remain but the figure image will be removed.')) return
    try {
      await bomCostService.deleteRobotFigure(badgeId)
      const newFigures = figures.filter(f => f.badge_id !== badgeId)
      setFigures(newFigures)
      if (activeFigureIdx >= newFigures.length) {
        setActiveFigureIdx(Math.max(0, newFigures.length - 1))
      }
    } catch (err) {
      console.error('Failed to delete robot figure:', err)
    }
  }

  const handleCloseAddDialog = () => {
    setAddDialogOpen(false)
    setNewFigureName('')
    setNewFigureImage(null)
    setNewFigureImagePreview(null)
  }

  const handleImageFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      setNewFigureImage(file)
      const reader = new FileReader()
      reader.onload = (ev) => setNewFigureImagePreview(ev.target.result)
      reader.readAsDataURL(file)
    }
  }

  // Load vendor categories when badge changes
  useEffect(() => {
    if (!badgeId) {
      setCategories([])
      setDistinctVendors([])
      return
    }
    loadCategories()
  }, [badgeId])

  const loadCategories = useCallback(async () => {
    if (!badgeId) return
    setCatsLoading(true)
    try {
      const [catRes, vendorsRes] = await Promise.all([
        bomCostService.getVendorCategories(badgeId),
        bomCostService.getDistinctVendors(badgeId),
      ])
      setCategories(catRes.data.categories || [])
      setDistinctVendors(vendorsRes.data.vendors || [])
    } catch (err) {
      console.error('Failed to load categories:', err)
    } finally {
      setCatsLoading(false)
    }
  }, [badgeId])

  const handleCreateCategory = async () => {
    if (!newCatName.trim() || !badgeId) return
    try {
      const res = await bomCostService.createVendorCategory({
        name: newCatName.trim(),
        color: newCatColor,
        badge_id: badgeId,
      })
      if (res.data.success) {
        setCategories(prev => [...prev, res.data.category])
        setNewCatName('')
      }
    } catch (err) {
      console.error('Failed to create category:', err)
    }
  }

  const handleDeleteCategory = async (catId) => {
    try {
      await bomCostService.deleteVendorCategory(catId)
      setCategories(prev => prev.filter(c => c.id !== catId))
    } catch (err) {
      console.error('Failed to delete category:', err)
    }
  }

  const handleAssignVendors = async (catId, vendorStrings) => {
    try {
      await bomCostService.updateCategoryAssignments(catId, vendorStrings)
      loadCategories()
    } catch (err) {
      console.error('Failed to assign vendors:', err)
    }
  }

  const getUnassignedVendors = () => {
    const allAssigned = new Set()
    for (const cat of categories) {
      for (const vs of (cat.vendor_strings || [])) {
        allAssigned.add(vs)
      }
    }
    return distinctVendors.filter(v => !allAssigned.has(v))
  }

  // Image sizing
  const handleImageLoad = (e) => {
    setImageNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })
    updateDisplaySize()
  }

  const updateDisplaySize = () => {
    if (regionImageRef.current) {
      setImageDisplaySize({
        width: regionImageRef.current.clientWidth,
        height: regionImageRef.current.clientHeight,
      })
    }
  }

  useEffect(() => {
    const observer = new ResizeObserver(updateDisplaySize)
    if (regionImageRef.current) observer.observe(regionImageRef.current)
    return () => observer.disconnect()
  }, [robotImage])

  // Polygon drawing
  const handleRegionImageClick = useCallback((e) => {
    if (!editingRegion || !imageNaturalSize.width) return
    const rect = regionImageRef.current.getBoundingClientRect()
    const displayX = e.clientX - rect.left
    const displayY = e.clientY - rect.top
    const scaleX = imageNaturalSize.width / regionImageRef.current.clientWidth
    const scaleY = imageNaturalSize.height / regionImageRef.current.clientHeight
    const naturalX = Math.round(displayX * scaleX)
    const naturalY = Math.round(displayY * scaleY)
    setPolygonPoints(prev => [...prev, [naturalX, naturalY]])
  }, [editingRegion, imageNaturalSize])

  const scaleToDisplay = useCallback((coords) => {
    if (!coords || !imageNaturalSize.width || !imageDisplaySize.width) return []
    const scaleX = imageDisplaySize.width / imageNaturalSize.width
    const scaleY = imageDisplaySize.height / imageNaturalSize.height
    return coords.map(([x, y]) => [x * scaleX, y * scaleY])
  }, [imageNaturalSize, imageDisplaySize])

  const handleSaveRegion = async () => {
    if (!selectedDissolvedId || polygonPoints.length < 3 || !badgeId) return
    try {
      await bomCostService.saveDissolvedBomRegion(selectedDissolvedId, badgeId, polygonPoints)
      setEditingRegion(false)
      setPolygonPoints([])
      loadLimbs()
    } catch (err) {
      console.error('Failed to save region:', err)
    }
  }

  const handleClearRegion = async () => {
    if (!selectedDissolvedId || !badgeId) return
    try {
      await bomCostService.saveDissolvedBomRegion(selectedDissolvedId, badgeId, null)
      loadLimbs()
    } catch (err) {
      console.error('Failed to clear region:', err)
    }
  }

  const selectedDissolved = dissolvedLimbs.find(d => d.dissolved_bom_id === selectedDissolvedId)

  return (
    <Box>
      <Typography variant="h6" gutterBottom>BOM Cost Robot Configuration</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Map Limbs BOMs onto the robot figure. Select a robot, pick a Limbs BOM, then draw its polygon region.
      </Typography>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && figures.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No robot figures found. Add one below.
        </Alert>
      )}

      {/* Add Robot Figure button (always visible when not loading) */}
      {!loading && (
        <>
          {/* Robot Figure Sub-Tabs */}
          <Paper variant="outlined" sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {figures.length > 0 && (
                <Tabs
                  value={activeFigureIdx}
                  onChange={(e, v) => {
                    setActiveFigureIdx(v)
                    setSelectedDissolvedId(null)
                    setEditingRegion(false)
                    setPolygonPoints([])
                  }}
                  sx={{ minHeight: 42, px: 1, flex: 1 }}
                  variant="scrollable"
                  scrollButtons="auto"
                >
                  {figures.map((fig, idx) => (
                    <Tab
                      key={fig.badge_id}
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {fig.badge_name}
                          {activeFigureIdx === idx && (
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteFigure(fig.badge_id)
                              }}
                              sx={{ ml: 0.5, p: 0.25, opacity: 0.5, '&:hover': { opacity: 1, color: 'error.main' } }}
                            >
                              <DeleteIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          )}
                        </Box>
                      }
                      sx={{
                        minHeight: 42,
                        textTransform: 'none',
                        fontWeight: activeFigureIdx === idx ? 700 : 400,
                      }}
                    />
                  ))}
                </Tabs>
              )}
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => setAddDialogOpen(true)}
                sx={{ mx: 1, flexShrink: 0, textTransform: 'none' }}
              >
                Add Robot
              </Button>
            </Box>
          </Paper>

          {limbsLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {!limbsLoading && activeFigure && (
            <>
              {/* Dissolved BOMs as selectable chips */}
              {dissolvedLimbs.length > 0 && (
                <Card variant="outlined" sx={{ mb: 2 }}>
                  <CardHeader
                    title="Limbs BOMs"
                    titleTypographyProps={{ variant: 'subtitle1' }}
                    subheader="Select a Limbs BOM to draw or edit its polygon region on the robot"
                    subheaderTypographyProps={{ variant: 'caption' }}
                  />
                  <CardContent sx={{ pt: 0 }}>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {dissolvedLimbs.map(d => {
                        const isSelected = selectedDissolvedId === d.dissolved_bom_id
                        const hasRegion = !!d.region_coords
                        return (
                          <Chip
                            key={d.dissolved_bom_id}
                            label={`${d.name} ($${formatPrice(d.cost)})`}
                            onClick={() => {
                              setSelectedDissolvedId(isSelected ? null : d.dissolved_bom_id)
                              setEditingRegion(false)
                              setPolygonPoints([])
                            }}
                            color={isSelected ? 'primary' : 'default'}
                            variant={isSelected ? 'filled' : 'outlined'}
                            sx={{
                              borderColor: hasRegion ? 'success.main' : 'divider',
                              fontWeight: isSelected ? 600 : 400,
                            }}
                          />
                        )
                      })}
                    </Box>

                    {/* Legend */}
                    <Box sx={{ mt: 1.5, display: 'flex', gap: 2, alignItems: 'center' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 12, height: 12, border: '2px solid', borderColor: 'success.main', borderRadius: '50%' }} />
                        <Typography variant="caption" color="text.secondary">Has polygon</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ width: 12, height: 12, border: '2px solid', borderColor: 'divider', borderRadius: '50%' }} />
                        <Typography variant="caption" color="text.secondary">No polygon</Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              )}

              {dissolvedLimbs.length === 0 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  No Limbs BOMs found. Create them in the Limbs BOM tab first.
                </Alert>
              )}

              {/* Robot Image with polygon editor */}
              {robotImage && (
                <Card variant="outlined">
                  <CardHeader
                    title={selectedDissolved ? `Drawing region for: ${selectedDissolved.name}` : `Robot Figure — ${activeFigure.badge_name}`}
                    titleTypographyProps={{ variant: 'subtitle1' }}
                  />
                  <CardContent>
                    <Box sx={{
                      position: 'relative',
                      display: 'inline-block',
                      border: editingRegion ? '2px dashed' : '1px solid',
                      borderColor: editingRegion ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      cursor: editingRegion ? 'crosshair' : 'default',
                    }}>
                      <img
                        ref={regionImageRef}
                        src={robotImage}
                        alt="Cost robot"
                        onLoad={handleImageLoad}
                        onClick={handleRegionImageClick}
                        style={{ maxWidth: '100%', maxHeight: '60vh', display: 'block', userSelect: 'none' }}
                      />

                      {/* SVG overlay */}
                      {imageDisplaySize.width > 0 && (
                        <svg style={{ position: 'absolute', top: 0, left: 0, width: imageDisplaySize.width, height: imageDisplaySize.height, pointerEvents: 'none' }}>
                          {/* All existing dissolved BOM polygons (smooth spline) */}
                          {dissolvedLimbs.map(d => {
                            if (!d.region_coords || d.dissolved_bom_id === selectedDissolvedId) return null
                            const scaled = scaleToDisplay(d.region_coords)
                            if (scaled.length < 3) return null
                            const path = pointsToSmoothPath(scaled)
                            return (
                              <g key={d.dissolved_bom_id}>
                                <path d={path} fill="rgba(100,100,100,0.06)" stroke="rgba(46,125,50,0.3)" strokeWidth={1} strokeDasharray="4 2" />
                                <text
                                  x={scaled.reduce((s, p) => s + p[0], 0) / scaled.length}
                                  y={scaled.reduce((s, p) => s + p[1], 0) / scaled.length}
                                  textAnchor="middle"
                                  fill="rgba(46,125,50,0.6)"
                                  fontSize="10"
                                  fontWeight="500"
                                >
                                  {d.name}
                                </text>
                              </g>
                            )
                          })}

                          {/* Selected dissolved BOM's existing polygon (smooth, when not editing) */}
                          {!editingRegion && selectedDissolved?.region_coords && (() => {
                            const scaled = scaleToDisplay(selectedDissolved.region_coords)
                            if (scaled.length < 3) return null
                            const path = pointsToSmoothPath(scaled)
                            return (
                              <g>
                                <path d={path} fill="rgba(75,44,111,0.1)" stroke="rgba(75,44,111,0.5)" strokeWidth={1.5} />
                                <text
                                  x={scaled.reduce((s, p) => s + p[0], 0) / scaled.length}
                                  y={scaled.reduce((s, p) => s + p[1], 0) / scaled.length}
                                  textAnchor="middle"
                                  fill="rgba(75,44,111,0.7)"
                                  fontSize="11"
                                  fontWeight="600"
                                >
                                  {selectedDissolved.name}
                                </text>
                              </g>
                            )
                          })()}

                          {/* Current editing polygon */}
                          {editingRegion && polygonPoints.length > 0 && (() => {
                            const scaled = scaleToDisplay(polygonPoints)
                            const path = scaled.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') + (scaled.length >= 3 ? ' Z' : '')
                            return (
                              <>
                                <path d={path} fill="rgba(75,44,111,0.15)" stroke="rgba(75,44,111,0.7)" strokeWidth={2} />
                                {scaled.map((pt, i) => (
                                  <circle key={i} cx={pt[0]} cy={pt[1]} r={4} fill={i === 0 ? '#4B2C6F' : '#7E57C2'} stroke="white" strokeWidth={1} />
                                ))}
                              </>
                            )
                          })()}
                        </svg>
                      )}
                    </Box>

                    {/* Polygon editor controls */}
                    {selectedDissolvedId && (
                      <Box sx={{ mt: 2 }}>
                        {editingRegion ? (
                          <Box>
                            <Alert severity="info" sx={{ mb: 1 }}>
                              Click on the image to place polygon points for "{selectedDissolved?.name}". Min 3 points. Points: {polygonPoints.length}
                            </Alert>
                            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                              <Button size="small" startIcon={<UndoIcon />} onClick={() => setPolygonPoints(prev => prev.slice(0, -1))} disabled={polygonPoints.length === 0}>
                                Undo
                              </Button>
                              <Button size="small" onClick={() => setPolygonPoints([])}>Clear</Button>
                              <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={handleSaveRegion} disabled={polygonPoints.length < 3}>
                                Save Region
                              </Button>
                              <Button size="small" startIcon={<CancelIcon />} onClick={() => { setEditingRegion(false); setPolygonPoints([]) }}>
                                Cancel
                              </Button>
                            </Box>
                          </Box>
                        ) : (
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button size="small" variant="outlined" onClick={() => {
                              setEditingRegion(true)
                              setPolygonPoints(selectedDissolved?.region_coords || [])
                            }}>
                              {selectedDissolved?.region_coords ? 'Edit Region' : 'Draw Region'}
                            </Button>
                            {selectedDissolved?.region_coords && (
                              <Button size="small" color="error" variant="outlined" onClick={handleClearRegion}>
                                Clear Region
                              </Button>
                            )}
                          </Box>
                        )}
                      </Box>
                    )}

                    {!selectedDissolvedId && dissolvedLimbs.length > 0 && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                        Select a Limbs BOM above to draw its polygon region on the robot.
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Vendor Categories Manager */}
              <Card variant="outlined" sx={{ mt: 2 }}>
                <CardHeader
                  title="Vendor Categories"
                  titleTypographyProps={{ variant: 'subtitle1' }}
                  subheader="Group vendors into categories for cost analysis"
                  subheaderTypographyProps={{ variant: 'caption' }}
                />
                <CardContent sx={{ pt: 0 }}>
                  {catsLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                      <CircularProgress size={20} />
                    </Box>
                  ) : (
                    <>
                      {/* Create category */}
                      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                        <TextField
                          size="small"
                          placeholder="Category name"
                          value={newCatName}
                          onChange={(e) => setNewCatName(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
                          sx={{ flex: 1 }}
                        />
                        <input
                          type="color"
                          value={newCatColor}
                          onChange={(e) => setNewCatColor(e.target.value)}
                          style={{ width: 36, height: 36, border: 'none', cursor: 'pointer', borderRadius: 4 }}
                        />
                        <IconButton color="primary" onClick={handleCreateCategory} disabled={!newCatName.trim()} size="small">
                          <AddIcon />
                        </IconButton>
                      </Box>

                      {/* Category list */}
                      <List dense sx={{ mx: -2 }}>
                        {categories.map(cat => {
                          const isExpanded = expandedCats[cat.id]
                          const unassigned = getUnassignedVendors()

                          return (
                            <Box key={cat.id}>
                              <ListItem
                                sx={{ cursor: 'pointer' }}
                                onClick={() => setExpandedCats(prev => ({ ...prev, [cat.id]: !isExpanded }))}
                              >
                                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: cat.color, mr: 1.5, flexShrink: 0 }} />
                                <ListItemText
                                  primary={cat.name}
                                  secondary={`${(cat.vendor_strings || []).length} vendors`}
                                  primaryTypographyProps={{ fontWeight: 600, variant: 'body2' }}
                                  secondaryTypographyProps={{ variant: 'caption' }}
                                />
                                <ListItemSecondaryAction>
                                  <IconButton size="small" onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteCategory(cat.id)
                                  }}>
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                  {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                                </ListItemSecondaryAction>
                              </ListItem>

                              <Collapse in={isExpanded}>
                                <Box sx={{ pl: 4, pr: 2, pb: 1.5 }}>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                                    {(cat.vendor_strings || []).map(vs => (
                                      <Chip
                                        key={vs}
                                        label={vs}
                                        size="small"
                                        onDelete={() => {
                                          const updated = (cat.vendor_strings || []).filter(v => v !== vs)
                                          handleAssignVendors(cat.id, updated)
                                        }}
                                        sx={{ fontSize: '0.7rem' }}
                                      />
                                    ))}
                                  </Box>
                                  <Autocomplete
                                    size="small"
                                    options={unassigned}
                                    onChange={(e, value) => {
                                      if (value) {
                                        handleAssignVendors(cat.id, [...(cat.vendor_strings || []), value])
                                      }
                                    }}
                                    renderInput={(params) => (
                                      <TextField {...params} placeholder="Add vendor..." variant="outlined" size="small" />
                                    )}
                                    clearOnEscape
                                    blurOnSelect
                                    value={null}
                                    sx={{ mt: 0.5 }}
                                  />
                                </Box>
                              </Collapse>
                              <Divider />
                            </Box>
                          )
                        })}
                        {categories.length === 0 && (
                          <Box sx={{ p: 2, textAlign: 'center' }}>
                            <Typography variant="body2" color="text.secondary">
                              No categories yet. Create one above to group vendors.
                            </Typography>
                          </Box>
                        )}
                      </List>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {/* Add Robot Figure Dialog */}
      <Dialog open={addDialogOpen} onClose={handleCloseAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Add Robot Figure</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Figure Name"
            placeholder="e.g. v3.3"
            value={newFigureName}
            onChange={(e) => setNewFigureName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            size="small"
          />
          <Button
            variant="outlined"
            component="label"
            startIcon={<CloudUploadIcon />}
            fullWidth
            sx={{ mb: 2, textTransform: 'none' }}
          >
            {newFigureImage ? newFigureImage.name : 'Upload Robot Image'}
            <input
              type="file"
              hidden
              accept="image/*"
              onChange={handleImageFileChange}
            />
          </Button>
          {newFigureImagePreview && (
            <Box sx={{ textAlign: 'center' }}>
              <img
                src={newFigureImagePreview}
                alt="Preview"
                style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 4, border: '1px solid #ddd' }}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAddDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAddFigure}
            disabled={!newFigureName.trim() || !newFigureImage || addingFigure}
          >
            {addingFigure ? 'Adding...' : 'Add Figure'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default CostRobotAdmin
