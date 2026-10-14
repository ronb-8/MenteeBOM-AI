import { createTheme } from '@mui/material/styles'

// Create a custom theme for MenteeBOM
const getTheme = (mode = 'light') => {
  const isDark = mode === 'dark'

  const theme = createTheme({
    breakpoints: {
      values: {
        xs: 0,
        sm: 600,
        md: 900,
        lg: 1200,
        xl: 1536,
        xxl: 2560,  // Large desktop monitor
        tv: 3840,   // 4K TV
      },
    },
    palette: {
      mode,
      primary: {
        main: isDark ? '#9C7FD8' : '#4B2C6F', // Lighter purple for dark mode, original for light
        light: isDark ? '#B8A3E3' : '#6A5ACD',
        dark: isDark ? '#7A5FA8' : '#3a1f56',
        contrastText: '#ffffff',
      },
      secondary: {
        main: isDark ? '#B8A3E3' : '#6A5ACD',
        light: isDark ? '#D4C5F0' : '#8b7dd9',
        dark: isDark ? '#8B7DD9' : '#4a3a91',
        contrastText: '#ffffff',
      },
      success: {
        main: isDark ? '#4caf50' : '#28a745',
        light: isDark ? '#81c784' : '#5cb85c',
        dark: isDark ? '#388e3c' : '#1e7e34',
      },
      info: {
        main: isDark ? '#29b6f6' : '#17a2b8',
        light: isDark ? '#64b5f6' : '#5bc0de',
        dark: isDark ? '#0288d1' : '#117a8b',
      },
      warning: {
        main: isDark ? '#ffb74d' : '#ffc107',
        light: isDark ? '#ffcc80' : '#ffd54f',
        dark: isDark ? '#f57c00' : '#f57c00',
      },
      error: {
        main: isDark ? '#ef5350' : '#dc3545',
        light: isDark ? '#e57373' : '#e57373',
        dark: isDark ? '#c62828' : '#c82333',
      },
      background: {
        default: isDark ? '#121212' : '#f8f9fa',
        paper: isDark ? '#1e1e1e' : '#ffffff',
      },
      text: {
        primary: isDark ? '#ffffff' : 'rgba(0, 0, 0, 0.87)',
        secondary: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
      },
      divider: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
    },
    typography: {
      fontFamily: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
      fontSize: 12.5,  // Compact base (MUI default is 14)
      h1: {
        fontSize: '1.5rem',
        fontWeight: 600,
      },
      h2: {
        fontSize: '1.25rem',
        fontWeight: 600,
      },
      h3: {
        fontSize: '1.1rem',
        fontWeight: 600,
      },
      h4: {
        fontSize: '1rem',
        fontWeight: 600,
      },
      h5: {
        fontSize: '0.9rem',
        fontWeight: 600,
      },
      h6: {
        fontSize: '0.8rem',
        fontWeight: 600,
      },
      body1: {
        fontSize: '0.8rem',
      },
      body2: {
        fontSize: '0.75rem',
      },
      caption: {
        fontSize: '0.65rem',
      },
      overline: {
        fontSize: '0.6rem',
      },
    },
    shape: {
      borderRadius: 6,
    },
    components: {
      MuiButton: {
        defaultProps: {
          size: 'small',
        },
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.75rem',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          sizeSmall: {
            height: 20,
            fontSize: '0.65rem',
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&:nth-of-type(even)': {
              backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
            },
            '&:hover': {
              backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
            },
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: {
            fontSize: '0.75rem',
            padding: '4px 10px',
          },
          head: {
            fontWeight: 600,
            fontSize: '0.7rem',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: isDark
              ? '0 2px 8px rgba(0,0,0,0.3)'
              : '0 2px 8px rgba(0,0,0,0.1)',
          },
        },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: {
            border: isDark
              ? '1px solid rgba(255, 255, 255, 0.12)'
              : '1px solid #e0e0e0',
          },
          columnHeaders: {
            backgroundColor: isDark ? '#2a2a2a' : '#f5f5f5',
            fontWeight: 600,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: isDark
              ? 'rgba(58, 31, 86, 0.85)' // Semi-transparent purple for dark mode
              : 'rgba(75, 44, 111, 0.95)', // Semi-transparent purple for light mode
            backdropFilter: 'blur(10px) saturate(180%)',
            WebkitBackdropFilter: 'blur(10px) saturate(180%)',
            boxShadow: isDark
              ? '0 4px 20px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05)'
              : '0 4px 20px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)',
            borderBottom: isDark
              ? '1px solid rgba(255, 255, 255, 0.08)'
              : '1px solid rgba(0, 0, 0, 0.08)',
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
    },
  })

  return theme
}

export default getTheme
