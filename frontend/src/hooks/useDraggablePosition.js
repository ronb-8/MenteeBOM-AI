import { useState, useRef, useEffect, useCallback } from 'react'

// Pointer movement (px) below which a press counts as a click, not a drag
const DRAG_THRESHOLD = 5
const EDGE_MARGIN = 8

const clamp = (pos, size) => ({
  x: Math.min(Math.max(pos.x, EDGE_MARGIN), window.innerWidth - size.width - EDGE_MARGIN),
  y: Math.min(Math.max(pos.y, EDGE_MARGIN), window.innerHeight - size.height - EDGE_MARGIN),
})

const loadPosition = (storageKey) => {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey))
    return Number.isFinite(saved?.x) && Number.isFinite(saved?.y) ? saved : null
  } catch {
    return null
  }
}

const savePosition = (storageKey, pos) => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(pos))
  } catch {
    // Storage unavailable (private mode etc.) — position just won't persist
  }
}

/**
 * Makes a fixed-position element draggable with mouse or touch.
 * Returns `position` ({x, y} top-left in px, or null = use the default CSS placement),
 * pointer handlers to spread on the element, `isDragging`, and `consumeDrag()` —
 * call it in onClick and ignore the click when it returns true (the press was a drag).
 */
const useDraggablePosition = (storageKey) => {
  const [position, setPosition] = useState(() => loadPosition(storageKey))
  const [isDragging, setIsDragging] = useState(false)
  const dragState = useRef(null)
  const elementRef = useRef(null)
  const justDragged = useRef(false)

  // Keep the element on screen when the window shrinks
  useEffect(() => {
    const handleResize = () => {
      const el = elementRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setPosition((prev) => (prev ? clamp(prev, rect) : prev))
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return
    const el = event.currentTarget
    elementRef.current = el
    const rect = el.getBoundingClientRect()
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      size: { width: rect.width, height: rect.height },
      moved: false,
    }
    el.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback((event) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!drag.moved) {
      drag.moved = true
      setIsDragging(true)
    }
    drag.lastPosition = clamp({ x: drag.originX + dx, y: drag.originY + dy }, drag.size)
    setPosition(drag.lastPosition)
  }, [])

  const endDrag = useCallback((event, followedByClick) => {
    const drag = dragState.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragState.current = null
    if (drag.moved) {
      // A cancelled pointer gets no click event, so only pointerup should suppress the next click
      justDragged.current = followedByClick
      setIsDragging(false)
      savePosition(storageKey, drag.lastPosition)
    }
  }, [storageKey])

  const onPointerUp = useCallback((event) => endDrag(event, true), [endDrag])
  const onPointerCancel = useCallback((event) => endDrag(event, false), [endDrag])

  const consumeDrag = useCallback(() => {
    const dragged = justDragged.current
    justDragged.current = false
    return dragged
  }, [])

  return {
    position,
    isDragging,
    consumeDrag,
    dragHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}

export default useDraggablePosition
