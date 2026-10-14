import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Get port from environment variable, default to 3000
  const frontendPort = parseInt(process.env.VITE_PORT || process.env.PORT || '3000')
  
  // Get backend port from environment variable, default to 5000
  // Vite config runs in Node.js, so we can access process.env directly
  const backendPort = process.env.VITE_PROXY_PORT || process.env.FLASK_PORT || '5000'
  
  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false
    },
    server: {
      port: frontendPort,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true
        },
        '/login': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true
        },
        '/logout': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true
        }
      }
    }
  }
})

