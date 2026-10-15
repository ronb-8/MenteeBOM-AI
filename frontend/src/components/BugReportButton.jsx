import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Fab,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Alert,
  Link,
  Box,
  CircularProgress,
} from '@mui/material'
import { BugReport as BugReportIcon } from '@mui/icons-material'
import { useAuth } from '../context/AuthContext'
import bugReportService from '../services/bugReportService'
import useDraggablePosition from '../hooks/useDraggablePosition'

const SEVERITIES = ['Low', 'Medium', 'High', 'Critical']
const MAX_TITLE_LENGTH = 255
const EMPTY_FORM = { title: '', description: '', severity: '' }

// Routes where the button must not appear (no session, or embedded in another app)
const isHiddenRoute = (pathname) => pathname === '/login' || pathname.startsWith('/embed/')

const BugReportButton = () => {
  const { authenticated } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [createdIssue, setCreatedIssue] = useState(null)
  const { position, isDragging, consumeDrag, dragHandlers } = useDraggablePosition('menteebom.bugReportButtonPosition')

  if (!authenticated || isHiddenRoute(location.pathname)) return null

  const handleOpen = () => {
    if (consumeDrag()) return // the press ended a drag, not a click
    setForm(EMPTY_FORM)
    setError(null)
    setCreatedIssue(null)
    setOpen(true)
  }

  const handleClose = () => {
    if (!submitting) setOpen(false)
  }

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  const canSubmit = form.title.trim() && form.description.trim() && !submitting

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const { data } = await bugReportService.createReport(form)
      setCreatedIssue({ key: data.issue_key, url: data.issue_url })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create the bug report. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Tooltip
        title="Report a bug (drag to move)"
        placement="left"
        disableHoverListener={isDragging}
        disableFocusListener={isDragging}
        disableTouchListener
      >
        <Fab
          color="primary"
          size="medium"
          aria-label="Report a bug"
          onClick={handleOpen}
          {...dragHandlers}
          sx={{
            position: 'fixed',
            ...(position ? { left: position.x, top: position.y } : { bottom: 24, right: 24 }),
            zIndex: (theme) => theme.zIndex.speedDial,
            touchAction: 'none', // let touch drags move the button instead of scrolling the page
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
        >
          <BugReportIcon />
        </Fab>
      </Tooltip>

      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
        <Box component="form" onSubmit={handleSubmit}>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <BugReportIcon fontSize="small" />
            Report a Bug
          </DialogTitle>

          <DialogContent>
            {createdIssue ? (
              <Alert severity="success" sx={{ mt: 1 }}>
                Bug report created:{' '}
                <Link href={createdIssue.url} target="_blank" rel="noopener noreferrer">
                  {createdIssue.key}
                </Link>
              </Alert>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                {error && <Alert severity="error">{error}</Alert>}
                <TextField
                  label="Title"
                  value={form.title}
                  onChange={handleChange('title')}
                  required
                  autoFocus
                  disabled={submitting}
                  inputProps={{ maxLength: MAX_TITLE_LENGTH }}
                />
                <TextField
                  label="Description"
                  value={form.description}
                  onChange={handleChange('description')}
                  required
                  multiline
                  minRows={5}
                  disabled={submitting}
                  placeholder={'What happened?\nWhat did you expect to happen?\nSteps to reproduce:'}
                />
                <TextField
                  select
                  label="Severity (optional)"
                  value={form.severity}
                  onChange={handleChange('severity')}
                  disabled={submitting}
                >
                  <MenuItem value="">
                    <em>Not specified</em>
                  </MenuItem>
                  {SEVERITIES.map((level) => (
                    <MenuItem key={level} value={level}>
                      {level}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            )}
          </DialogContent>

          <DialogActions>
            {createdIssue ? (
              <Button onClick={handleClose} variant="contained">
                Close
              </Button>
            ) : (
              <>
                <Button onClick={handleClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!canSubmit}
                  startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : null}
                >
                  {submitting ? 'Submitting...' : 'Submit'}
                </Button>
              </>
            )}
          </DialogActions>
        </Box>
      </Dialog>
    </>
  )
}

export default BugReportButton
