# MenteeFlow Limb Assembly API Reference

Integration guide for MenteeFlow to implement post-DOF limb assembly stages via MenteeBOM.

---

## Overview

After all DOF assemblies for a robot limb are completed, additional assemblies remain that need to be built bottom-up. MenteeBOM auto-generates a **stage tree** from the BOM hierarchy — each stage has a **picking phase** (collect parts) and an **assembly phase** (build with drawing). MenteeFlow creates processes, advances through stages, and embeds MenteeBOM modals in iframes — same pattern as DOF.

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Stage Definition** | An assembly node from the BOM tree that needs its own picking + assembly workflow. |
| **Stage Label** | Mirrors the BOM hierarchy: `LL1`, `LL1.1`, `LL1.1.1`, `LL1.1.1.1`. Prefix from limb name. |
| **Stage Tree** | Stages form a tree. A parent stage can only start when ALL its child stages are completed. |
| **Leaf Stage** | A stage with no children. Can start immediately, parallel with all other leaf stages. |
| **Phase** | Each stage goes through: `pending` -> `picking` -> `assembly` -> `completed` |
| **Limb Process** | One process per robot per limb. Contains all stages from the tree. |

### Stage Hierarchy & Dependency Rule

**One rule: a stage can only start when ALL its direct children are completed.**

Stages mirror the BOM tree. The label uses dotted notation for depth:

```
LL1:            Left Leg Assembly (FINAL)          -- blocked until LL1.1-LL1.7 all done
  LL1.1:        Knee and Ankle Joint               -- blocked until LL1.1.1 done
    LL1.1.1:    Ankle Pitch & Roll Assembly        -- blocked until LL1.1.1.1 done
      LL1.1.1.1: Ankle Pitch Chassis               -- LEAF, starts immediately
  LL1.2:        Shin Left cover with snaps          -- LEAF, starts immediately
  LL1.3:        Front thigh cover with snaps        -- LEAF, starts immediately
  LL1.4:        Hip Joint                           -- LEAF, starts immediately
  LL1.5:        Right thigh cover with snaps        -- LEAF, starts immediately
  LL1.6:        Shin Right cover with snaps         -- LEAF, starts immediately
  LL1.7:        Left thigh cover with snaps         -- LEAF, starts immediately
```

**Build order for this example:**
1. All leaves start in parallel: LL1.1.1.1, LL1.2, LL1.3, LL1.4, LL1.5, LL1.6, LL1.7
2. LL1.1.1 starts when LL1.1.1.1 is done (does NOT wait for covers)
3. LL1.1 starts when LL1.1.1 is done (does NOT wait for covers)
4. LL1 starts when LL1.1 AND LL1.2-LL1.7 are ALL done (final assembly)

### Determining if a stage can start

```python
def can_start(stage_label, all_stages):
    """A stage can start when all its direct children are completed."""
    children = [s for s in all_stages 
                if s.parent_label == stage_label]
    if not children:
        return True  # leaf stage, start immediately
    return all(child.phase == 'completed' for child in children)
```

### Prefix Convention

```
Left Leg  -> LL    Right Leg -> RL
Left Arm  -> LA    Right Arm -> RA
Head      -> H     Torso     -> T
```

---

## Authentication

All `/api/menteeflow/` endpoints require the API key header:

```
X-MenteeFlow-API-Key: <webhook_secret>
```

All `/api/embed/` endpoints require a token query parameter:

```
GET /api/embed/limb-process/LL-2-001/stage/LL1.1.1.1/picking-parts?token=<embed_token>
```

---

## 1. Query Stage Definitions

Before creating a process, query what stages are configured for a limb.

```
GET /api/menteeflow/limb/<limb_id>/stage-definitions
```

