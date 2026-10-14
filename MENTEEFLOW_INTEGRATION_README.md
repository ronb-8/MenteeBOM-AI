# MenteeFlow ↔ MenteeBOM Integration Guide (for Claude Code)

> **Purpose:** This document is the single source of truth for implementing changes to the MenteeFlow integration. Read this before making any changes to the robot assembly or MenteeFlow-related code.

---

## 1. System Architecture Overview

```
┌─────────────────────┐          REST Webhooks          ┌─────────────────────┐
│     MenteeFlow      │ ◄──────────────────────────────► │     MenteeBOM       │
│  (External System)  │                                  │  (This Codebase)    │
│                     │  MenteeFlow → MenteeBOM:         │                     │
│  Owns workflow      │  • Create process                │  Owns BOM data,     │
│  decisions:         │  • Advance stages                │  inventory, and     │
│  - when to start    │  • Revert stages                 │  assembly UI:       │
│  - when to advance  │  • Request embed tokens          │  - Parts picking    │
│  - when to revert   │                                  │  - Assembly modals  │
│                     │  MenteeBOM → MenteeFlow:         │  - Part replacement │
│                     │  • Stage completed callback      │  - Inventory mgmt   │
│                     │  • Parts re-picked callback      │                     │
│                     │  • Parts replaced callback       │                     │
│                     │  • Stage reverted callback       │                     │
└─────────────────────┘                                  └─────────────────────┘
```

### Key Principle
**MenteeFlow controls the workflow** (when to create, advance, revert). **MenteeBOM controls the data** (parts, inventory, assembly instructions). MenteeBOM users (floor workers) interact with the assembly UI; MenteeFlow is the orchestrator.

---

## 2. File Locations Map

### Backend
| File | Purpose | Key Lines |
|------|---------|-----------|
| `app.py` | All SQLAlchemy models | 645-893 (Robot Assembly models) |
| `robot_assembly.py` | Flask Blueprint — all routes, services, webhooks | 4100+ lines |
| `run.py` | Dev server config, sets `menteebom_dev.db` | line 200 |
| `MENTEEFLOW_API_README.md` | API endpoint documentation for MenteeFlow team | Full file |

### Frontend
| File | Purpose |
|------|---------|
| `frontend/src/pages/RobotAssembly.jsx` | Main page — badge selector, robot figure, process flexbox, modal orchestration |
| `frontend/src/components/robot-assembly/PickingModal.jsx` | Stage 2 picking UI (checkboxes, inventory display) |
| `frontend/src/components/robot-assembly/AssemblyStageModal.jsx` | Stages 3-6 assembly view (parts list, PDF/AI buttons, complete button) |
| `frontend/src/components/robot-assembly/ProcessFlexbox.jsx` | Horizontal scrolling process cards with mini stage progress |
| `frontend/src/components/robot-assembly/MenteeFlowSimulator.jsx` | Dev-only tool to simulate MenteeFlow API calls |
| `frontend/src/components/robot-assembly/RobotAssemblyAdmin.jsx` | Admin tab — MenteeFlow config, robot configs, limbs, DOFs |
| `frontend/src/components/robot-assembly/RobotFigure.jsx` | SVG robot with clickable limb polygons |
| `frontend/src/components/robot-assembly/LimbAssemblyTree.jsx` | Limb assembly tree with dissolve/undissolve |
| `frontend/src/components/robot-assembly/RepickModal.jsx` | Re-pick missing parts modal (Feature 1) |
| `frontend/src/components/robot-assembly/ReplacePartModal.jsx` | Part replacement modal (Feature 3) |
| `frontend/src/components/robot-assembly/EmbedStageView.jsx` | Embedded stage view for MenteeFlow iframes (Feature 2) |
| `frontend/src/components/robot-assembly/LimbSubAssemblyModal.jsx` | Sub-assembly build modal (collect parts) |
| `frontend/src/components/ResizableDialog.jsx` | Reusable resizable dialog wrapper (localStorage persistence) |
| `frontend/src/services/robotAssemblyService.js` | API client for all robot assembly endpoints |
| `frontend/src/services/embedService.js` | Embed-specific API client (token auth, no cookies) |
| `frontend/src/services/api.js` | Base axios instance (withCredentials, 401 interceptor) |

