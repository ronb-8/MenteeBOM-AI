import { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Button, TextField, Chip, Paper, IconButton,
  List, ListItem, ListItemText, ListItemSecondaryAction, Collapse,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
  Autocomplete, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Divider,
} from '@mui/material'
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material'
import { bomCostService } from '../../services/bomCostService'
import { formatPrice } from '../../utils/priceFormatter'
import CostDonutChart from './CostDonutChart'

const CategoryAnalysisTab = ({ dissolvedBoms = [], selectedDissolvedIds = [], showNotification }) => {
  const [badges, setBadges] = useState([])
  const [selectedBadgeId, setSelectedBadgeId] = useState(null)
  const [categories, setCategories] = useState([])
  const [distinctVendors, setDistinctVendors] = useState([])
  const [categoryResults, setCategoryResults] = useState(null)
  const [calculating, setCalculating] = useState(false)
  const [loading, setLoading] = useState(false)

  // Category management state
  const [expandedCats, setExpandedCats] = useState({})
  const [editDialog, setEditDialog] = useState({ open: false, category: null })
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState('#1976d2')

  // Load badges for category scoping
  useEffect(() => {
    bomCostService.getProjects().then(res => {
      if (res.data.success) {
        const projects = res.data.projects || []
        setBadges(projects)
        if (projects.length > 0 && !selectedBadgeId) {
          setSelectedBadgeId(projects[0].id)
        }
      }
    })
  }, [])

  useEffect(() => {
    if (!selectedBadgeId) return
    loadCategoryData()
  }, [selectedBadgeId])

  const loadCategoryData = useCallback(async () => {
    if (!selectedBadgeId) return
    setLoading(true)
    try {
      const [catRes, vendorsRes] = await Promise.all([
        bomCostService.getVendorCategories(selectedBadgeId),
        bomCostService.getDistinctVendors(selectedBadgeId),
      ])
      setCategories(catRes.data.categories || [])
      setDistinctVendors(vendorsRes.data.vendors || [])
    } catch (err) {
      console.error('Failed to load category data:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedBadgeId])

  // Auto-calculate when dissolved selection or categories change
  useEffect(() => {
    if (selectedDissolvedIds.length > 0 && categories.length > 0 && selectedBadgeId) {
      calculateByCategory()
    } else {
      setCategoryResults(null)
    }
  }, [selectedDissolvedIds, categories, selectedBadgeId])

  const calculateByCategory = async () => {
    if (!selectedBadgeId || selectedDissolvedIds.length === 0) return
    setCalculating(true)
    try {
      // Pass dissolved BOM IDs as bom_ids for the category calculation
      const res = await bomCostService.calculateByCategory(
        selectedDissolvedIds.map(id => `dissolved-${id}`),
        selectedBadgeId
      )
      if (res.data.success) {
        setCategoryResults(res.data)
      }
    } catch (err) {
      console.error('Category calculation failed:', err)
    } finally {
      setCalculating(false)
    }
  }

  const handleCreateCategory = async () => {
    if (!newCatName.trim() || !selectedBadgeId) return
    try {
      const res = await bomCostService.createVendorCategory({
        name: newCatName.trim(),
        color: newCatColor,
        badge_id: selectedBadgeId,
      })
      if (res.data.success) {
        setCategories(prev => [...prev, res.data.category])
        setNewCatName('')
        showNotification?.(`Category "${res.data.category.name}" created`, 'success')
      }
    } catch (err) {
      showNotification?.('Failed to create category', 'error')
    }
  }

  const handleDeleteCategory = async (catId) => {
    try {
      await bomCostService.deleteVendorCategory(catId)
      setCategories(prev => prev.filter(c => c.id !== catId))
      showNotification?.('Category deleted', 'success')
    } catch (err) {
      showNotification?.('Failed to delete category', 'error')
    }
  }

  const handleUpdateCategory = async () => {
    if (!editDialog.category) return
    try {
      const res = await bomCostService.updateVendorCategory(editDialog.category.id, {
        name: editDialog.name,
        color: editDialog.color,
      })
      if (res.data.success) {
        setCategories(prev => prev.map(c => c.id === res.data.category.id ? res.data.category : c))
        setEditDialog({ open: false, category: null })
        showNotification?.('Category updated', 'success')
      }
    } catch (err) {
      showNotification?.('Failed to update category', 'error')
    }
  }

  const handleAssignVendors = async (catId, vendorStrings) => {
    try {
      await bomCostService.updateCategoryAssignments(catId, vendorStrings)
      loadCategoryData()
      showNotification?.('Vendors assigned', 'success')
    } catch (err) {
      showNotification?.('Failed to assign vendors', 'error')
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

  const chartData = categoryResults ? [
    ...categoryResults.categories.map(c => ({
      name: c.name,
      value: c.total_cost,
      color: c.color,
    })),
    ...(categoryResults.uncategorized.total_cost > 0 ? [{
      name: 'Uncategorized',
      value: categoryResults.uncategorized.total_cost,
      color: '#9e9e9e',
    }] : []),
  ] : []

  return (
    <Box>
      {/* Badge picker for category scoping */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">Categories project:</Typography>
        {badges.map(b => (
          <Chip
            key={b.id}
            label={b.name}
            onClick={() => setSelectedBadgeId(b.id)}
            color={selectedBadgeId === b.id ? 'primary' : 'default'}
            variant={selectedBadgeId === b.id ? 'filled' : 'outlined'}
            size="small"
            sx={{ borderColor: b.color, bgcolor: selectedBadgeId === b.id ? b.color : 'transparent', color: selectedBadgeId === b.id ? 'white' : 'inherit' }}
          />
        ))}
      </Box>

      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>}

      {!loading && selectedBadgeId && (
        <Box sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
          {/* Left Panel: Category Manager */}
          <Paper variant="outlined" sx={{ width: { xs: '100%', md: 340 }, flexShrink: 0, p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>
              Vendor Categories
            </Typography>

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
                          setEditDialog({ open: true, category: cat, name: cat.name, color: cat.color })
                        }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
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
                    No categories yet. Create one above.
                  </Typography>
                </Box>
              )}
            </List>
          </Paper>

          {/* Right Panel: Analysis */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {selectedDissolvedIds.length === 0 && (
              <Box sx={{ textAlign: 'center', py: 6, border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
                <Typography color="text.secondary">
                  Select Limbs BOMs at the top to see category breakdown
                </Typography>
              </Box>
            )}

            {calculating && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={32} />
              </Box>
            )}

            {!calculating && categoryResults && (
              <Box>
                <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 3 }}>
                  <CostDonutChart
                    data={chartData}
                    title="Cost by Category"
                    width={300}
                    height={300}
                  />

                  <Box sx={{ flex: 1, minWidth: 280 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Category Breakdown — Total: ${formatPrice(categoryResults.total_cost)}
                    </Typography>
                    <TableContainer component={Paper} variant="outlined">
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Category</TableCell>
                            <TableCell align="right">Cost</TableCell>
                            <TableCell align="right">%</TableCell>
                            <TableCell align="right">Vendors</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {categoryResults.categories.map(cat => (
                            <TableRow key={cat.id}>
                              <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: cat.color, flexShrink: 0 }} />
                                  <Typography variant="body2" fontWeight={600}>{cat.name}</Typography>
                                </Box>
                              </TableCell>
                              <TableCell align="right">
                                <Typography variant="body2" fontWeight={600} color="primary.main">
                                  ${formatPrice(cat.total_cost)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                <Typography variant="body2">{cat.percentage}%</Typography>
                              </TableCell>
                              <TableCell align="right">
                                <Typography variant="body2">{cat.vendor_count}</Typography>
                              </TableCell>
                            </TableRow>
                          ))}

                          {categoryResults.uncategorized.total_cost > 0 && (
                            <TableRow>
                              <TableCell>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#9e9e9e', flexShrink: 0 }} />
                                  <Typography variant="body2" fontWeight={600} color="text.secondary">Uncategorized</Typography>
                                </Box>
                              </TableCell>
                              <TableCell align="right">
                                <Typography variant="body2" color="text.secondary">
                                  ${formatPrice(categoryResults.uncategorized.total_cost)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                <Typography variant="body2" color="text.secondary">
                                  {categoryResults.uncategorized.percentage}%
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                <Typography variant="body2" color="text.secondary">
                                  {categoryResults.uncategorized.vendor_count}
                                </Typography>
                              </TableCell>
                            </TableRow>
                          )}

                          <TableRow sx={{ bgcolor: 'action.hover' }}>
                            <TableCell><Typography variant="body2" fontWeight={700}>Total</Typography></TableCell>
                            <TableCell align="right">
                              <Typography variant="body2" fontWeight={700} color="primary.main">
                                ${formatPrice(categoryResults.total_cost)}
                              </Typography>
                            </TableCell>
                            <TableCell align="right"><Typography variant="body2" fontWeight={700}>100%</Typography></TableCell>
                            <TableCell />
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                </Box>
              </Box>
            )}
          </Box>

          {/* Edit Category Dialog */}
          <Dialog open={editDialog.open} onClose={() => setEditDialog({ open: false, category: null })}>
            <DialogTitle>Edit Category</DialogTitle>
            <DialogContent sx={{ display: 'flex', gap: 2, pt: '16px !important', minWidth: 300 }}>
              <TextField
                size="small"
                label="Name"
                value={editDialog.name || ''}
                onChange={(e) => setEditDialog(prev => ({ ...prev, name: e.target.value }))}
                fullWidth
              />
              <input
                type="color"
                value={editDialog.color || '#1976d2'}
                onChange={(e) => setEditDialog(prev => ({ ...prev, color: e.target.value }))}
                style={{ width: 50, height: 40, border: 'none', cursor: 'pointer', borderRadius: 4 }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setEditDialog({ open: false, category: null })} size="small">Cancel</Button>
              <Button onClick={handleUpdateCategory} variant="contained" size="small">Save</Button>
            </DialogActions>
          </Dialog>
        </Box>
      )}
    </Box>
  )
}

export default CategoryAnalysisTab
