import api from './api'

export const authService = {
  login: async (username, password) => {
    // Use URLSearchParams for form data to match Flask's form handling
    const formData = new URLSearchParams()
    formData.append('username', username)
    formData.append('password', password)
    
    const response = await api.post('/login', formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    return response.data
  },

  logout: async () => {
    const response = await api.get('/logout')
    return response.data
  },

  checkAuth: async () => {
    try {
      const response = await api.get('/api/user-info')
      if (response.data.success) {
        return { authenticated: true, user: response.data.user }
      }
      return { authenticated: false }
    } catch (error) {
      return { authenticated: false }
    }
  },

  updateSettings: (data) => api.put('/api/user-settings', data),
}

