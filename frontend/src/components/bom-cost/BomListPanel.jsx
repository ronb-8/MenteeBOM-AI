import { Box, Typography, Checkbox, Chip, Paper, Divider } from '@mui/material'
import { formatPrice } from '../../utils/priceFormatter'

const BomListPanel = ({
  items = [],          // [{ key, type, id, name, cost, parts_count?, assembly_part_number?, dissolve_mode? }]
  selectedKeys = [],   // ['dissolved-5', 'bom-12']
  onToggleItem,        // (key) => void
  limbMappings = {},   // { key: limb_name }
  onSelectAll,
  onClearAll,
}) => {
  const allSelected = items.length > 0 && items.every(it => selectedKeys.includes(it.key))
  const someSelected = selectedKeys.length > 0 && !allSelected

  return (
    <Paper variant="outlined" sx={{ maxHeight: 350, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Checkbox
            size="small"
            checked={allSelected}
            indeterminate={someSelected}
            onChange={() => allSelected ? onClearAll?.() : onSelectAll?.()}
          />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            BOMs ({items.length})
          </Typography>
        </Box>
        {selectedKeys.length > 0 && (
          <Chip
            label={`${selectedKeys.length} selected`}
            size="small"
            color="primary"
            variant="outlined"
          />
        )}
      </Box>

      <Box sx={{ overflow: 'auto', flex: 1 }}>
        {items.map((item, i) => {
          const isSelected = selectedKeys.includes(item.key)
          const limbName = limbMappings[item.key]

          return (
            <Box key={item.key}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 0.75,
                  cursor: 'pointer',
                  bgcolor: isSelected ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
                  transition: 'background 0.15s',
                }}
                onClick={() => onToggleItem(item.key)}
              >
                <Checkbox size="small" checked={isSelected} tabIndex={-1} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: isSelected ? 600 : 400 }}>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {item.type === 'dissolved'
                      ? `Dissolved • ${item.parts_count || 0} parts`
                      : item.assembly_part_number || ''
                    }
                  </Typography>
                </Box>
                {limbName && (
                  <Chip label={limbName} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                )}
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    color: item.type === 'dissolved' ? 'success.main' : 'primary.main',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ${formatPrice(item.cost || 0)}
                </Typography>
              </Box>
              {i < items.length - 1 && <Divider />}
            </Box>
          )
        })}
        {items.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">No BOMs available for this project</Typography>
          </Box>
        )}
      </Box>
    </Paper>
  )
}

export default BomListPanel
