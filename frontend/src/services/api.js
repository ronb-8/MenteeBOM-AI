import axios from 'axios'

// Create axios instance with default config
const api = axios.create({
  baseURL: window.location.origin,
  withCredentials: true, // Important for Flask-Login session cookies
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  timeout: 22000000, // 30 minutes
})

// Request interceptor
api.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/login')) {
      // Unauthorized - redirect to login (but not when the login request itself fails)
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api

