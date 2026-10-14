import { useState, useMemo } from 'react'
import { Box, Tabs, Tab, Typography, Button, Menu, MenuItem, Divider, Chip, Tooltip, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Table, TableHead, TableBody, TableRow, TableCell, TableSortLabel, Alert } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CloseIcon from '@mui/icons-material/Close'
import BOMCostCard from '../BOMCostCard'
import CostDonutChart from './CostDonutChart'
import { formatPrice } from '../../utils/priceFormatter'
import { bomCostService } from '../../services/bomCostService'

const ConsolidatedPartsTable = ({ parts }) => {
  const [expandedTypes, setExpandedTypes] = useState({})

  const byType = useMemo(() => {
    const groups = {}
    for (const p of parts) {
      const t = p.part_type || 'Unknown'
      if (!groups[t]) groups[t] = []
      groups[t].push(p)
    }
    return Object.entries(groups).sort((a, b) => {
      const ta = a[1].reduce((s, p) => s + (p.total_cost || 0), 0)
      const tb = b[1].reduce((s, p) => s + (p.total_cost || 0), 0)
      return tb - ta
    })
  }, [parts])

  return (
    <Box>
      {byType.map(([type, typeParts]) => {
        const typeTotal = typeParts.reduce((s, p) => s + (p.total_cost || 0), 0)
        const isExpanded = expandedTypes[type] === true
        return (
          <Box key={type} sx={{ mb: 1.5 }}>
            <Box
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1,
                bgcolor: 'action.hover', cursor: 'pointer',
              }}
              onClick={() => setExpandedTypes(prev => ({ ...prev, [type]: !isExpanded }))}
            >
              <Typography variant="body2" fontWeight="medium">
                {type} ({typeParts.length} parts) — ${formatPrice(typeTotal)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {isExpanded ? 'collapse' : 'expand'}
              </Typography>
            </Box>
            {isExpanded && (
              <Box sx={{ maxHeight: '35vh', overflow: 'auto', mt: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5', position: 'sticky', top: 0 }}>
                      <th style={{ textAlign: 'left', padding: '6px 12px' }}>Part Number</th>
                      <th style={{ textAlign: 'left', padding: '6px 12px' }}>Description</th>
                      <th style={{ textAlign: 'left', padding: '6px 12px' }}>Vendor</th>
                      <th style={{ textAlign: 'right', padding: '6px 12px' }}>Qty</th>
                      <th style={{ textAlign: 'right', padding: '6px 12px' }}>Unit Cost</th>
                      <th style={{ textAlign: 'right', padding: '6px 12px' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeParts.sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0)).map((p, i) => (
                      <tr key={`${p.part_number}-${i}`} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '4px 12px' }}>{p.part_number} {p.revision || ''}</td>
                        <td style={{ padding: '4px 12px' }}>{p.description || '-'}</td>
                        <td style={{ padding: '4px 12px' }}>{p.vendor || '-'}</td>
                        <td style={{ padding: '4px 12px', textAlign: 'right' }}>{p.quantity}</td>
                        <td style={{ padding: '4px 12px', textAlign: 'right' }}>${formatPrice(p.unit_cost || 0)}</td>
                        <td style={{ padding: '4px 12px', textAlign: 'right', fontWeight: 600 }}>${formatPrice(p.total_cost || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/** Simple sortable parts table used inside the drill-down dialog */
const DrillDownTable = ({ rows, columns }) => {
  const [orderBy, setOrderBy] = useState(columns[0]?.key || '')
  const [orderDir, setOrderDir] = useState('asc')

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[orderBy] ?? ''
      const bv = b[orderBy] ?? ''
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return orderDir === 'asc' ? cmp : -cmp
    })
  }, [rows, orderBy, orderDir])

  const handleSort = (key) => {
    if (orderBy === key) setOrderDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setOrderBy(key); setOrderDir('asc') }
  }

  return (
    <Box sx={{ maxHeight: '55vh', overflow: 'auto' }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map(col => (
              <TableCell key={col.key} align={col.align || 'left'}>
                <TableSortLabel
                  active={orderBy === col.key}
                  direction={orderBy === col.key ? orderDir : 'asc'}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((row, i) => (
            <TableRow key={i} hover>
              {columns.map(col => (
                <TableCell key={col.key} align={col.align || 'left'}>
                  {col.format ? col.format(row[col.key], row) : (row[col.key] ?? '—')}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                No items
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  )
}

/** Dialog that shows a drill-down table for a specific issue */
const IssueDialog = ({ open, onClose, title, subtitle, rows, columns }) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle sx={{ pr: 6 }}>
      {title}
      <IconButton onClick={onClose} size="small" sx={{ position: 'absolute', right: 12, top: 12 }}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </DialogTitle>
    <DialogContent dividers>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {subtitle}
        </Typography>
      )}
      <DrillDownTable rows={rows} columns={columns} />
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose} size="small">Close</Button>
    </DialogActions>
  </Dialog>
)

const PART_COLS_WITH_VENDOR = [
  { key: 'part_number', label: 'Part Number' },
  { key: 'revision', label: 'Rev' },
  { key: 'description', label: 'Description' },
  { key: 'part_type', label: 'Part Type' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'quantity', label: 'Qty', align: 'right' },
  { key: 'unit_cost', label: 'Unit Cost', align: 'right', format: v => `$${formatPrice(v || 0)}` },
  { key: 'total_cost', label: 'Total', align: 'right', format: v => `$${formatPrice(v || 0)}` },
]
const PART_COLS_NO_VENDOR = PART_COLS_WITH_VENDOR.filter(c => c.key !== 'vendor')
const VENDOR_SUMMARY_COLS = [
  { key: 'vendor', label: 'Vendor' },
  { key: 'total_cost', label: 'Total Cost', align: 'right', format: v => `$${formatPrice(v || 0)}` },
  { key: 'part_count', label: 'Parts', align: 'right' },
]

/** Reconciliation panel: compares sum-by-type vs sum-by-vendor and surfaces data quality issues */
const CostReconciliationPanel = ({ allParts, vendorChartData }) => {
  const [dialog, setDialog] = useState(null) // { type, title, subtitle, rows, columns }

  const { grandTotal, missingVendor, missingType, zeroCost, hiddenVendorRows } = useMemo(() => {
    let grandTotal = 0
    const missingVendor = []
    const missingType = []
    const zeroCost = []
    const vendorMap = {}

    for (const p of allParts) {
      const cost = p.total_cost || 0
      grandTotal += cost
      const v = p.vendor || ''
      if (!v || v === 'Unknown') missingVendor.push(p)
      if (!p.part_type || p.part_type === 'Unknown') missingType.push(p)
      if ((p.quantity > 0) && (!p.unit_cost)) zeroCost.push(p)
      vendorMap[v || 'Unknown'] = { vendor: v || 'Unknown', total_cost: (vendorMap[v || 'Unknown']?.total_cost || 0) + cost, part_count: (vendorMap[v || 'Unknown']?.part_count || 0) + 1 }
    }

    // Vendors NOT shown in the top-10 chart
    const chartVendorNames = new Set((vendorChartData || []).map(d => d.name))
    const hiddenVendorRows = Object.values(vendorMap)
      .filter(row => !chartVendorNames.has(row.vendor))
      .sort((a, b) => b.total_cost - a.total_cost)

    return { grandTotal, missingVendor, missingType, zeroCost, hiddenVendorRows }
  }, [allParts, vendorChartData])

  const chartTotal = (vendorChartData || []).reduce((s, d) => s + (d.value || 0), 0)
  const hiddenCost = grandTotal - chartTotal
  const top10IsPartial = vendorChartData && vendorChartData.length >= 10 && hiddenCost > 0.01

  const open = (type, title, subtitle, rows, columns) =>
    setDialog({ type, title, subtitle, rows, columns })

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Cost Check:
        </Typography>

        <Chip
          size="small"
          label={`By Type = By Vendor = $${formatPrice(grandTotal)}`}
          color="success"
          variant="outlined"
        />

        {top10IsPartial && (
          <Tooltip title="Click to see which vendors are not shown in the chart">
            <Chip
              size="small"
              label={`Vendor chart: top 10 only — $${formatPrice(hiddenCost)} hidden`}
              color="info"
              variant="outlined"
              onClick={() => open('hidden', 'Vendors hidden from chart', `These ${hiddenVendorRows.length} vendor(s) are excluded from the "top 10" donut chart. Their costs are still included in the totals.`, hiddenVendorRows, VENDOR_SUMMARY_COLS)}
              sx={{ fontSize: '0.7rem', cursor: 'pointer' }}
            />
          </Tooltip>
        )}

        {missingVendor.length > 0 && (
          <Tooltip title="Click to see parts with no vendor">
            <Chip
              size="small"
              label={`${missingVendor.length} part(s) no vendor ($${formatPrice(missingVendor.reduce((s, p) => s + (p.total_cost || 0), 0))})`}
              color="warning"
              variant="filled"
              onClick={() => open('noVendor', 'Parts with no vendor assigned', 'These parts have an empty or unknown vendor field. They appear under "Unknown" in the vendor grouping and can\'t be exported by vendor correctly.', missingVendor, PART_COLS_NO_VENDOR)}
              sx={{ fontSize: '0.7rem', cursor: 'pointer' }}
            />
          </Tooltip>
        )}

        {missingType.length > 0 && (
          <Tooltip title="Click to see parts with no part type">
            <Chip
              size="small"
              label={`${missingType.length} part(s) no type ($${formatPrice(missingType.reduce((s, p) => s + (p.total_cost || 0), 0))})`}
              color="warning"
              variant="filled"
              onClick={() => open('noType', 'Parts with no part type assigned', 'These parts have an empty or unknown part_type field. They appear under "Unknown" in the part type grouping.', missingType, PART_COLS_WITH_VENDOR)}
              sx={{ fontSize: '0.7rem', cursor: 'pointer' }}
            />
          </Tooltip>
        )}

        {zeroCost.length > 0 && (
          <Tooltip title="Click to see parts missing unit cost">
            <Chip
              size="small"
              label={`${zeroCost.length} part(s) missing unit cost`}
              color="error"
              variant="outlined"
              onClick={() => open('zeroCost', 'Parts missing unit cost', 'These parts have qty > 0 but a unit cost of $0. They contribute $0 to the total. Update their price in the Parts Library to fix this.', zeroCost, PART_COLS_WITH_VENDOR)}
              sx={{ fontSize: '0.7rem', cursor: 'pointer' }}
            />
          </Tooltip>
        )}
      </Box>

      {dialog && (
        <IssueDialog
          open={Boolean(dialog)}
          onClose={() => setDialog(null)}
          title={dialog.title}
          subtitle={dialog.subtitle}
          rows={dialog.rows}
          columns={dialog.columns}
        />
      )}
    </>
  )
}

/** Compute by-type, by-vendor, and by-category from a list of parts */
const computeChartData = (parts, vendorToCategory) => {
  const byType = {}
  const byVendor = {}
  const byCategory = {}

  for (const part of parts) {
    const cost = part.total_cost || 0
    const t = part.part_type || 'Unknown'
    byType[t] = (byType[t] || 0) + cost

    const v = part.vendor || 'Unknown'
    byVendor[v] = (byVendor[v] || 0) + cost

    // Category from vendor mapping
    const catInfo = vendorToCategory[v]
    if (catInfo) {
      const catName = catInfo.name
      if (!byCategory[catName]) byCategory[catName] = { cost: 0, color: catInfo.color }
      byCategory[catName].cost += cost
    } else {
      if (!byCategory['Uncategorized']) byCategory['Uncategorized'] = { cost: 0, color: '#9e9e9e' }
      byCategory['Uncategorized'].cost += cost
    }
  }

  return {
    typeData: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
    vendorData: Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value })),
    categoryData: Object.entries(byCategory)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([name, info]) => ({ name, value: info.cost, color: info.color })),
  }
}

const ConsolidatedBomView = ({ detailedResults, selectedItems, badgeId }) => {
  const [activeTab, setActiveTab] = useState(0)
  const [exportAnchor, setExportAnchor] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [driveResult, setDriveResult] = useState(null) // { file_name, file_url, folder_url }
  const [driveError, setDriveError] = useState(null)

  const boms = detailedResults?.boms || []
  const isSingle = boms.length === 1
  const vendorToCategory = detailedResults?.vendor_to_category || {}

  const _resolveItems = () =>
    selectedItems || boms.map(b => ({
      type: b.is_dissolved ? 'dissolved' : 'bom',
      id: b.is_dissolved ? parseInt(String(b.bom_id).replace('dissolved-', '')) : b.bom_id,
    }))

  const _exportName = () => boms.map(b => b.bom_name).join('_').slice(0, 40) || 'BOM_Cost'

  const handleExport = async (groupBy) => {
    setExportAnchor(null)
    setExporting(true)
    try {
      const exportName = _exportName()
      const resp = await bomCostService.exportCostExcel(_resolveItems(), badgeId, exportName, groupBy)
      const url = URL.createObjectURL(new Blob([resp.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `${exportName}_${groupBy}_cost.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed', err)
    } finally {
      setExporting(false)
    }
  }

  const handleExportToDrive = async (groupBy) => {
    setExportAnchor(null)
    setExporting(true)
    setDriveResult(null)
    setDriveError(null)
    try {
      const resp = await bomCostService.exportCostToDrive(_resolveItems(), badgeId, _exportName(), groupBy)
      setDriveResult(resp.data)
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Upload failed'
      setDriveError(msg)
    } finally {
      setExporting(false)
    }
  }

  // Project-level category chart data
  const projectCategoryData = useMemo(() => {
    const byCat = detailedResults?.project_by_category || {}
    return Object.entries(byCat)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([name, info]) => ({ name, value: info.cost, color: info.color }))
  }, [detailedResults])

  // Consolidated parts + chart data
  const { consolidatedParts, consolidatedByType, consolidatedByVendor, allFlatParts } = useMemo(() => {
    const partsMap = {}
    const byType = {}
    const byVendor = {}
    const flatParts = []

    for (const bom of boms) {
      for (const part of (bom.direct_parts || [])) {
        const key = `${part.part_number}|${part.revision || ''}`
        if (!partsMap[key]) {
          partsMap[key] = { ...part, quantity: 0, total_cost: 0 }
        }
        partsMap[key].quantity += part.quantity || 0
        partsMap[key].total_cost += part.total_cost || 0

        const t = part.part_type || 'Unknown'
        byType[t] = (byType[t] || 0) + (part.total_cost || 0)
        const v = part.vendor || 'Unknown'
        byVendor[v] = (byVendor[v] || 0) + (part.total_cost || 0)
        flatParts.push(part)
      }
    }

    return {
      consolidatedParts: Object.values(partsMap).sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0)),
      consolidatedByType: Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })),
      // full vendor list (no slice) for chart; display sliced to top 10
      consolidatedByVendor: Object.entries(byVendor).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value })),
      allFlatParts: flatParts,
    }
  }, [boms])

  // Per-BOM chart data
  const perBomChartData = useMemo(() => {
    return boms.map(bom => computeChartData(bom.direct_parts || [], vendorToCategory))
  }, [boms, vendorToCategory])

  // Active chart data based on tab
  const activeChartData = useMemo(() => {
    if (activeTab === 0) {
      return {
        typeData: consolidatedByType,
        vendorData: consolidatedByVendor,
        categoryData: projectCategoryData,
      }
    }
    const bomIdx = activeTab - 1
    if (perBomChartData[bomIdx]) {
      return perBomChartData[bomIdx]
    }
    return { typeData: [], vendorData: [], categoryData: [] }
  }, [activeTab, consolidatedByType, consolidatedByVendor, projectCategoryData, perBomChartData])

  const totalCost = detailedResults?.project_total || 0

  return (
    <Box>
      {/* Header row: total + export button */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Total: ${formatPrice(totalCost)}
        </Typography>
        <Tooltip title="Download Excel — compatible with Google Sheets">
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={exporting ? <CircularProgress size={14} /> : <DownloadIcon />}
              onClick={(e) => setExportAnchor(e.currentTarget)}
              disabled={exporting || boms.length === 0}
            >
              Export Excel
            </Button>
          </span>
        </Tooltip>
        <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
          <MenuItem dense disabled sx={{ fontSize: '0.75rem', opacity: 0.6 }}>
            <DownloadIcon fontSize="inherit" sx={{ mr: 0.5 }} /> Download locally
          </MenuItem>
          <MenuItem onClick={() => handleExport('vendor')}>By Vendor</MenuItem>
          <MenuItem onClick={() => handleExport('part_type')}>By Part Type</MenuItem>
          <Divider />
          <MenuItem dense disabled sx={{ fontSize: '0.75rem', opacity: 0.6 }}>
            <CloudUploadIcon fontSize="inherit" sx={{ mr: 0.5 }} /> Save to Google Drive
          </MenuItem>
          <MenuItem onClick={() => handleExportToDrive('vendor')}>By Vendor → Drive</MenuItem>
          <MenuItem onClick={() => handleExportToDrive('part_type')}>By Part Type → Drive</MenuItem>
        </Menu>
      </Box>

      {/* Drive upload success modal */}
      <Dialog open={Boolean(driveResult)} onClose={() => setDriveResult(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pr: 6 }}>
          Uploaded to Google Drive
          <IconButton onClick={() => setDriveResult(null)} size="small" sx={{ position: 'absolute', right: 12, top: 12 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            <strong>{driveResult?.file_name}</strong> was uploaded successfully.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Button
              variant="contained"
              startIcon={<OpenInNewIcon />}
              href={driveResult?.file_url}
              target="_blank"
              rel="noopener noreferrer"
              fullWidth
            >
              Open file in Google Drive
            </Button>
            <Button
              variant="outlined"
              startIcon={<FolderOpenIcon />}
              href={driveResult?.folder_url}
              target="_blank"
              rel="noopener noreferrer"
              fullWidth
            >
              Open export folder
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDriveResult(null)} size="small">Close</Button>
        </DialogActions>
      </Dialog>

      {/* Drive upload error */}
      {driveError && (
        <Alert severity="error" onClose={() => setDriveError(null)} sx={{ mb: 1 }}>
          Drive upload failed: {driveError}
        </Alert>
      )}

      {/* Reconciliation panel */}
      {allFlatParts.length > 0 && (
        <CostReconciliationPanel allParts={allFlatParts} vendorChartData={activeChartData.vendorData} />
      )}

      {/* Donut charts — always visible, update based on active tab */}
      <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
        <CostDonutChart data={activeChartData.typeData} title="Cost by Part Type" width={260} height={260} />
        <CostDonutChart data={activeChartData.vendorData} title="Cost by Vendor (top 10)" width={260} height={260} totalOverride={totalCost} />
        {activeChartData.categoryData.length > 0 && (
          <CostDonutChart data={activeChartData.categoryData} title="Cost by Category" width={260} height={260} />
        )}
      </Box>

      {/* Tab bar — only show if multiple BOMs */}
      {!isSingle && (
        <Tabs
          value={activeTab}
          onChange={(e, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label={`Consolidated (${boms.length} BOMs)`} />
          {boms.map((bom, i) => (
            <Tab key={bom.bom_id} label={bom.bom_name || `BOM ${i + 1}`} />
          ))}
        </Tabs>
      )}

      {/* Consolidated view (tab 0 for multi-BOM, or the only view for single BOM) */}
      {(isSingle || activeTab === 0) && (
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {isSingle
              ? `${boms[0]?.bom_name} — ${(boms[0]?.direct_parts || []).length} parts — Total: $${formatPrice(boms[0]?.total_cost || 0)}`
              : `Consolidated Parts (${consolidatedParts.length} unique parts) — Total: $${formatPrice(totalCost)}`
            }
          </Typography>
          <ConsolidatedPartsTable parts={isSingle ? (boms[0]?.direct_parts || []) : consolidatedParts} />
        </Box>
      )}

      {/* Per-BOM views */}
      {!isSingle && activeTab > 0 && boms[activeTab - 1] && (
        <BOMCostCard bomData={boms[activeTab - 1]} />
      )}
    </Box>
  )
}

export default ConsolidatedBomView
