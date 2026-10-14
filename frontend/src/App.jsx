import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider as MuiThemeProvider, CssBaseline } from '@mui/material'
import { useEffect } from 'react'
import { ThemeProvider, useThemeMode } from './context/ThemeContext'
import { AuthProvider } from './context/AuthContext'
import { NotificationProvider } from './context/NotificationContext'
import { ServerConfigProvider } from './context/ServerConfigContext'
import getTheme from './theme'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import AssemblyBOM from './pages/AssemblyBOM'
import AssemblyTree from './pages/AssemblyTree'
import Purchases from './pages/Purchases'
import Admin from './pages/Admin'
import BOMCost from './pages/BOMCost'
import RobotAssembly from './pages/RobotAssembly'
import PartsDatabase from './pages/PartsDatabase'
import LimbsBOM from './pages/LimbsBOM'
import EmbedStageView from './components/robot-assembly/EmbedStageView'
import EmbedLimbStageView from './components/robot-assembly/EmbedLimbStageView'
import ProtectedRoute from './components/ProtectedRoute'
import Navigation from './components/Navigation'
import './App.css'

const AppContent = () => {
  const { mode } = useThemeMode()
  const theme = getTheme(mode)

  useEffect(() => {
    // Set data-theme attribute on document root for CSS dark mode support
    document.documentElement.setAttribute('data-theme', mode)
  }, [mode])

  return (
    <MuiThemeProvider theme={theme}>
      <CssBaseline />
      <ServerConfigProvider>
      <AuthProvider>
        <NotificationProvider>
          <BrowserRouter>
            <Routes>
              {/* Embed routes — no auth wrapper, no nav */}
              <Route path="/embed/process/:processNumber/stage/:stageNumber" element={<EmbedStageView />} />
              <Route path="/embed/limb-process/:processNumber/stage/:stageLabel" element={<EmbedLimbStageView />} />
              <Route path="/login" element={<Login />} />
              <Route path="/" element={
                <ProtectedRoute>
                  <Navigation />
                  <Dashboard />
                </ProtectedRoute>
              } />
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <Navigation />
                  <Dashboard />
                </ProtectedRoute>
              } />
              <Route path="/assembly-bom" element={
                <ProtectedRoute>
                  <Navigation />
                  <AssemblyBOM />
                </ProtectedRoute>
              } />
              <Route path="/assembly-tree" element={
                <ProtectedRoute>
                  <Navigation />
                  <AssemblyTree />
                </ProtectedRoute>
              } />
              <Route path="/parts-database" element={
                <ProtectedRoute>
                  <Navigation />
                  <PartsDatabase />
                </ProtectedRoute>
              } />
              <Route path="/limbs-bom" element={
                <ProtectedRoute>
                  <Navigation />
                  <LimbsBOM />
                </ProtectedRoute>
              } />
              <Route path="/robot-assembly" element={
                <ProtectedRoute>
                  <Navigation />
                  <RobotAssembly />
                </ProtectedRoute>
              } />
              <Route path="/robot-assembly/limb/:limbSlug" element={
                <ProtectedRoute>
                  <Navigation />
                  <RobotAssembly />
                </ProtectedRoute>
              } />
              <Route path="/robot-assembly/dof/:dofNumber" element={
                <ProtectedRoute>
                  <Navigation />
                  <RobotAssembly />
                </ProtectedRoute>
              } />
              <Route path="/robot-assembly/process/:processNumber" element={
                <ProtectedRoute>
                  <Navigation />
                  <RobotAssembly />
                </ProtectedRoute>
              } />
              <Route path="/robot-assembly/process/:processNumber/stage/:stageNumber" element={
                <ProtectedRoute>
                  <Navigation />
                  <RobotAssembly />
                </ProtectedRoute>
              } />
              <Route path="/purchases" element={
                <ProtectedRoute>
                  <Navigation />
                  <Purchases />
                </ProtectedRoute>
              } />
              <Route path="/admin/bom-cost" element={
                <ProtectedRoute requireAdminOrFinance>
                  <Navigation />
                  <BOMCost />
                </ProtectedRoute>
              } />
              <Route path="/admin" element={
                <ProtectedRoute requireAdmin>
                  <Navigation />
                  <Admin />
                </ProtectedRoute>
              } />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </NotificationProvider>
      </AuthProvider>
      </ServerConfigProvider>
    </MuiThemeProvider>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}

export default App

