import { createContext, useContext, useState, useEffect } from 'react'
import api from '../services/api'

const ServerConfigContext = createContext({ isDevMode: false })

export const useServerConfig = () => useContext(ServerConfigContext)

export const ServerConfigProvider = ({ children }) => {
  const [isDevMode, setIsDevMode] = useState(false)

  useEffect(() => {
    api.get('/api/server-config')
      .then(res => setIsDevMode(res.data.is_dev === true))
      .catch(() => setIsDevMode(false))
  }, [])

  return (
    <ServerConfigContext.Provider value={{ isDevMode }}>
      {children}
    </ServerConfigContext.Provider>
  )
}
