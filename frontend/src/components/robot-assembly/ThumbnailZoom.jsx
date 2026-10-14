import { useState } from 'react'
import { Avatar, Dialog, DialogContent, IconButton, Box } from '@mui/material'
import { Close as CloseIcon, Image as ImageIcon } from '@mui/icons-material'

/**
 * ThumbnailZoom
 * Renders a small Avatar thumbnail that opens a full-size image dialog on click.
 * Falls back to an ImageIcon placeholder when no src is provided.
 */
const ThumbnailZoom = ({ src, alt = '', size = 32, variant = 'rounded', sx = {} }) => {
  const [open, setOpen] = useState(false)

  if (!src) {
    return (
      <Avatar
        variant={variant}
        sx={{ width: size, height: size, flexShrink: 0, bgcolor: 'action.selected', ...sx }}
      >
        <ImageIcon sx={{ fontSize: size * 0.55 }} />
      </Avatar>
    )
  }

  return (
    <>
      <Avatar
        variant={variant}
        src={src}
        alt={alt}
        sx={{ width: size, height: size, flexShrink: 0, cursor: 'zoom-in', ...sx }}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
      />

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm">
        <DialogContent sx={{ p: 0, position: 'relative', lineHeight: 0 }}>
          <IconButton
            size="small"
            onClick={() => setOpen(false)}
            sx={{
              position: 'absolute', top: 6, right: 6,
              bgcolor: 'rgba(0,0,0,0.55)', color: 'white', zIndex: 1,
              '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
          <Box
            component="img"
            src={src}
            alt={alt}
            sx={{ display: 'block', maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

export default ThumbnailZoom