**Response:**
```json
{
  "success": true,
  "limb_id": 3,
  "limb_name": "Left Leg",
  "stage_prefix": "LL",
  "stages": [
    {
      "label": "LL1",
      "name": "Left Leg Assembly v3.2",
      "assembly_part_number": "040-AS-01666",
      "has_drawing": true,
      "display_order": 0,
      "parent_stage_label": null
    },
    {
      "label": "LL1.1",
      "name": "Left Knee and Ankle Joint",
      "assembly_part_number": "040-AS-01991",
      "has_drawing": true,
      "display_order": 1,
      "parent_stage_label": "LL1"
    },
    {
      "label": "LL1.1.1",
      "name": "Left Ankle Pitch & Roll Assembly",
      "assembly_part_number": "040-AS-01720",
      "has_drawing": true,
      "display_order": 2,
      "parent_stage_label": "LL1.1"
    },
    {
      "label": "LL1.1.1.1",
      "name": "Left Ankle Pitch Chassis 104",
      "assembly_part_number": "040-AS-01721",
      "has_drawing": false,
      "display_order": 3,
      "parent_stage_label": "LL1.1.1"
    },
    {
      "label": "LL1.2",
      "name": "Left Shin Left cover with snaps",
      "assembly_part_number": "040-AS-01780",
      "has_drawing": false,
      "display_order": 4,
      "parent_stage_label": "LL1"
    }
  ]
}
```

**Key fields:**
- `parent_stage_label`: defines the tree. `null` = root stage.
- `has_drawing`: `true` = has children (blocked stage), `false` = leaf (can start immediately).
- Use `parent_stage_label` to build the dependency tree on your side.

---

## 2. Create Limb Process

```
POST /api/menteeflow/limb-process/create
```