### Database
| Environment | Database File | Set By |
|-------------|--------------|--------|
| **Development** | `instance/menteebom_dev.db` | `run.py` line 200 |
| **Production** | `instance/menteebom.db` | Default config |

**IMPORTANT:** All development changes go to `menteebom_dev.db`. Use `sqlite3.connect('instance/menteebom_dev.db')` for migrations.

---

## 3. Database Models Reference

### 3.1 Core Robot Assembly Models (app.py)

#### RobotConfig (line 645)
One per badge. Stores robot image and links to limbs.
- `badge_id` → FK to ProjectBadge (unique)
- `limbs` → relationship to RobotLimb[]

#### RobotLimb (line 667)
Clickable regions on robot figure. Links to BOM assembly.
- `robot_config_id` → FK to RobotConfig
- `assembly_part_number` → Links to BOM (lookup by part number + badge)
- `dof_mappings` → relationship to DOFMapping[]
- `slug` → URL-safe name for routing

#### DOFMapping (line 696)
Maps DOF identifiers to BOM assemblies. The "200" in process number "2-200-349".
- `limb_id` → FK to RobotLimb
- `dof_number` → "200", "201", etc. (middle 3 digits of process number)
- `dof_name` → "Shoulder Pitch", "Elbow Roll", etc.
- `assembly_description` → Used to find the assembly node in the BOM tree
- `bom_instance_id` → Optional direct link to BOMInstance

#### ProcessBOMInstance (line 723)
Pre-dissolved assembly tree stored as JSON for a specific DOF.
- `dof_mapping_id` → FK to DOFMapping
- `dissolved_tree_json` → Full dissolved tree as JSON
- `version`, `is_current` → Versioning for BOM changes

#### ManufacturingProcess (line 759)
A manufacturing process ticket from MenteeFlow.
- `process_number` → "X-XXX-XXX" format (unique, indexed)
- `badge_id` → FK to ProjectBadge
- `dof_mapping_id` → FK to DOFMapping
- `current_stage` → 1-6 (current active stage number)
- `status` → "active", "completed", "cancelled", "on_hold"
- `badge_digit` / `dof_identifier` / `menteeflow_suffix` → Parsed from process_number
- `menteeflow_ticket_id`, `menteeflow_url` → MenteeFlow references
- `revert_count` → How many times any stage has been reverted (NEW)
- `stages` → relationship to ProcessStage[] (ordered by stage_number)

#### ProcessStage (line 804)
Individual stage within a manufacturing process.
- `process_id` → FK to ManufacturingProcess (CASCADE delete)
- `stage_number` → 1, 2, 3, 4, 5, 6
- `stage_sub` → "3.1", "3.2" for parallel sub-stages (NULL for others)
- `stage_name` → "Picking", "Motor Assembly", etc.
- `status` → "pending", "in_progress", "completed", "skipped", "reverted"
- `stage_data_json` → JSON for stage-specific data (picked parts, etc.)
- `unpicked_parts_json` → JSON for Stage 2 unpicked parts list
- `repick_history_json` → JSON array of re-pick events (NEW)
- `reverted_at`, `reverted_by`, `revert_reason` → Reversal tracking (NEW)
- `original_completed_at` → Preserves first completion time on revert (NEW)
- Unique constraint: `(process_id, stage_number, stage_sub)`

#### MenteeFlowConfig (line 838)
Single-row configuration table for MenteeFlow integration.
- `base_url` → MenteeFlow server URL
- `api_key` → Shared key for outgoing callbacks (MenteeBOM → MenteeFlow)
- `webhook_secret` → Key for validating incoming webhooks (MenteeFlow → MenteeBOM)
- `is_active` → Enable/disable integration
- `badge_digit_mapping` → JSON mapping badge names to digits (e.g., `{"V3.2": "2"}`)
- `displayed_badge_ids` → JSON array of badge IDs shown in Robot Assembly tab
- `embed_url_template` → Template for embed URLs (NEW)

