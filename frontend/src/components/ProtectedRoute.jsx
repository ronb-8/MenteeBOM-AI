import { Navigate } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from '../context/AuthContext'

const ProtectedRoute = ({ children, requireAdmin = false, requireAdminOrFinance = false, restrictedForFloor = false }) => {
  const { authenticated, loading, user } = useAuth()

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
        }}
      >
        <CircularProgress />
      </Box>
    )
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />
  }

  if (requireAdmin && user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />
  }

  if (requireAdminOrFinance && user?.role !== 'admin' && user?.role !== 'finance' && user?.role !== 'system') {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export default ProtectedRoute
