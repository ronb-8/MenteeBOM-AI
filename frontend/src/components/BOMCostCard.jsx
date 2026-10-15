import { useState } from 'react'
import {
    Card,
    CardContent,
    CardHeader,
    Typography,
    Box,
    Collapse,
    IconButton,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Chip,
} from '@mui/material'
import {
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
} from '@mui/icons-material'
import { useCurrency } from '../context/CurrencyContext'

const BOMCostCard = ({ bomData }) => {
    const { formatCost } = useCurrency()
    const [expanded, setExpanded] = useState(true)
    const [typeBreakdownExpanded, setTypeBreakdownExpanded] = useState({})

    const totalByType = Object.entries(bomData.by_type || {})
        .sort((a, b) => b[1] - a[1])

    return (
        <Card sx={{ mb: 2 }}>
            <CardHeader
                title={
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="h6">{bomData.bom_name}</Typography>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            {bomData.assembly_unit_cost != null && (
                                <Chip
                                    label={`Assembly Price: ${formatCost(bomData.assembly_unit_cost)}`}
                                    color="default"
                                    size="small"
                                    variant="outlined"
                                />
                            )}
                            <Typography variant="h6" color="primary" sx={{ fontWeight: 'bold' }}>
                                {formatCost(bomData.total_cost)}
                            </Typography>
                        </Box>
                    </Box>
                }
                subheader={`${bomData.assembly_part_number} | Version: ${bomData.version}`}
                action={
                    <IconButton onClick={() => setExpanded(!expanded)}>
                        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                }
            />
            <Collapse in={expanded}>
                <CardContent>
                    {/* Part Type Summary */}
                    {totalByType.length > 0 && (
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                                Cost by Part Type:
                            </Typography>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                                {totalByType.map(([type, cost]) => (
                                    <Chip
                                        key={type}
                                        label={`${type}: ${formatCost(cost)}`}
                                        color="primary"
                                        variant="outlined"
                                    />
                                ))}
                            </Box>
                        </Box>
                    )}

                    {/* Detailed Parts Breakdown by Type */}
                    {bomData.direct_parts && bomData.direct_parts.length > 0 && (
                        <Box sx={{ mb: 3 }}>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                                Parts Breakdown by Type:
                            </Typography>
                            {Object.entries(
                                bomData.direct_parts.reduce((acc, part) => {
                                    const type = part.part_type || 'Unknown'
                                    if (!acc[type]) acc[type] = []
                                    acc[type].push(part)
                                    return acc
                                }, {})
                            )
                                .sort((a, b) => {
                                    const totalA = a[1].reduce((sum, p) => sum + (p.total_cost || 0), 0)
                                    const totalB = b[1].reduce((sum, p) => sum + (p.total_cost || 0), 0)
                                    return totalB - totalA
                                })
                                .map(([type, parts]) => {
                                    const typeKey = type
                                    const isExpanded = typeBreakdownExpanded[typeKey] === true // Default to collapsed
                                    const typeTotal = parts.reduce((sum, p) => sum + (p.total_cost || 0), 0)
                                    
                                    return (
                                        <Box key={type} sx={{ mb: 2 }}>
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    p: 1,
                                                    border: '1px solid',
                                                    borderColor: 'divider',
                                                    borderRadius: 1,
                                                    bgcolor: 'action.hover',
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() => setTypeBreakdownExpanded(prev => ({
                                                    ...prev,
                                                    [typeKey]: !isExpanded
                                                }))}
                                            >
                                                <Typography variant="body2" fontWeight="medium">
                                                    {type} ({parts.length} parts) - Total: {formatCost(typeTotal)}
                                                </Typography>
                                                <IconButton size="small">
                                                    {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                                </IconButton>
                                            </Box>
                                            <Collapse in={isExpanded}>
                                                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '35vh', overflow: 'auto', mt: 1 }}>
                                                    <Table size="small" stickyHeader>
                                                        <TableHead>
                                                            <TableRow>
                                                                <TableCell>Part Number</TableCell>
                                                                <TableCell>Description</TableCell>
                                                                <TableCell align="right">Qty</TableCell>
                                                                <TableCell align="right">Unit Cost</TableCell>
                                                                <TableCell align="right">Total Cost</TableCell>
                                                            </TableRow>
                                                        </TableHead>
                                                        <TableBody>
                                                            {parts
                                                                .sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0))
                                                                .map((part, idx) => (
                                                                    <TableRow key={`${part.part_number}-${part.revision}-${idx}`}>
                                                                        <TableCell>
                                                                            {part.part_number} {part.revision}
                                                                        </TableCell>
                                                                        <TableCell>{part.description || '-'}</TableCell>
                                                                        <TableCell align="right">{part.quantity}</TableCell>
                                                                        <TableCell align="right">{formatCost(part.unit_cost || 0)}</TableCell>
                                                                        <TableCell align="right">
                                                                            <Typography fontWeight="medium">
                                                                                {formatCost(part.total_cost || 0)}
                                                                            </Typography>
                                                                        </TableCell>
                                                                    </TableRow>
                                                                ))}
                                                        </TableBody>
                                                    </Table>
                                                </TableContainer>
                                            </Collapse>
                                        </Box>
                                    )
                                })}
                        </Box>
                    )}


                </CardContent>
            </Collapse>
        </Card>
    )
}

export default BOMCostCard

