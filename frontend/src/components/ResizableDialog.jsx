import { useState, useRef, useEffect, useCallback } from 'react'
import { Dialog, DialogTitle, DialogContent, DialogActions, Box } from '@mui/material'

const ResizableDialog = ({
  open,
  onClose,
  children,
  maxWidth = 'sm',
  fullWidth = false,
  minWidth = 300,
  minHeight = 200,
  maxWidthPx,
  maxHeightPx,
  defaultWidth,
  defaultHeight,
  id, // Optional unique identifier for persistence
  ...dialogProps
}) => {
  const dialogRef = useRef(null)
  const containerRef = useRef(null)
  const [size, setSize] = useState({ width: null, height: null })
  const [isResizing, setIsResizing] = useState(false)
  const [resizeDirection, setResizeDirection] = useState(null)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [startSize, setStartSize] = useState({ width: 0, height: 0 })

  // Storage key for this modal
  const storageKey = id ? `resizableDialog_${id}` : null

  // Load saved size from localStorage
  const loadSavedSize = useCallback(() => {
    if (!storageKey) return null
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Validate the saved size
        if (parsed.width >= minWidth && parsed.height >= minHeight) {
          return parsed
        }
      }
    } catch (error) {
      console.warn('Failed to load saved dialog size:', error)
    }
    return null
  }, [storageKey, minWidth, minHeight])

  // Save size to localStorage
  const saveSize = useCallback((newSize) => {
    if (!storageKey || !newSize.width || !newSize.height) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(newSize))
    } catch (error) {
      console.warn('Failed to save dialog size:', error)
    }
  }, [storageKey])

  // Calculate default size based on maxWidth prop
  const getDefaultSize = useCallback(() => {
    if (defaultWidth && defaultHeight) {
      return { width: defaultWidth, height: defaultHeight }
    }

    const maxWidthMap = {
      xs: 444,
      sm: 600,
      md: 900,
      lg: 1200,
      xl: 1536,
    }

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const maxW = maxWidthPx || maxWidthMap[maxWidth] || 600
    const maxH = maxHeightPx || Math.floor(viewportHeight * 0.9)

    let width = fullWidth ? Math.min(maxW, Math.floor(viewportWidth * 0.9)) : maxW
    let height = defaultHeight || Math.min(600, Math.floor(viewportHeight * 0.8))

    return { width, height }
  }, [maxWidth, fullWidth, maxWidthPx, maxHeightPx, defaultWidth, defaultHeight])

  // Initialize size when dialog opens
  useEffect(() => {
    if (open && !size.width) {
      // Try to load saved size first
      const savedSize = loadSavedSize()
      if (savedSize) {
        setSize(savedSize)
      } else {
        const defaultSize = getDefaultSize()
        setSize(defaultSize)
      }
    } else if (!open) {
      // Don't reset size when closed - keep it for next time
      // setSize({ width: null, height: null })
    }
  }, [open, size.width, getDefaultSize, loadSavedSize])

  // Save size whenever it changes (for persistence)
  useEffect(() => {
    if (open && size.width && size.height && storageKey) {
      saveSize(size)
    }
  }, [open, size, storageKey, saveSize])

  // Handle window resize
  useEffect(() => {
    if (!open) return

    const handleWindowResize = () => {
      if (size.width && size.height) {
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const maxW = maxWidthPx || Math.floor(viewportWidth * 0.9)
        const maxH = maxHeightPx || Math.floor(viewportHeight * 0.9)

        setSize(prev => {
          const newSize = {
            width: Math.min(prev.width, maxW),
            height: Math.min(prev.height, maxH),
          }
          // Save adjusted size
          if (storageKey) {
            saveSize(newSize)
          }
          return newSize
        })
      }
    }

    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [open, size, maxWidthPx, maxHeightPx, storageKey, saveSize])

  const handleMouseDown = (e, direction) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    setStartPos({ x: e.clientX, y: e.clientY })
    setStartSize({ width: rect.width, height: rect.height })
    setResizeDirection(direction)
    setIsResizing(true)
  }

  const handleMouseMove = useCallback((e) => {
    if (!isResizing || !resizeDirection) return

    const deltaX = e.clientX - startPos.x
    const deltaY = e.clientY - startPos.y

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const maxW = maxWidthPx || Math.floor(viewportWidth * 0.9)
    const maxH = maxHeightPx || Math.floor(viewportHeight * 0.9)

    let newWidth = startSize.width
    let newHeight = startSize.height

    // Handle horizontal resizing
    if (resizeDirection.includes('right')) {
      newWidth = Math.max(minWidth, Math.min(maxW, startSize.width + deltaX))
    }
    if (resizeDirection.includes('left')) {
      newWidth = Math.max(minWidth, Math.min(maxW, startSize.width - deltaX))
    }

    // Handle vertical resizing
    if (resizeDirection.includes('bottom')) {
      newHeight = Math.max(minHeight, Math.min(maxH, startSize.height + deltaY))
    }
    if (resizeDirection.includes('top')) {
      newHeight = Math.max(minHeight, Math.min(maxH, startSize.height - deltaY))
    }

    const newSize = { width: newWidth, height: newHeight }
    setSize(newSize)
    // Save size to localStorage when resizing
    saveSize(newSize)
  }, [isResizing, resizeDirection, startPos, startSize, minWidth, minHeight, maxWidthPx, maxHeightPx, saveSize])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
    setResizeDirection(null)
  }, [])

  // Add global mouse event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = getResizeCursor(resizeDirection)
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, handleMouseMove, handleMouseUp, resizeDirection])

  const getResizeCursor = (direction) => {
    if (!direction) return ''
    if (direction === 'top' || direction === 'bottom') return 'ns-resize'
    if (direction === 'left' || direction === 'right') return 'ew-resize'
    if (direction === 'top-left' || direction === 'bottom-right') return 'nwse-resize'
    if (direction === 'top-right' || direction === 'bottom-left') return 'nesw-resize'
    return ''
  }

  const resizeHandleStyle = {
    position: 'absolute',
    backgroundColor: 'transparent',
    zIndex: 1301,
  }

  const edgeHandleStyle = {
    ...resizeHandleStyle,
  }

  const cornerHandleStyle = {
    ...resizeHandleStyle,
    width: '12px',
    height: '12px',
  }

  // Prevent closing on backdrop click
  const handleBackdropClick = (event) => {
    event.stopPropagation()
    // Do nothing - prevent modal from closing
  }

  return (
    <Dialog
      open={open}
      onClose={(event, reason) => {
        // Only allow closing via escape key or explicit onClose call
        // Disable backdrop click closing
        if (reason === 'backdropClick') {
          return
        }
        if (onClose) {
          onClose(event, reason)
        }
      }}
      maxWidth={false}
      fullWidth={false}
      PaperProps={{
        ref: containerRef,
        sx: {
          width: size.width || 'auto',
          height: size.height || 'auto',
          maxWidth: size.width ? `${size.width}px` : 'none',
          maxHeight: size.height ? `${size.height}px` : 'none',
          minWidth: minWidth,
          minHeight: minHeight,
          margin: 'auto',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      {...dialogProps}
    >
      {/* Resize handles */}
      {open && size.width && (
        <>
          {/* Top edge */}
          <Box
            onMouseDown={(e) => handleMouseDown(e, 'top')}
            sx={{
              ...edgeHandleStyle,
              top: 0,
              left: 0,
              right: 0,
              height: '4px',
              cursor: 'ns-resize',
            }}
          />
          {/* Bottom edge */}
          <Box
            onMouseDown={(e) => handleMouseDown(e, 'bottom')}
            sx={{
              ...edgeHandleStyle,
              bottom: 0,
              left: 0,
              right: 0,
              height: '4px',
              cursor: 'ns-resize',
            }}
          />
          {/* Left edge */}
          <Box
            onMouseDown={(e) => handleMouseDown(e, 'left')}
            sx={{
              ...edgeHandleStyle,
              top: 0,
              bottom: 0,
              left: 0,
              width: '4px',
              cursor: 'ew-resize',
            }}
          />
          {/* Right edge */}
          <Box
            onMouseDown={(e) => handleMouseDown(e, 'right')}
            sx={{
              ...edgeHandleStyle,
              top: 0,
              bottom: 0,
              right: 0,
              width: '4px',
              cursor: 'ew-resize',
            }}
          />
          {/* Top-left corner */}
          <Box
            onMouseDown={(e) => handleMouseDown(e, 'top-left')}
            sx={{
              ...cornerHandleStyle,
              top: 0,
              left: 0,
              cursor: 'nwse-resize',
            }}
          />
          {/* Top-right corner */}
          <Box
            onMouseDown={(e) => handleMouseDown(e, 'top-right')}
            sx={{
              ...cornerHandleStyle,
              top: 0,
              right: 0,
              cursor: 'nesw-resize',
            }}
          />
          {/* Bottom-left corner */}
          <Box
            onMouseDown={(e) => handleMouseDown(e, 'bottom-left')}
            sx={{
              ...cornerHandleStyle,
              bottom: 0,
              left: 0,
              cursor: 'nesw-resize',
            }}
          />
          {/* Bottom-right corner */}
          <Box
            onMouseDown={(e) => handleMouseDown(e, 'bottom-right')}
            sx={{
              ...cornerHandleStyle,
              bottom: 0,
              right: 0,
              cursor: 'nwse-resize',
            }}
          />
        </>
      )}
      {children}
    </Dialog>
  )
}

export default ResizableDialog
