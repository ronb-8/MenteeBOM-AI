import { Box, Typography, Chip } from '@mui/material'
import { formatPrice } from '../utils/priceFormatter'

const AssemblyBreakdown = ({ breakdown }) => {
    if (!breakdown) {
        return null
    }

    const totalByType = Object.entries(breakdown.by_type || {})
        .sort((a, b) => b[1] - a[1])

    return (
        <Box sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                Sub-Assembly Breakdown:
            </Typography>
            
            {/* Cost by Type */}
            {totalByType.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" gutterBottom>
                        Cost by Type:
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                        {totalByType.map(([type, cost]) => (
                            <Chip
                                key={type}
                                label={`${type}: $${formatPrice(cost)}`}
                                size="small"
                                variant="outlined"
                            />
                        ))}
                    </Box>
                </Box>
            )}

            {/* Nested Assemblies */}
            {breakdown.assemblies && breakdown.assemblies.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary" gutterBottom>
                        Nested Assemblies ({breakdown.assemblies.length}):
                    </Typography>
                    {breakdown.assemblies.map((assembly, idx) => (
                        <Box
                            key={`${assembly.assembly_part_number}-${assembly.assembly_revision}-${idx}`}
                            sx={{
                                mt: 1,
                                p: 1,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider',
                            }}
                        >
                            <Typography variant="caption" fontWeight="medium">
                                {assembly.assembly_part_number} {assembly.assembly_revision}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                                {assembly.quantity} × ${formatPrice(assembly.unit_cost)} = ${formatPrice(assembly.total_cost)}
                            </Typography>
                            {assembly.sub_breakdown && (
                                <Box sx={{ mt: 1, ml: 2 }}>
                                    <AssemblyBreakdown breakdown={assembly.sub_breakdown} />
                                </Box>
                            )}
                        </Box>
                    ))}
                </Box>
            )}

        </Box>
    )
}

export default AssemblyBreakdown

