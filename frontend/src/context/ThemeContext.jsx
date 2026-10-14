import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext({
  mode: 'light',
  toggleColorMode: () => {},
  setMode: () => {},
})

export const useThemeMode = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useThemeMode must be used within a ThemeProvider')
  }
  return context
}

export const ThemeProvider = ({ children }) => {
  const [mode, setModeState] = useState(() => {
    // Initialize from localStorage or default to 'light'
    const savedMode = localStorage.getItem('themeMode')
    return savedMode || 'light'
  })

  useEffect(() => {
    // Persist theme preference to localStorage
    localStorage.setItem('themeMode', mode)
  }, [mode])

  const toggleColorMode = () => {
    setModeState((prevMode) => (prevMode === 'light' ? 'dark' : 'light'))
  }

  const setMode = (newMode) => {
    if (newMode === 'light' || newMode === 'dark') {
      setModeState(newMode)
    }
  }

  const value = {
    mode,
    toggleColorMode,
    setMode,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

