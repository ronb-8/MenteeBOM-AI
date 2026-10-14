# MenteeFlow ↔ MenteeBOM — Limb Assembly Integration

This document describes what MenteeFlow needs to send to MenteeBOM to drive the limb assembly workflow, and what MenteeBOM sends back.

---

## Authentication

Every request from MenteeFlow must include:

```
X-MenteeFlow-API-Key: <webhook_secret>
```

The `webhook_secret` is configured in MenteeBOM Admin → Robot Assembly → MenteeFlow Config.

---

## Process Number Format

Limb assembly process numbers use the format:

```
{PREFIX}-{VERSION}-{SEQUENCE}
```

| Part | Example | Meaning |
|------|---------|---------|
| PREFIX | `LL` | Limb prefix: `LL` Left Leg, `RL` Right Leg, `LA` Left Arm, `RA` Right Arm, `T` Torso, `H` Head |
| VERSION | `2` | Robot generation digit (`1` = V3.1, `2` = V3.2). Mapped to a MenteeBOM badge via `MenteeFlowConfig.badge_digit_mapping` |
| SEQUENCE | `001` | 3-digit sequence number, unique per (PREFIX, VERSION) |

Examples: `LL-2-001` (first left leg for V3.2), `RA-1-005` (fifth right arm for V3.1), `T-2-001` (first torso for V3.2).

The prefix determines which limb is assembled — MenteeFlow does not need to know the internal limb ID. The version digit is translated to the correct robot generation/badge using the digit mapping configured in MenteeBOM admin.

---

## Step 1: Open or Start a Limb Assembly Process

When a floor worker scans a work order or MenteeFlow creates a limb assembly ticket, call:

```
POST /api/menteeflow/limb-process/open
```

