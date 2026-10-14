import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Container,
  Card,
  TextField,
  Button,
  Typography,
  Box,
  CircularProgress,
  Alert,
  InputAdornment,
  IconButton,
} from '@mui/material'
import { Login as LoginIcon, Person, Lock, Visibility, VisibilityOff } from '@mui/icons-material'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'

const Login = () => {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { login, authenticated } = useAuth()
  const { showNotification } = useNotification()
  const navigate = useNavigate()

  useEffect(() => {
    if (authenticated) {
      navigate('/dashboard')
    }
  }, [authenticated, navigate])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await login(identifier, password)
      if (result.success) {
        showNotification('Login successful!', 'success')
        navigate('/dashboard')
      } else {
        setError(result.error || 'Invalid username or password')
        setPassword('') // clear only password — identifier stays
      }
    } catch {
      setError('An error occurred during login')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(160deg, #1a1a2e 0%, #2d2b55 45%, #3b2f6b 100%)',
        px: 2,
      }}
    >
      <Container maxWidth="xs" disableGutters>

        {/* Welcome text + logo — outside the card */}
        <Box sx={{ textAlign: 'center', mb: 5 }}>
          <Typography
            sx={{
              color: 'rgba(255,255,255,0.55)',
              fontSize: '0.85rem',
              fontWeight: 400,
              letterSpacing: '0.25em',
              textTransform: 'uppercase',
              mb: 2.5,
            }}
          >
            Welcome to
          </Typography>
          <Box
            component="img"
            src="/menteeBOMlogo.png"
            alt="MenteeBOM"
            sx={{
              width: { xs: 100, sm: 140 },
              height: { xs: 100, sm: 140 },
              objectFit: 'contain',
              borderRadius: 4,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}
          />
          <Typography
            sx={{
              color: '#fff',
              fontSize: { xs: '1.4rem', sm: '1.9rem' },
              fontWeight: 700,
              letterSpacing: '0.04em',
              mt: 2,
            }}
          >
            MenteeBOM
          </Typography>
        </Box>

        {/* Login form card */}
        <Card elevation={12} sx={{ borderRadius: 3 }}>
          <Box sx={{ px: 4, pt: 4, pb: 4 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2.5 }} onClose={() => setError('')}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                label="Username or Email"
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                disabled={loading}
                margin="normal"
                autoComplete="username"
                InputProps={{
                  startAdornment: <Person sx={{ mr: 1, color: 'text.secondary' }} />,
                }}
              />

              <TextField
                fullWidth
                label="Password"
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                margin="normal"
                autoComplete="current-password"
                InputProps={{
                  startAdornment: <Lock sx={{ mr: 1, color: 'text.secondary' }} />,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle password visibility"
                        onClick={() => setShowPassword(!showPassword)}
                        onMouseDown={(e) => e.preventDefault()}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                fullWidth
                variant="contained"
                size="large"
                disabled={loading}
                sx={{ mt: 3, borderRadius: 2, py: 1.4 }}
                startIcon={
                  loading ? <CircularProgress size={20} color="inherit" /> : <LoginIcon />
                }
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
          </Box>
        </Card>

      </Container>
    </Box>
  )
}

export default Login
