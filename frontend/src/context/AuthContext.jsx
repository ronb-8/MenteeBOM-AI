import { createContext, useContext, useState, useEffect } from 'react'
import { authService } from '../services/authService'

const AuthContext = createContext()

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const result = await authService.checkAuth()
      if (result.authenticated) {
        setAuthenticated(true)
        setUser(result.user)
      } else {
        setAuthenticated(false)
        setUser(null)
      }
    } catch (error) {
      setAuthenticated(false)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const login = async (username, password) => {
    try {
      const result = await authService.login(username, password)
      if (result.success) {
        // Update user state immediately
        setUser(result.user)
        setAuthenticated(true)
        // Also check auth to ensure session is set
        await checkAuth()
        return { success: true }
      } else {
        return {
          success: false,
          error: result.error || 'Login failed',
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || error.message || 'Login failed',
      }
    }
  }

  const logout = async () => {
    try {
      await authService.logout()
      setAuthenticated(false)
      setUser(null)
      window.location.href = '/login'
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const value = {
    user,
    authenticated,
    loading,
    login,
    logout,
    checkAuth,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