#### EmbedToken (NEW)
Short-lived tokens for embedding MenteeBOM views in MenteeFlow iframes.
- `token` → Cryptographically secure string (unique, indexed)
- `process_id` → FK to ManufacturingProcess
- `stage_scope` → "2", "3.1", "4", etc. (limits what the token can access)
- `expires_at` → Token expiry (default 8 hours, max 24 hours)
- `is_revoked` → Manual revocation flag

#### PartReplacement (NEW)
Records when a part is swapped during assembly.
- `process_id` → FK to ManufacturingProcess
- `stage_id` → FK to ProcessStage
- `old_part_id`, `old_part_number`, `old_revision` → Part being returned
- `new_part_id`, `new_part_number`, `new_revision` → Replacement part
- `quantity` → Number of parts replaced
- `reason` → "broken", "wrong revision", "damaged", etc.
- `created_at`, `created_by` → Audit trail

---

## 4. Stage Lifecycle

### 4.1 Normal Flow (Forward Only)
```
Stage 1: Process Created    ─── auto-completed on creation
    │
Stage 2: Picking            ─── user selects parts from inventory
    │
Stage 3.1: Motor Assembly ──┐── PARALLEL: both can be in_progress simultaneously
Stage 3.2: Gear Assembly  ──┘
    │
Stage 4: Motor+Gear Assembly
    │
Stage 5: Actuator Assembly
    │
Stage 6: DOF Assembly       ─── final stage, completes the process
```

### 4.2 Stage Status Values
| Status | Meaning |
|--------|---------|
| `pending` | Not yet started |
| `in_progress` | Currently active (user can interact) |
| `completed` | Successfully finished |
| `skipped` | Bypassed (not currently used) |
| `reverted` | Was completed but has been rolled back (NEW) |

### 4.3 Reversal Flow (NEW)
MenteeFlow can revert a process to a previous stage:
```
Example: Process at Stage 5, revert to Stage 3.1

Before: 1✓  2✓  3.1✓  3.2✓  4✓  5●  6○
After:  1✓  2✓  3.1●  3.2✓  4⟲  5⟲  6○

✓ = completed, ● = in_progress, ○ = pending, ⟲ = reverted
```

**Rules:**
- Only MenteeFlow can trigger reverts (via API, not from MenteeBOM UI)
- Reverting to 3.1 does NOT affect 3.2 (parallel stages are independent)
- Reverting to a stage before 3 (e.g., Stage 2) reverts BOTH 3.1 and 3.2
- All stages after the target stage are marked as "reverted"
- The target stage is reopened as "in_progress"
- `process.current_stage` is updated to the target stage number
- `process.revert_count` is incremented

---

## 5. Picking → Blocking → Re-pick Flow (Feature 1)

### 5.1 How Picking Works (Stage 2)
1. MenteeFlow advances process to Stage 2
2. Floor user opens PickingModal, sees dissolved parts list with inventory
3. User checks off parts they've collected, submits
4. Picked parts: inventory reduced (`Part.inventory -= qty`)
5. Unpicked parts: stored in `ProcessStage.unpicked_parts_json`
6. MenteeFlow notified with `all_parts_picked` flag and unpicked list

### 5.2 How Blocking Works (NEW)
When a user tries to complete an assembly stage (3-6):
1. Backend cross-references the stage's parts list against the unpicked parts from Stage 2
2. If any parts needed for this stage are in the unpicked list → **BLOCKED**
3. Frontend shows error Alert: "Missing Parts — Cannot Complete Stage"
4. "Finished" button is disabled
5. User can click "Re-pick Missing Parts" → opens RepickModal

### 5.3 Cross-Reference Algorithm
```python
# For each part in the target stage's parts list:
#   Check if (part_number, revision) exists in Stage 2's unpicked_parts_json
#   If yes → this part is "missing" and blocks the stage
#
# Parts are keyed by (part_number, revision) tuple
# Quantities matter: if stage needs 2 but only 1 was unpicked, still blocking
```

### 5.4 Re-pick Flow (NEW)
1. User opens RepickModal from the blocked stage
2. Modal shows only the missing parts with current inventory
3. User checks off parts they've now collected
4. On submit:
   - Inventory reduced for re-picked parts
   - `unpicked_parts_json` updated (remove or reduce quantity)
   - `repick_history_json` appended with re-pick record
   - MenteeFlow notified: `{ status: "parts_repicked", data: { repicked_parts, remaining_unpicked } }`
