import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar,
  Toolbar,
  Typography,
  Button,
  IconButton,
  Badge,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Chip,
  Tooltip,
  useTheme,
  useMediaQuery,
} from '@mui/material'
import {
  Dashboard as DashboardIcon,
  AccountTree as TreeIcon,
  ShoppingCart as CartIcon,
  AdminPanelSettings as AdminIcon,
  Menu as MenuIcon,
  Logout as LogoutIcon,
  Person as PersonIcon,
  AttachMoney as MoneyIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  PrecisionManufacturing as RobotIcon,
  Settings as SettingsIcon,
  Notifications as NotificationsIcon,
  Sync as SyncIcon,
} from '@mui/icons-material'
import { useAuth } from '../context/AuthContext'
import { useThemeMode } from '../context/ThemeContext'
import { useServerConfig } from '../context/ServerConfigContext'
import { useNotification } from '../context/NotificationContext'
import UserSettingsModal from './UserSettingsModal'
import NotificationCenter from './NotificationCenter'

const NAV_HEIGHT = 44 // Compact nav height — exported so pages can use it
export { NAV_HEIGHT }

const Navigation = () => {
  const { user, logout } = useAuth()
  const { unreadCount, activeImports } = useNotification()
  const [showSettings, setShowSettings] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const { isDevMode } = useServerConfig()
  const location = useLocation()
  const navigate = useNavigate()
  const theme = useTheme()
  const { mode, toggleColorMode } = useThemeMode()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleLogout = async () => {
    await logout()
  }

  const isActive = (path) => {
    if (path === '/robot-assembly') {
      return location.pathname.startsWith('/robot-assembly')
    }
    if (path === '/assembly-bom') {
      return ['/assembly-bom', '/assembly-tree', '/parts-database'].includes(location.pathname)
    }
    return location.pathname === path
  }

  const getRoleColor = (role) => {
    switch (role) {
      case 'admin': return 'error'
      case 'engineer': return 'warning'
      case 'finance': return 'secondary'
      case 'floor_manager': return 'info'
      case 'floor': return 'success'
      case 'system': return 'primary'
      case 'viewer': return 'default'
      default: return 'default'
    }
  }

  const baseMenuItems = [
    { path: '/dashboard', label: 'Dashboard', icon: <DashboardIcon fontSize="small" /> },
    { path: '/assembly-bom', label: 'BOMs & Parts', icon: <TreeIcon fontSize="small" /> },
    ...(isDevMode ? [{ path: '/robot-assembly', label: 'Robot Assembly', icon: <RobotIcon fontSize="small" /> }] : []),
  ]

  const getMenuItems = () => {
    if (user?.role === 'floor') {
      return [
        ...baseMenuItems,
        ...(!isDevMode ? [{ path: '/robot-assembly', label: 'Robot Assembly', icon: <RobotIcon fontSize="small" /> }] : []),
        { path: '/purchases', label: 'Purchases', icon: <CartIcon fontSize="small" /> },
      ]
    }

    if (user?.role === 'finance') {
      return [
        ...baseMenuItems,
        { path: '/purchases', label: 'Purchases', icon: <CartIcon fontSize="small" /> },
        { path: '/admin/bom-cost', label: 'BOM Cost', icon: <MoneyIcon fontSize="small" /> },
      ]
    }

    if (user?.role === 'system') {
      return [
        ...baseMenuItems,
        ...(!isDevMode ? [{ path: '/robot-assembly', label: 'Robot Assembly', icon: <RobotIcon fontSize="small" /> }] : []),
        { path: '/purchases', label: 'Purchases', icon: <CartIcon fontSize="small" /> },
        { path: '/admin/bom-cost', label: 'BOM Cost', icon: <MoneyIcon fontSize="small" /> },
      ]
    }

    const additionalItems = [
      ...(!isDevMode ? [{ path: '/robot-assembly', label: 'Robot Assembly', icon: <RobotIcon fontSize="small" /> }] : []),
      { path: '/purchases', label: 'Purchases', icon: <CartIcon fontSize="small" /> },
    ]

    const adminItems = user?.role === 'admin' ? [
      { path: '/admin/bom-cost', label: 'BOM Cost', icon: <MoneyIcon fontSize="small" /> },
      { path: '/admin', label: 'Admin', icon: <AdminIcon fontSize="small" /> }
    ] : []

    return [...baseMenuItems, ...additionalItems, ...adminItems]
  }

  const menuItems = getMenuItems()

  const drawer = (
    <Box sx={{ width: 240 }} role="presentation">
      <List dense>
        {menuItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              component={Link}
              to={item.path}
              selected={isActive(item.path)}
              onClick={() => setDrawerOpen(false)}
              sx={{ py: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: '0.8rem' }} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  )

  return (
    <>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar variant="dense" sx={{ minHeight: NAV_HEIGHT, height: NAV_HEIGHT }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={() => setDrawerOpen(!drawerOpen)}
            sx={{ mr: 1, display: { md: 'none' } }}
            size="small"
          >
            <MenuIcon fontSize="small" />
          </IconButton>

          {/* Logo + name */}
          <Box sx={{ display: 'flex', alignItems: 'center', mr: 3, flexShrink: 0 }}>
            <Box
              component="img"
              src="/menteebomlogo.png"
              alt="MenteeBOM Logo"
              sx={{ height: 30, mr: 0.75 }}
            />
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, letterSpacing: '0.02em' }}>
              MenteeBOM
            </Typography>
          </Box>

          {/* Nav buttons */}
          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' }, gap: 0.25 }}>
            {menuItems.map((item) => (
              <Button
                key={item.path}
                component={Link}
                to={item.path}
                color="inherit"
                startIcon={item.icon}
                size="small"
                sx={{
                  fontSize: '0.75rem',
                  py: 0.5,
                  px: 1.25,
                  minHeight: 30,
                  backgroundColor: isActive(item.path) ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                  borderRadius: 1,
                  '& .MuiButton-startIcon': { mr: 0.5 },
                }}
              >
                {item.label}
              </Button>
            ))}
          </Box>

          {/* Right side — user info + actions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.5 }}>
              <PersonIcon sx={{ fontSize: 16, opacity: 0.7 }} />
              <Typography sx={{ fontSize: '0.75rem' }}>
                {user?.username}
              </Typography>
              <Chip
                label={user?.role ? user.role.replace('_', ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : ''}
                color={getRoleColor(user?.role)}
                size="small"
                sx={{ height: 18, '& .MuiChip-label': { px: 0.6, fontSize: '0.6rem' } }}
              />
            </Box>
            {activeImports.length > 0 && (
              <Tooltip title={
                <>
                  {activeImports.map((imp, i) => (
                    <div key={i}>
                      {imp.kind === 'update' ? 'Updating' : 'Importing'} {imp.part_number} — started by {imp.username}
                    </div>
                  ))}
                </>
              }>
                <Chip
                  size="small"
                  color="warning"
                  icon={
                    <SyncIcon sx={{
                      fontSize: '0.85rem !important',
                      animation: 'nav-import-spin 2s linear infinite',
                      '@keyframes nav-import-spin': {
                        from: { transform: 'rotate(360deg)' },
                        to: { transform: 'rotate(0deg)' },
                      },
                    }} />
                  }
                  label={activeImports.length === 1
                    ? `PDM: ${activeImports[0].part_number}`
                    : `PDM: ${activeImports.length} running`}
                  sx={{ height: 20, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                />
              </Tooltip>
            )}
            <Tooltip title="Notifications">
              <IconButton color="inherit" onClick={() => setNotifOpen(true)} size="small">
                <Badge badgeContent={unreadCount} color="error" max={99}>
                  <NotificationsIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title="User Settings">
              <IconButton color="inherit" onClick={() => setShowSettings(true)} size="small">
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <IconButton color="inherit" onClick={toggleColorMode} size="small">
                {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Logout">
              <IconButton color="inherit" onClick={handleLogout} size="small">
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Mobile Drawer */}
      <Drawer
        anchor="left"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: 240 },
        }}
      >
        {drawer}
      </Drawer>

      {/* Spacer for fixed AppBar — matches nav height */}
      <Toolbar variant="dense" sx={{ minHeight: NAV_HEIGHT }} />

      <UserSettingsModal open={showSettings} onClose={() => setShowSettings(false)} />

      <NotificationCenter open={notifOpen} onClose={() => setNotifOpen(false)} />
    </>
  )
}

export default Navigation
