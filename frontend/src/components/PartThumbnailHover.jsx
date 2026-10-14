import { useState } from 'react'
import { Box, Typography, Popover } from '@mui/material'
import { hasThumbnail, getThumbnailSrc } from '../utils/thumbnail'

const isTouchDevice = () =>
  typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

/**
 * Renders a part number that reveals the part's thumbnail in a popover.
 * Desktop: shows on hover. Touch: toggles on tap. Self-contained — manages its
 * own anchor state, so it can be dropped anywhere a part number is displayed.
 *
 * Mirrors the look of the existing hover popover in BOMTable.jsx.
 */
const PartThumbnailHover = ({ partNumber, thumbnail, variant = 'body2', sx = {}, ...typographyProps }) => {
  const [anchorEl, setAnchorEl] = useState(null)
  const hasThumb = hasThumbnail(thumbnail)
  const touch = isTouchDevice()

  const open = (event) => {
    if (hasThumb) setAnchorEl(event.currentTarget)
  }
  const close = () => setAnchorEl(null)

  const handleMouseEnter = (event) => {
    if (!touch) open(event)
  }
  const handleMouseLeave = () => {
    if (!touch) close()
  }
  const handleClick = (event) => {
    if (!hasThumb || !touch) return
    // Toggle on tap for touch devices
    if (anchorEl) close()
    else open(event)
  }

  return (
    <>
      <Typography
        component="span"
        variant={variant}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        sx={{
          cursor: hasThumb ? 'pointer' : 'default',
          textDecoration: anchorEl ? 'underline' : 'none',
          '&:hover': { textDecoration: hasThumb ? 'underline' : 'none' },
          ...sx,
        }}
        {...typographyProps}
      >
        {partNumber}
      </Typography>
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        disableRestoreFocus
        sx={{ pointerEvents: touch ? 'auto' : 'none' }}
        PaperProps={{
          onMouseLeave: () => {
            if (!touch) close()
          },
          onClick: () => {
            if (touch) close()
          },
          sx: { pointerEvents: 'auto', p: 1, maxWidth: 300, maxHeight: 300 },
        }}
      >
        {hasThumb ? (
          <Box sx={{ textAlign: 'center' }}>
            <img
              src={getThumbnailSrc(thumbnail)}
              alt={partNumber}
              style={{
                maxWidth: '250px',
                maxHeight: '250px',
                width: 'auto',
                height: 'auto',
                display: 'block',
                margin: '0 auto',
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {partNumber}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ p: 2, textAlign: 'center', minWidth: 150 }}>
            <Typography variant="body2" color="text.secondary">
              No thumbnail available
            </Typography>
          </Box>
        )}
      </Popover>
    </>
  )
}

export default PartThumbnailHover
