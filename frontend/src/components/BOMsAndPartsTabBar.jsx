import { Tabs, Tab, Box } from '@mui/material'
import { useLocation, useNavigate } from 'react-router-dom'

const TABS = [
  { label: 'Parts only Assemblies', path: '/assembly-bom' },
  { label: 'Tree Assemblies', path: '/assembly-tree' },
  { label: 'Parts List in DataBase', path: '/parts-database' },
  { label: 'Limbs BOMs', path: '/limbs-bom' },
]

const BOMsAndPartsTabBar = () => {
  const location = useLocation()
  const navigate = useNavigate()

  const activeIndex = TABS.findIndex(t => t.path === location.pathname)
  const value = activeIndex >= 0 ? activeIndex : 0

  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
      <Tabs
        value={value}
        onChange={(_, idx) => navigate(TABS[idx].path)}
        variant="scrollable"
        scrollButtons="auto"
      >
        {TABS.map(tab => (
          <Tab key={tab.path} label={tab.label} />
        ))}
      </Tabs>
    </Box>
  )
}

export default BOMsAndPartsTabBar
