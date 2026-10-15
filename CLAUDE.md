# Project Context: MenteeBOM + In-App Bug Reporter

## Project Overview
MenteeBOM is an internal web application for managing Bills of Materials (BOMs), parts, vendors, RFQs/POs and robot assemblies.

The organization already has a separate bug-reporting process that connects Jira, Slack and the Claude API. That process lives outside this repository — MenteeBOM is currently NOT connected to it, and this codebase contains no Jira, Slack or Anthropic integration.

The next phase is to add an in-app "Report Bug" floating button to MenteeBOM that creates Jira tickets directly in the 'FEAT' project via the Jira REST API.

## Tech Stack
* **Backend:** Python 3.9 + Flask (Flask-SQLAlchemy on SQLite at `instance/menteebom.db`, Flask-Login, APScheduler). Main entry points: `run.py` (startup script) and `app.py` (very large, ~1MB — search it, don't read it whole).
* **Frontend:** React 18 + Vite 5, Material UI (MUI v7, incl. x-data-grid / x-tree-view), React Router 6, Axios, D3. Source in `frontend/src`; the production build in `frontend/dist` is served by Flask.
* **APIs:** Internal Flask REST API (`/api/...`, session auth via Flask-Login), Google Sheets API (gspread), Google Gemini (quotation/RFQ processing), SOLIDWORKS PDM (COM, Windows only), StockWise, and Jira REST API v3 (to be added for the bug reporter).

## Jira Integration Specifics
* **Jira Domain:** menteebot.atlassian.net
* **Project Key:** FEAT
* **Issue Type:** Any
* **Required Fields for Ticket Creation:** 
  - `summary` (Bug title)
  - `description` (Detailed explanation, expected behavior vs. actual)
* Authentication should be done securely (Backend API route, NOT exposing Jira API tokens in the frontend).
* **Implementation:** backend `bug_report_api.py` (`POST /api/bug-report`), frontend `frontend/src/components/BugReportButton.jsx` + `services/bugReportService.js`. Credentials come from `.env` (see `.env.example`: `JIRA_EMAIL`, `JIRA_API_TOKEN`, optional `JIRA_PROJECT_KEY`, `JIRA_ISSUE_TYPE`).

## UI/UX Guidelines for the Reporter Button
* **Placement:** A non-intrusive floating action button (FAB) in the corner of the app.
* **Flow:** Clicking opens a compact modal with inputs for 'Title', 'Description', and optionally 'Severity/Priority'.
* **Feedback:** Show a loading state during submission, and a success message with the Jira ticket link once created.

## Coding Standards
* Write clean, modular code.
* Use strict error handling for API calls (e.g., catching 400/401 errors from Jira).
* Keep components small and focused.

## Commands
* Build/Run Frontend:
  - Production build (served by Flask): `cd frontend && npm install && npm run build`
  - Dev server with hot reload: `cd frontend && FLASK_PORT=5050 npm run dev` (runs on http://localhost:3000, proxies `/api`, `/login`, `/logout` to Flask)
* Run Backend:
  - `venv/bin/python run.py --port 5050` (port 5000 is taken by macOS AirPlay; app at http://localhost:5050)
  - Use `--dev` to work on a copy of the DB (`instance/menteebom_dev.db`) instead of the real `instance/menteebom.db`
  - No default admin user is seeded; create one with `venv/bin/python scripts/create_admin.py`

## Language
* Every time you write something in the code is only in English. Include
comments, Menus, and Everything. its for Global company so its must be in English.