5. Stage re-checks blocking status — if all parts now picked, "Finished" button enabled

### 5.5 Key Backend Functions to Reuse
- **BOM dissolution logic** in `get_picking_parts()` (robot_assembly.py line 740) — used to get full parts list
- **Stage-to-assembly matching** in `get_stage_parts()` (robot_assembly.py line 956) — matches stage to assembly by description keywords
- **Inventory reduction pattern**: `part.inventory = max(0, part.inventory - qty)` (line 1318)

---

## 6. Embed Token Lifecycle (Feature 2)

### 6.1 Flow
```
1. MenteeFlow calls POST /api/menteeflow/process/{number}/embed-token
   → Gets back: { token, embed_url, expires_at }

2. MenteeFlow opens iframe with embed_url:
   https://menteebom.example.com/embed/process/2-200-349/stage/3.1?token=abc123

3. Inside iframe: React EmbedStageView loads, renders stage content
   → API calls use ?token= query param instead of session cookies

4. User completes stage inside iframe
   → postMessage sent to parent: { type: 'stage-complete', stage: '3.1' }
   → Webhook callback also sent to MenteeFlow

5. Token expires after TTL or is revoked by admin
```

### 6.2 Security Model
| Concern | Solution |
|---------|----------|
| Cross-origin cookies | Token auth, no cookies needed (`withCredentials: false`) |
| iframe embedding | `Content-Security-Policy: frame-ancestors` limited to MenteeFlow origin |
| Token theft | Short-lived (8h default), scoped to process+stage, revocable |
| CORS | Flask-CORS only on `/api/embed/*` routes, only from MenteeFlow origin |
| CSRF | Not applicable (no session, no cookies) |

### 6.3 Embed vs Regular Routes
| Aspect | Regular Routes | Embed Routes |
|--------|---------------|--------------|
| Auth | `@login_required` (Flask-Login session) | `@require_embed_auth` (token query param) |
| URL prefix | `/api/robot-assembly/...` | `/api/embed/...` |
| Frontend | Full app shell (nav, sidebar) | Minimal page (content only, no nav) |
| CORS | Same-origin only | Cross-origin (MenteeFlow origin) |
| Cookie | `withCredentials: true` | `withCredentials: false` |

### 6.4 Embed Frontend Architecture
- `EmbedStageView.jsx` — standalone full-page component that renders inside iframes
  - Reads `processNumber`, `stageNumber` from URL params, `token` from query string
  - Uses `embedService.js` (token-based, no cookies) instead of `robotAssemblyService.js`
  - Handles both picking (stage 2) and assembly stages (3-6)
  - On completion: sends `window.parent.postMessage({ source: 'menteebom-embed', type: 'stage-complete', ... })`
  - Route: `/embed/process/:processNumber/stage/:stageNumber` (no `<ProtectedRoute>` wrapper)
- `embedService.js` — axios instance factory that appends `?token=` to all requests
  - Created via `createEmbedService(token)` — returns an object with the same API methods as `robotAssemblyService` but using embed endpoints

---

## 7. Part Replacement Flow (Feature 3)

### 7.1 When Part Replacement Happens
During assembly (stages 3-6), a floor user discovers a part is broken/damaged/wrong. They need to:
1. Return the broken part to inventory
2. Take a replacement from inventory
3. Continue assembly

### 7.2 Replacement Rules
- **Same part number only** — can only replace with the same part_number
- If multiple revisions exist for that part number, user selects which revision
- Old part is returned: `old_part.inventory += quantity`
- New part is taken: `new_part.inventory = max(0, new_part.inventory - quantity)`
- A `PartReplacement` record is created for audit trail
- MenteeFlow is notified: `{ status: "parts_replaced", data: { old_part, new_part, reason } }`

### 7.3 UI Indicators
- Swap icon (SwapHorizIcon) next to each part in the AssemblyStageModal parts list
- "Replaced" chip on parts that have been swapped
- Reason dropdown: "Broken", "Wrong revision", "Damaged", "Other"