**Request body:**
```json
{
  "process_number": "LL-2-001",
  "ticket_id": "MF-1234",
  "ticket_url": "https://menteeflow.example.com/tickets/MF-1234"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `process_number` | Yes | The process number to open or create |
| `ticket_id` | No | MenteeFlow ticket ID (stored for reference) |
| `ticket_url` | No | Link back to the MenteeFlow ticket |

**Response (process created):**
```json
{
  "success": true,
  "created": true,
  "process_id": 42,
  "process_number": "LL-2-001",
  "limb_name": "Left Leg",
  "status": "active",
  "current_stage_label": "LL1.1.1",
  "embed": {
    "token": "abc123...",
    "embed_base_url": "https://menteebom.example.com/embed/limb-process/LL-2-001",
    "current_stage_url": "https://menteebom.example.com/embed/limb-process/LL-2-001/stage/LL1.1.1?token=abc123...",
    "expires_at": "2026-06-14T10:00:00Z"
  }
}
```

**Response (process already exists — resume):**
```json
{
  "success": true,
  "created": false,
  "process_id": 42,
  "process_number": "LL-2-001",
  "limb_name": "Left Leg",
  "status": "active",
  "current_stage_label": "LL1.3",
  "embed": {
    "token": "abc123...",
    "embed_base_url": "https://menteebom.example.com/embed/limb-process/LL-2-001",
    "current_stage_url": "https://menteebom.example.com/embed/limb-process/LL-2-001/stage/LL1.3?token=abc123...",
    "expires_at": "2026-06-14T10:00:00Z"
  }
}
```

### How to embed the UI

Embed `current_stage_url` in an iframe. This URL is already authenticated via the token and opens exactly where the process left off:

```html
<iframe src="{current_stage_url}" width="100%" height="800px" />
```

The token is process-wide and valid for 30 days. Call `/open` again any time to get a refreshed `current_stage_url` pointing to the latest active stage.

### Read-only / repair mode

For the repair flow (replacing a motor on an already-completed limb), append `&mode=readonly` to the embed URL:

```
http://<menteebom-host>/embed/limb-process/LL-2-001/stage/LL1.1.1.1?token=<token>&mode=readonly
```

In read-only mode:

- The same picking and assembly UI renders — operators see the parts list, thumbnails, drawing PDFs, and the assembly walkthrough.
- A yellow banner reads **"Read-only — repair view. Submit actions are disabled."** at the top of the iframe.
- The **Finish Part Picking** and **Finished Assembly** buttons are hidden. Checkboxes in the picking list are disabled.
- **No webhooks fire from this view** — `picking_started`, `picking_completed`, and `completed` are all suppressed. The iframe is side-effect-free.
- The **Re-pick** action in the assembly modal is hidden.

MenteeFlow can open the same embed URL with or without `mode=readonly` — the same React component renders, just gated.

---

## Step 2: MenteeBOM calls you back

MenteeBOM notifies MenteeFlow at two points during each stage:

### 2a. Picking completed (floor user finished picking parts)

```
POST {menteeflow_base_url}/api/webhook/menteebom/limb-stage-complete
```

```json
{
  "process_number": "LL-2-001",
  "stage_label": "LL1.3",
  "status": "picking_completed",
  "timestamp": "2026-05-14T08:30:00Z",
  "completed_by": "john.doe",
  "data": {
    "dof_number": "104",
    "stage_dof_numbers": ["104"],
    "dof_numbers": ["100", "101", "102", "103", "104", "105"],
    "stage_assembly_part_number": "040-AS-01990",
    "stage_name": "Left Hip Joint",
    "el_components": [
      { "part_number": "029-EL-00123", "quantity": 2 },
      { "part_number": "029-EL-00456", "quantity": 1 }
    ],
    "progress": {
      "completed_stages": 3,
      "total_stages": 14,
      "percent": 21.4
    },
    "process_completed": false,
    "forwarded": false
  }
}
```

**`process_completed`** — `true` only on the webhook that completes the LAST stage of the limb (i.e. the limb is fully assembled). Lets you flag "limb done" without inspecting `data.process.status` or every stage's phase. Present on every webhook event.

**`forwarded`** — `true` when the stage was force-completed via the Forward button (already-built limb onboarding). On a Forward, MenteeBOM fires a single `completed` event for the stage — same as a normal stage completion — but with `forwarded: true` set. No inventory is deducted on our side; we just mark the stage done and notify. If you want to distinguish "stage skipped, no inventory consumed" from "stage actually built" in your UI, check this flag. Safe to ignore otherwise. Present on every webhook event.

### 2b. Assembly completed (floor user finished assembly, stage fully done)

Same endpoint, same payload structure, with `"status": "completed"`.

### 2c. Stage reverted

`"status": "reverted"` — the process was rolled back to this stage (admin action).

---

## Inventory behavior

### Limb completion → +1 to the limb assembly

When the final stage of a limb process completes (and `process.status` flips to `completed`), MenteeBOM **increments the limb's top-level assembly Part inventory by 1**. The Part looked up is `RobotLimb.assembly_part_number` (e.g. `040-AS-01666` for "Left Leg Assembly v3.2"). Mirrors DOF process behavior — "we just built one".

### Revert from completed → -1

If a completed limb process is reverted (via `/api/menteeflow/limb-process/{pn}/revert` or the native admin rollback), the +1 above is undone — the limb assembly Part loses 1 from inventory. The response includes `limb_assembly_decremented: true` when this happens.

### Repair-style revert with per-part replacement

The `/revert` endpoint accepts optional `replaced_parts` and `target_phase`. Body:

```json
{
  "target_stage": "LL1.1.1.1",
  "reason": "Motor replacement",
  "target_phase": "assembly",
  "replaced_parts": [
    { "part_id": 123, "quantity": 1 },
    { "part_id": 456, "quantity": 2 }
  ]
}
```

**`target_phase`** controls where the reverted stages land (default: `"assembly"`):

- **`"assembly"`** (repair-flow default): the target stage + cascade all stay at `phase=assembly` with `picked_parts_json` preserved. The operator only needs to redo assembly with the replacement parts — they don't re-pick everything from scratch since the original parts are physically still in the limb. Webhook fires with `status="reverted"` and `phase: "assembly"` in `data.process.stages`.
- **`"picking"`**: full reset. Target → `phase=picking`, cascade → `phase=pending`. Inventory of previously picked parts is **returned to stock** (so re-picking doesn't double-deduct), and `picked_parts_json` is cleared. Response includes `inventory_returned_count`.

**`replaced_parts`** lets MenteeFlow declare which parts were physically replaced during disassembly. For each entry, MenteeBOM **deducts that quantity from inventory** — modelling the new part used to replace a damaged one. Parts NOT listed are considered physically reused → no inventory change. Response includes `replaced_parts_deducted: [...]` with before/after inventory.

Send `replaced_parts: []` (or omit) when nothing physical needs replacing.

**Response:**
```json
{
  "success": true,
  "reverted_to": "LL1.1.1.1",
  "target_phase": "assembly",
  "revert_count": 1,
  "replaced_parts_deducted": [...],
  "inventory_returned_count": 0,
  "limb_assembly_decremented": true
}
```

### Native admin rollback (different semantics)

The native MenteeBOM admin "Rollback" button (`POST /api/robot-assembly/limb-process/{id}/stage/{label}/rollback`) **returns ALL previously-picked parts back to stock** and resets the stage to `picking` phase. Use this when the entire assembly was wrong and needs to be redone from scratch. Response includes `parts_returned_to_stock` count.

### Data fields

| Field | Description |
|-------|-------------|
| `dof_number` | **The DOF number for this specific stage's assembly** (e.g. `"104"`). `null` when the stage isn't a DOF assembly (e.g. integration stages, structural sub-assemblies). Use this for the most common case — one DOF per stage. |
| `stage_dof_numbers` | List form of `dof_number`. Usually one element. May contain multiple when one stage covers an assembly that integrates multiple DOFs (e.g. `["104", "110"]` for a combined Pitch & Roll assembly). Empty list when none. |
| `dof_numbers` | All DOFs registered for the whole limb. **Context only — not stage-specific.** Provided so MenteeFlow knows what DOFs the limb covers. |
| `stage_assembly_part_number` | The MenteeBOM part number of the assembly being built in this stage. |
| `stage_name` | Human-readable stage name (e.g. `"Left Hip Joint"`). |
| `el_components` | Electrical parts (Inhouse or External electrical) that were picked during the picking phase of this stage. Fasteners are NOT included — they are auto-handled. |
| `progress.percent` | Overall process completion (0–100). |

---

## Optional: Poll Process Status

```
GET /api/menteeflow/limb-process/{process_number}/status
```

Returns full stage list with phase/status for each stage.

## On-demand stage parts (for the repair-replace picker)

```
GET /api/menteeflow/limb-process/{process_number}/stage/{stage_label}/parts
```

Returns the parts in a stage so the rollback dialog can show the operator which ones to mark as replaced. Works any time after process creation, regardless of picking state or webhook history.

**Response:**
```json
{
  "success": true,
  "process_number": "LL-2-018",
  "stage_label": "LL1.1.1.1",
  "stage_name": "Left Ankle Pitch Chassis 104",
  "stage_assembly_part_number": "040-AS-01721",
  "phase": "completed",
  "parts": [
    {
      "part_id": 1234,
      "part_number": "040-AS-01996",
      "name": "Ankle Pitch assembly DOF 104/110",
      "category": "Assembly",
      "category_short": "AS",
      "quantity": 1,
      "current_stock": 0,
      "box": "MT-014",
      "revision": "A",
      "thumbnail": "http://192.168.31.219:5000/api/parts/1234/thumbnail"
    },
    {
      "part_id": 1235,
      "part_number": "040-MP-05176",
      "name": "Knee to Ankle Chassis",
      "category": "Mechanical part",
      "category_short": "MP",
      "quantity": 1,
      "current_stock": 3,
      "box": "MT-021",
      "revision": "B"
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `part_id` | What to send back in `replaced_parts[].part_id` on `/revert` |
| `part_number` | Human-recognizable part number |
| `name` | Part name or description |
| `category` | Full classification (`Mechanical part`, `Fasteners`, `Inhouse electrical part`, etc.) |
| `category_short` | Short form parsed from part number: `MP`, `AS`, `EL`, etc. |
| `quantity` | BOM quantity for this stage |
| `current_stock` | Live count from MenteeBOM's Part table |
| `box` | Warehouse box number (where the part lives in stock) |
| `revision` | Part revision letter (some parts have multiple revisions) |
| `thumbnail` | Absolute URL for `<img src>` (or base64 data URI for legacy parts). `null` if no image exists. Image is served unauthenticated — fetch from MenteeFlow's browser directly. |

**Note on fasteners:** the `parts` array includes everything in the BOM at this stage, including fasteners (`part_type == "Fasteners"`). Fasteners are not in the picking-phase list operators see, but they ARE deducted on assembly completion, so the rollback picker should show them. Filter by `part_type` client-side if you want to hide them.

**Errors:**
- `404` if process or stage not found
- `401` if API key is invalid or missing

---

## Optional: Advance / Complete / Revert via API

MenteeFlow can also drive stage transitions directly (without waiting for the floor user to use the embed UI). These are the existing endpoints documented in `MENTEEFLOW_LIMB_ASSEMBLY_API.md`.

---

## Fastener Handling (Important)

Fasteners are **not shown** in the picking list. The floor user only picks structural and electrical parts. When assembly is marked complete, MenteeBOM automatically deducts fastener inventory based on the stage BOM. No action needed from MenteeFlow for this.

---

## Error Codes

| HTTP | Meaning |
|------|---------|
| 400 | Bad request — check `error` field in response |
| 404 | Process number not found, or limb prefix unknown |
| 409 | Duplicate — process already exists (only on the old `create` endpoint) |
| 401/403 | Invalid or missing API key |