**Request:**
```json
{
  "process_number": "LL-2-001",
  "limb_id": 3,
  "name": "Left Leg Assembly - Robot #001",
  "ticket_id": "MF-456",
  "ticket_url": "https://menteeflow.example/ticket/456"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `process_number` | Yes | Unique identifier. Suggest format: `{prefix}-{badge_digit}-{sequence}` |
| `limb_id` | Yes | MenteeBOM limb ID (from stage definitions query) |
| `name` | No | Human-readable process name |
| `ticket_id` | No | MenteeFlow ticket reference |
| `ticket_url` | No | Direct link back to MenteeFlow |

**Response (201):**
```json
{
  "success": true,
  "process_id": 42,
  "process_number": "LL-2-001",
  "limb_name": "Left Leg",
  "badge_id": 2,
  "stages": [
    { "label": "LL1",       "name": "Left Leg Assembly v3.2",     "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.1",     "name": "Knee and Ankle Joint",       "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.1.1",   "name": "Ankle Pitch & Roll",         "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.1.1.1", "name": "Ankle Pitch Chassis",        "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.2",     "name": "Shin Left cover with snaps", "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.3",     "name": "Front thigh cover",          "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.4",     "name": "Hip Joint",                  "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.5",     "name": "Right thigh cover",          "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.6",     "name": "Shin Right cover",           "parallel_group": 1, "phase": "pending" },
    { "label": "LL1.7",     "name": "Left thigh cover",           "parallel_group": 1, "phase": "pending" }
  ],
  "embed": {
    "token": "abc123...",
    "embed_base_url": "https://menteebom.example/embed/limb-process/LL-2-001",
    "expires_at": "2026-04-02T10:00:00Z"
  }
}
```

**Errors:**
- `409` -- Process number already exists
- `400` -- No stage definitions configured for this limb
- `404` -- Limb not found

---

## 3. Advance Stage

Each stage has three phases. Call advance to move to the next phase.

```
POST /api/menteeflow/limb-process/<process_number>/advance
```

**Request:**
```json
{
  "stage_label": "LL1.1.1.1"
}
```

If `stage_label` is omitted, the next leaf/available stage is advanced.

**Phase transitions:**

```
pending  ->  picking   (user picks parts for this assembly)
picking  ->  assembly  (user assembles with drawing)
assembly ->  completed (stage done)
```

**Response:**
```json
{
  "success": true,
  "stage_label": "LL1.1.1.1",
  "phase": "picking",
  "status": "in_progress",
  "embed": {
    "token": "abc123...",
    "embed_base_url": "https://menteebom.example/embed/limb-process/LL-2-001",
    "expires_at": "2026-04-02T10:00:00Z"
  }
}
```

**Dependency enforcement:**
If you try to advance a parent stage whose children aren't all completed, the API returns 400:

```json
{
  "success": false,
  "error": "Cannot start LL1.1.1 -- sub-stages not complete: LL1.1.1.1",
  "incomplete_children": ["LL1.1.1.1"]
}
```

**Embed URL for iframe:**
```
{embed_base_url}/stage/{stage_label}?token={token}
```

---

## 4. Complete Stage

```
POST /api/menteeflow/limb-process/<process_number>/complete-stage
```

**Request:**
```json
{
  "stage_label": "LL1.1.1.1"
}
```

**Response:**
```json
{
  "success": true,
  "stage_label": "LL1.1.1.1",
  "process_completed": false
}
```

When all stages are completed (including the root), `process_completed` returns `true`.

---

## 5. Get Process Status

```
GET /api/menteeflow/limb-process/<process_number>/status
```

**Response:**
```json
{
  "success": true,
  "process_number": "LL-2-001",
  "status": "active",
  "current_stage_label": "LL1.1.1",
  "revert_count": 0,
  "stages": [
    {
      "label": "LL1",
      "name": "Left Leg Assembly v3.2",
      "parallel_group": 1,
      "phase": "pending",
      "status": "pending",
      "started_at": null,
      "completed_at": null
    },
    {
      "label": "LL1.1.1.1",
      "name": "Ankle Pitch Chassis",
      "parallel_group": 1,
      "phase": "completed",
      "status": "completed",
      "started_at": "2026-04-01T09:00:00Z",
      "completed_at": "2026-04-01T10:00:00Z"
    },
    {
      "label": "LL1.1.1",
      "name": "Ankle Pitch & Roll",
      "parallel_group": 1,
      "phase": "picking",
      "status": "in_progress",
      "started_at": "2026-04-01T10:05:00Z",
      "completed_at": null
    },
    {
      "label": "LL1.2",
      "name": "Shin Left cover",
      "parallel_group": 1,
      "phase": "assembly",
      "status": "in_progress",
      "started_at": "2026-04-01T09:00:00Z",
      "completed_at": null
    }
  ]
}
```

---

## 6. Revert Stage

Roll back to a previous stage. The target stage and all stages that depend on it are reverted.

```
POST /api/menteeflow/limb-process/<process_number>/revert
```

**Request:**
```json
{
  "target_stage": "LL1.1.1.1",
  "reason": "Wrong parts picked"
}
```

**Response:**
```json
{
  "success": true,
  "reverted_to": "LL1.1.1.1",
  "revert_count": 1
}
```

**Revert behavior:**
- The target stage reopens in `picking` phase.
- All stages after it (by display_order) that were completed/in_progress are reverted to `pending`.
- Independent branches are not affected (e.g., reverting LL1.1.1.1 does NOT affect LL1.2-LL1.7).

---

## 7. Cancel Process

```
POST /api/menteeflow/limb-process/<process_number>/cancel
```

**Response:**
```json
{
  "success": true,
  "process_number": "LL-2-001",
  "status": "cancelled"
}
```

---

## 8. Get/Refresh Embed Token

```
POST /api/menteeflow/limb-process/<process_number>/embed-token
```

**Response:**
```json
{
  "success": true,
  "process_number": "LL-2-001",
  "embed": {
    "token": "new_token_abc...",
    "embed_base_url": "https://menteebom.example/embed/limb-process/LL-2-001",
    "expires_at": "2026-04-02T10:00:00Z"
  }
}
```

Token TTL: 8 hours. Returns existing active token if available, otherwise creates a new one.

---

## 9. Embed Endpoints (iframe)

These are called from within MenteeFlow iframes using the embed token as a query parameter.

All responses include CORS headers (`Access-Control-Allow-Origin`, `frame-ancestors`).

### Picking Phase

```
GET  /api/embed/limb-process/<process_number>/stage/<stage_label>/picking-parts?token=...
POST /api/embed/limb-process/<process_number>/stage/<stage_label>/pick?token=...
```

**GET picking-parts response:**
```json
{
  "success": true,
  "stage_label": "LL1.1.1.1",
  "stage_name": "Ankle Pitch Chassis 104",
  "phase": "picking",
  "assembly": {
    "part_number": "040-AS-01721",
    "bom_instance_id": 99,
    "stage_name": "Ankle Pitch Chassis 104",
    "stage_label": "LL1.1.1.1"
  },
  "parts": [
    {
      "part_id": 101,
      "part_number": "040-PT-001",
      "revision": "A",
      "part_name": "Bearing",
      "description": "Deep groove ball bearing",
      "quantity": 2,
      "inventory": 15,
      "thumbnail": "/thumbnails/040-PT-001.png",
      "warehouse_box": "A3-12",
      "part_type": "Mechanical Part"
    }
  ]
}
```

**POST pick request:**
```json
{
  "picked_parts": [
    { "part_id": 101, "part_number": "040-PT-001", "revision": "A", "quantity": 2 }
  ],
  "unpicked_parts": [
    { "part_id": 102, "part_number": "040-PT-002", "revision": "B", "quantity": 1 }
  ]
}
```

### Assembly Phase

```
GET  /api/embed/limb-process/<process_number>/stage/<stage_label>/assembly-parts?token=...
POST /api/embed/limb-process/<process_number>/stage/<stage_label>/complete?token=...
```

### Damaged Part / Unpicked Check

```
POST /api/embed/limb-process/<process_number>/stage/<stage_label>/damaged-part?token=...
GET  /api/embed/limb-process/<process_number>/stage/<stage_label>/unpicked-check?token=...
```

**Damaged part request:**
```json
{
  "old_part_id": 101,
  "old_part_number": "040-PT-001",
  "old_revision": "A",
  "new_part_id": 101,
  "new_part_number": "040-PT-001",
  "new_revision": "A",
  "quantity": 1,
  "reason": "Broken during assembly"
}
```

### Existing Embed Endpoints (reusable)

Part PDFs and AI instructions use the existing DOF embed endpoints:
```
GET /api/embed/part-pdf/<part_number>/<revision>?token=...
GET /api/embed/part-ai/<part_number>?token=...
```

---

## 10. Webhooks (MenteeBOM -> MenteeFlow)

MenteeBOM sends POST requests to MenteeFlow when events occur. Implement these endpoints on the MenteeFlow side.

### Stage Definitions Changed

Sent when a MenteeBOM user saves or clears stage definitions for a limb, **and** whenever
MenteeBOM re-syncs the limb's assembly tree to a newer BOM version (this happens
automatically — immediately when the tree or these definitions are read, or within
~5 minutes of the BOM import via a background sweep). A re-sync can remap stages to new
BOM rows or deactivate a stage whose assembly is no longer in the BOM.

```
POST {your_base_url}/api/webhook/menteebom/limb-stages-changed
POST {your_base_url}/api/webhook/menteebom/limb-stages-cleared
```

**Headers:** `X-MenteeBOM-API-Key: <api_key>`

**Payload:**
```json
{
  "limb_id": 3,
  "limb_name": "Left Leg",
  "stage_prefix": "LL",
  "stage_count": 10,
  "stages": [
    {
      "label": "LL1.2",
      "name": "Knee Assembly (DOF 203, 204)",
      "dof_numbers": ["203", "204"],
      "assembly_part_number": "040-AS-01666",
      "parallel_group": 1,
      "has_sub_stages": true,
      "has_drawing": true,
      "display_order": 0
    }
  ],
  "timestamp": "2026-04-01T12:00:00Z"
}
```

`name` is the BOM/PDM description of the stage's assembly with the stage's DOF numbers
appended when the stage picks one or more DOF assemblies (`dof_numbers` carries them
separately; it is `[]` for stages with no DOF). The same `name` form is used for
`stage_name` / `name` in every other limb-process payload and endpoint.

**Recommended action:** Refresh your cached stage definitions for this limb.

### Stage Completed

Sent when a limb stage is completed (from MenteeBOM UI or embed iframe).

```
POST {your_base_url}/api/webhook/menteebom/limb-stage-complete
```

**Headers:** `X-MenteeBOM-API-Key: <api_key>`

**Payload:**
```json
{
  "process_number": "LL-2-001",
  "stage_label": "LL1.1.1.1",
  "status": "completed",
  "timestamp": "2026-04-01T14:30:00Z",
  "completed_by": "john.smith"
}
```

`status` can also be `"reverted"` when a stage is rolled back.

**Recommended action:** Check if any parent stages are now unblocked (all their children completed). If so, you can advance those parent stages.

---

## Typical Flow (Left Leg Example)

```
MenteeFlow                              MenteeBOM
   |                                        |
   |  GET /limb/3/stage-definitions         |
   |--------------------------------------->|  "What stages exist for Left Leg?"
   |<---------------------------------------|  Tree: LL1 > LL1.1 > LL1.1.1 > LL1.1.1.1
   |                                        |         LL1.2-LL1.7 (leaves)
   |                                        |
   |  POST /limb-process/create             |
   |--------------------------------------->|  Create process LL-2-001
   |<---------------------------------------|  10 stages created, all pending
   |                                        |
   |  [Start all leaf stages in parallel]   |
   |                                        |
   |  POST /advance {label: "LL1.1.1.1"}   |  Ankle Pitch Chassis (leaf)
   |--------------------------------------->|  phase: picking
   |  POST /advance {label: "LL1.2"}        |  Shin cover (leaf, parallel)
   |--------------------------------------->|  phase: picking
   |  POST /advance {label: "LL1.4"}        |  Hip Joint (leaf, parallel)
   |--------------------------------------->|  phase: picking
   |  ... (all other leaves)                |
   |                                        |
   |  [User completes LL1.1.1.1]           |
   |<---------------------------------------| WEBHOOK: LL1.1.1.1 completed
   |                                        |
   |  [LL1.1.1 now unblocked!]             |
   |  POST /advance {label: "LL1.1.1"}     |  Ankle Pitch & Roll
   |--------------------------------------->|  phase: picking (children all done)
   |                                        |
   |  [User completes LL1.1.1]             |
   |<---------------------------------------| WEBHOOK: LL1.1.1 completed
   |                                        |
   |  [LL1.1 now unblocked!]               |
   |  POST /advance {label: "LL1.1"}       |  Knee and Ankle Joint
   |--------------------------------------->|  phase: picking
   |                                        |
   |  ... covers finish in parallel ...     |
   |                                        |
   |  [All LL1.1-LL1.7 completed]          |
   |  [LL1 now unblocked!]                 |
   |  POST /advance {label: "LL1"}         |  Final assembly
   |--------------------------------------->|  phase: picking
   |                                        |
   |  [User completes LL1]                 |
   |<---------------------------------------| WEBHOOK: LL1 completed
   |                                        |  process_completed: true
```

---

## Implementation Checklist for MenteeFlow

1. **Query stage definitions** for each limb and build a dependency tree from `parent_stage_label`
2. **Identify leaf stages** (no children) -- these can start immediately in parallel
3. **On stage completion webhook**, check if any parent stages are now unblocked
4. **Before advancing a non-leaf stage**, verify all its children are completed (the API enforces this too, returning 400 if not)
5. **Embed the picking/assembly modals** using the embed token URL pattern

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad request (missing fields, invalid state, children not completed) |
| 401 | Invalid or missing API key / embed token |
| 403 | Token doesn't match process |
| 404 | Process, stage, or limb not found |
| 409 | Process number already exists |
