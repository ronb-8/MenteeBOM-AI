import { useState, useRef, useEffect, useCallback } from 'react'
import { Box, Typography, Tooltip, useTheme } from '@mui/material'

/** Convert polygon points to a smooth closed Catmull-Rom spline SVG path */
const pointsToSmoothPath = (points, tension = 0.3) => {
  if (points.length < 3) return points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') + ' Z'
  const n = points.length
  const pts = [...points, points[0], points[1], points[2]]
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2]
    const cp1x = p1[0] + (p2[0] - p0[0]) * tension
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2[0]},${p2[1]}`
  }
  d += ' Z'
  return d
}

// Inject keyframes for subtle pulse animation
const pulseKeyframes = `
@keyframes limbPulse {
  0%, 100% { opacity: 0.18; }
  50% { opacity: 0.35; }
}
`

const RobotFigure = ({ config, badgeId, selectedLimb, onLimbClick, limbMeta }) => {
  const [hoveredLimb, setHoveredLimb] = useState(null)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 })
  const containerRef = useRef(null)
  const imageRef = useRef(null)

  // Get image source - prefer file path, fallback to base64
  const imageSrc = config?.robot_image_path
    ? `/${config.robot_image_path}`
    : config?.robot_image_data
      ? `data:image/png;base64,${config.robot_image_data}`
      : null

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target
    setNaturalSize({ width: naturalWidth, height: naturalHeight })
    updateImageSize()
  }

  const updateImageSize = () => {
    if (imageRef.current) {
      setImageSize({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight,
      })
    }
  }

  useEffect(() => {
    const observer = new ResizeObserver(updateImageSize)
    if (imageRef.current) observer.observe(imageRef.current)
    return () => observer.disconnect()
  }, [])

  // Scale polygon coordinates from natural image size to displayed size
  const scaleCoords = (coords) => {
    if (!coords || !naturalSize.width || !imageSize.width) return []
    const scaleX = imageSize.width / naturalSize.width
    const scaleY = imageSize.height / naturalSize.height
    return coords.map(([x, y]) => [x * scaleX, y * scaleY])
  }

  // Convert polygon coords to smooth SVG path
  const coordsToPath = (coords) => {
    if (!coords || coords.length < 3) return ''
    const scaled = scaleCoords(coords)
    return pointsToSmoothPath(scaled)
  }

  // Calculate centroid of a polygon for label placement
  const getCentroid = (coords) => {
    if (!coords || coords.length < 3) return null
    const scaled = scaleCoords(coords)
    const cx = scaled.reduce((s, p) => s + p[0], 0) / scaled.length
    const cy = scaled.reduce((s, p) => s + p[1], 0) / scaled.length
    return { x: cx, y: cy }
  }

  if (!imageSrc) {
    return (
      <Typography color="text.secondary" textAlign="center">
        No robot image configured.
      </Typography>
    )
  }

  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  // Use lighter purple in dark mode for SVG glow visibility
  const themeColor = isDark ? '156, 127, 216' : '75, 44, 111' // Purple RGB

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        display: 'inline-block',
        maxWidth: '100%',
        cursor: 'default',
      }}
    >
      {/* Inject keyframes */}
      <style>{pulseKeyframes}</style>

      <Box
        component="img"
        ref={imageRef}
        src={imageSrc}
        alt="Robot figure"
        onLoad={handleImageLoad}
        sx={{
          maxWidth: '100%',
          maxHeight: '65vh',
          display: 'block',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />

      {/* SVG overlay for clickable limb regions */}
      {imageSize.width > 0 && (
        <svg
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: imageSize.width,
            height: imageSize.height,
            pointerEvents: 'none',
          }}
          viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
        >
          {/* SVG filter definitions for glow effects */}
          <defs>
            <filter id="limbGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
              <feFlood floodColor={`rgb(${themeColor})`} floodOpacity="0.3" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="limbGlowHover" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="blur" />
              <feFlood floodColor={`rgb(${themeColor})`} floodOpacity="0.5" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="limbGlowSelected" x="-25%" y="-25%" width="150%" height="150%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="8" result="blur" />
              <feFlood floodColor={`rgb(${themeColor})`} floodOpacity="0.6" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {config?.limbs?.map((limb) => {
            if (!limb.region_coords) return null

            const isSelected = selectedLimb?.id === limb.id
            const isHovered = hoveredLimb === limb.id
            const meta = limbMeta?.[limb.id]

            // Determine visual state
            let fillColor, strokeColor, strokeWidth, filter, fillOpacity

            if (isSelected) {
              fillColor = `rgba(${themeColor}, 0.22)`
              strokeColor = `rgba(${themeColor}, 0.7)`
              strokeWidth = 2
              filter = 'url(#limbGlowSelected)'
              fillOpacity = 1
            } else if (isHovered) {
              fillColor = `rgba(${themeColor}, 0.15)`
              strokeColor = `rgba(${themeColor}, 0.5)`
              strokeWidth = 1.5
              filter = 'url(#limbGlowHover)'
              fillOpacity = 1
            } else {
              fillColor = `rgba(${themeColor}, 0.04)`
              strokeColor = `rgba(${themeColor}, 0.25)`
              strokeWidth = 1
              filter = 'url(#limbGlow)'
              fillOpacity = 1
            }

            // If meta provides custom tint (e.g., cost page: green for assigned, gray for unassigned)
            if (meta?.tintColor && !isSelected && !isHovered) {
              fillColor = meta.tintColor
              strokeColor = meta.strokeColor || strokeColor
            }

            const path = coordsToPath(limb.region_coords)
            if (!path) return null

            const centroid = meta?.showLabel ? getCentroid(limb.region_coords) : null

            return (
              <g key={limb.id}>
                <Tooltip title={meta?.tooltip || `${limb.name} (${limb.dof_count || 0} DOFs)`}>
                  <path
                    d={path}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={isSelected ? 'none' : '4 2'}
                    filter={filter}
                    opacity={fillOpacity}
                    style={{
                      pointerEvents: 'all',
                      cursor: 'pointer',
                      transition: 'fill 0.3s ease, stroke 0.3s ease, stroke-width 0.3s ease',
                      animation: (!isSelected && !isHovered) ? 'limbPulse 2.5s ease-in-out infinite' : 'none',
                    }}
                    onMouseEnter={() => setHoveredLimb(limb.id)}
                    onMouseLeave={() => setHoveredLimb(null)}
                    onClick={() => onLimbClick(limb)}
                  />
                </Tooltip>
                {/* Optional label overlay (used by BOM Cost page) */}
                {centroid && meta?.label && (
                  <text
                    x={centroid.x}
                    y={centroid.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{
                      pointerEvents: 'none',
                      fontSize: '11px',
                      fontWeight: 600,
                      fill: `rgba(${themeColor}, 0.85)`,
                      textShadow: '0 0 3px rgba(255,255,255,0.8)',
                    }}
                  >
                    {meta.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}

      {/* Limb label on hover */}
      {hoveredLimb && (
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            bgcolor: 'rgba(0,0,0,0.7)',
            color: 'white',
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {config?.limbs?.find(l => l.id === hoveredLimb)?.name}
        </Typography>
      )}
    </Box>
  )
}

export default RobotFigure
