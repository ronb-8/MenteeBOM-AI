import api from './api'

const bugReportService = {
  // Creates a Jira ticket via the backend — Jira credentials never reach the browser
  createReport: ({ title, description, severity }) =>
    api.post('/api/bug-report', {
      title,
      description,
      severity: severity || null,
      page_url: window.location.href,
    }),
}

export default bugReportService