---

## 8. API Endpoints Reference

### 8.1 MenteeFlow Webhook Endpoints (incoming, `@require_menteeflow_auth`)
Auth header: `X-MenteeFlow-API-Key: {webhook_secret}`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/menteeflow/process/create` | Create a new manufacturing process |
| POST | `/api/menteeflow/process/{number}/advance` | Advance to next stage |
| GET | `/api/menteeflow/process/{number}/status` | Poll process status |
| POST | `/api/menteeflow/process/{number}/revert` | Revert to previous stage (NEW) |
| POST | `/api/menteeflow/process/{number}/embed-token` | Generate embed token (NEW) |

### 8.2 Internal Endpoints (`@login_required`)
Auth: Flask-Login session cookie

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/robot-assembly/process/{id}/picking-parts` | Get dissolved parts list for picking |
| POST | `/api/robot-assembly/process/{id}/stage/2/pick` | Submit picking data |
| GET | `/api/robot-assembly/process/{id}/stage-parts/{stage}` | Get assembly + parts for stage |
| POST | `/api/robot-assembly/process/{id}/stage/{stage}/complete` | Complete a stage |
| GET | `/api/robot-assembly/process/{id}/stage/{stage}/unpicked-check` | Check unpicked blocking (NEW) |
| POST | `/api/robot-assembly/process/{id}/repick` | Re-pick missing parts (NEW) |
| POST | `/api/robot-assembly/process/{id}/replace-part` | Replace a broken part (NEW) |
| GET | `/api/robot-assembly/process/{id}/replacements` | Get replacement history (NEW) |

### 8.3 Embed Endpoints (`@require_embed_auth`)
Auth: `?token=` query parameter

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/embed/process/{number}/stage-parts/{stage}` | Stage parts for embed |
| GET | `/api/embed/process/{number}/picking-parts` | Picking parts for embed |
| POST | `/api/embed/process/{number}/stage/{stage}/complete` | Complete stage from embed |
| POST | `/api/embed/process/{number}/stage/2/pick` | Submit picking from embed |
| POST | `/api/embed/process/{number}/repick` | Re-pick from embed |
| GET | `/api/embed/process/{number}/stage/{stage}/unpicked-check` | Unpicked check from embed |

### 8.4 Admin Endpoints (`@login_required` + admin check)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/robot-assembly/admin/menteeflow-config` | Get MenteeFlow config |
| PUT | `/api/robot-assembly/admin/menteeflow-config` | Update MenteeFlow config |
| GET | `/api/robot-assembly/admin/embed-tokens` | List active embed tokens (NEW) |
| DELETE | `/api/robot-assembly/admin/embed-token/{id}` | Revoke an embed token (NEW) |
| POST | `/api/robot-assembly/admin/embed-tokens/revoke-all` | Revoke all active embed tokens (NEW) |

---

## 9. Callback Events (MenteeBOM → MenteeFlow)

All callbacks are sent via `notify_menteeflow()` to:
`POST {base_url}/api/webhook/menteebom/stage-complete`

Header: `X-MenteeBOM-API-Key: {api_key}`

### 9.1 Stage Completed (existing)
```json
{
  "process_number": "2-200-349",
  "stage": 2,
  "status": "completed",
  "timestamp": "2026-03-09T10:00:00Z",
  "completed_by": "floor_user_1",
  "data": { "all_parts_picked": true, "picked_count": 24, "total_count": 24 }
}
```

### 9.2 Parts Re-picked (NEW)
```json
{
  "process_number": "2-200-349",
  "stage": 2,
  "status": "parts_repicked",
  "timestamp": "2026-03-09T11:00:00Z",
  "data": {
    "repicked_parts": [
      { "part_number": "029-MP-01234", "revision": "01", "quantity": 2 }
    ],
    "remaining_unpicked": []
  }
}
```

### 9.3 Stage Reverted (NEW)
```json
{
  "process_number": "2-200-349",
  "stage": "3.1",
  "status": "reverted",
  "timestamp": "2026-03-09T12:00:00Z",
  "data": {
    "reverted_from": 4,
    "reverted_to": "3.1",
    "reason": "Motor assembly defect detected during inspection"
  }
}
```

