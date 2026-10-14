import { useState, useRef, useEffect, useCallback } from 'react'
import { Box } from '@mui/material'

const ResizableSidebar = ({ 
  children, 
  defaultWidth = 500, 
  minWidth = 300, 
  maxWidth = 800,
  side = 'left' // 'left' or 'right'
}) => {
  const [width, setWidth] = useState(defaultWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0 })
  const [startWidth, setStartWidth] = useState(0)
  const containerRef = useRef(null)

  const handleMouseDown = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setStartPos({ x: e.clientX })
    setStartWidth(width)
    setIsResizing(true)
  }

  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return

    const deltaX = e.clientX - startPos.x
    const newWidth = side === 'left' 
      ? Math.max(minWidth, Math.min(maxWidth, startWidth + deltaX))
      : Math.max(minWidth, Math.min(maxWidth, startWidth - deltaX))
    
    setWidth(newWidth)
  }, [isResizing, startPos, startWidth, minWidth, maxWidth, side])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
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
  }, [isResizing, handleMouseMove, handleMouseUp])

  return (
    <Box
      ref={containerRef}
      sx={{
        width: `${width}px`,
        flexShrink: 0,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {children}
      {/* Resize handle */}
      <Box
        onMouseDown={handleMouseDown}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          [side === 'left' ? 'right' : 'left']: 0,
          width: '4px',
          cursor: 'ew-resize',
          backgroundColor: 'transparent',
          zIndex: 10,
          '&:hover': {
            backgroundColor: 'primary.main',
            opacity: 0.3,
          },
        }}
      />
    </Box>
  )
}

export default ResizableSidebar