### 9.4 Parts Replaced (NEW)
```json
{
  "process_number": "2-200-349",
  "stage": "3.1",
  "status": "parts_replaced",
  "timestamp": "2026-03-09T13:00:00Z",
  "data": {
    "old_part": { "part_number": "029-MP-01234", "revision": "01" },
    "new_part": { "part_number": "029-MP-01234", "revision": "02" },
    "quantity": 1,
    "reason": "broken"
  }
}
```

---

## 10. Process Number Format

**Format:** `X-XXX-XXX`

| Segment | Example | Meaning |
|---------|---------|---------|
| First digit (X) | `2` | Badge digit — maps to robot version via `badge_digit_mapping` in MenteeFlowConfig |
| Middle 3 digits (XXX) | `200` | DOF identifier — maps to DOFMapping.dof_number |
| Last 3 digits (XXX) | `349` | MenteeFlow suffix — opaque to MenteeBOM |

**Example:** `2-200-349` → Badge V3.2, DOF #200 (Shoulder Pitch), MenteeFlow process #349

Parsed by `parse_process_number()` in robot_assembly.py line 71.

---

## 11. Key Patterns and Conventions

### 11.1 Lazy Model Import Pattern
All blueprints use `get_models()` to avoid circular imports:
```python
def get_models():
    from app import (db, RobotConfig, RobotLimb, DOFMapping, ...)
    return {'db': db, 'RobotConfig': RobotConfig, ...}

# In route handlers:
m = get_models()
process = m['ManufacturingProcess'].query.get_or_404(process_id)
```

### 11.2 MenteeFlow Notification Pattern
```python
# After any significant event, call:
notify_menteeflow(process, stage_number, callback_data)
# This handles: config check, URL construction, HTTP POST, error logging
```

### 11.3 Inventory Reduction Pattern
```python
part = m['Part'].query.get(part_id)
if part and part.inventory is not None:
    part.inventory = max(0, part.inventory - qty)
```

### 11.4 Stage Number Parsing Pattern
```python
stage_str = str(stage_number)
if '.' in stage_str:
    stage_num = int(stage_str.split('.')[0])
    stage_sub = stage_str
else:
    stage_num = int(stage_number)
    stage_sub = None
```

### 11.5 Frontend Service Pattern
```javascript
// In robotAssemblyService.js:
methodName: (param) => api.get(`/api/robot-assembly/endpoint/${param}`),
```

### 11.6 Frontend Modal Pattern
All modals use `<ResizableDialog>` with:
- `id` prop for localStorage size persistence
- `onClose` callback
- `<DialogTitle>`, `<DialogContent>`, `<DialogActions>` structure
- Loading state with `<CircularProgress>`
- Error state with `<Alert>`

---

## 12. Implementation Checklist

When implementing a new feature in this integration:

1. **Database:** Add columns/tables in `app.py`, run migration against `menteebom_dev.db`
2. **Backend:** Add routes in `robot_assembly.py`, update `get_models()` if new models added
3. **Frontend service:** Add API methods in `robotAssemblyService.js`
4. **Frontend components:** Create/modify components in `frontend/src/components/robot-assembly/`
5. **Simulator:** Update `MenteeFlowSimulator.jsx` if new MenteeFlow endpoints added
6. **Admin:** Update `RobotAssemblyAdmin.jsx` if new config options added
7. **Documentation:** Update `MENTEEFLOW_API_README.md` for any new API endpoints
8. **Test:** Use MenteeFlow Simulator to test the full flow end-to-end

### Migration Template
```python
import sqlite3

def migrate():
    conn = sqlite3.connect('instance/menteebom_dev.db')
    cursor = conn.cursor()

    # Check if column exists before adding
    columns = [col[1] for col in cursor.execute("PRAGMA table_info('table_name')").fetchall()]
    if 'new_column' not in columns:
        cursor.execute("ALTER TABLE table_name ADD COLUMN new_column TYPE DEFAULT default_value")
        print("Added new_column to table_name")

    conn.commit()
    conn.close()

if __name__ == '__main__':
    migrate()
```
