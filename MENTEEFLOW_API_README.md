# MenteeFlow <-> MenteeBOM API Integration Guide

## Overview

MenteeBOM and MenteeFlow communicate via **REST API webhooks**. Each system exposes endpoints that the other calls. Authentication uses a shared API key passed in request headers.

```
MenteeFlow                              MenteeBOM
   |                                       |
   |-- POST /api/menteeflow/process/create -->|   (Stage 1: New process)
   |                                       |
   |-- POST /api/menteeflow/process/{id}/advance -->|   (Advance to stage 2, 3, 4, 5, 6)
   |                                       |
   |<-- POST /api/webhook/menteebom/stage-complete --|   (Stage completed callback)
   |                                       |
   |-- GET /api/menteeflow/process/{id}/status -->|   (Poll status anytime)
   |                                       |
```

---

## Authentication

All requests between the two systems use API key authentication.

### MenteeFlow -> MenteeBOM (incoming)

```
Header: X-MenteeFlow-API-Key: <shared_webhook_secret>
```

The `webhook_secret` is configured by the MenteeBOM admin in the Robot Assembly admin panel.

### MenteeBOM -> MenteeFlow (outgoing callbacks)

```
Header: X-MenteeBOM-API-Key: <shared_api_key>
Content-Type: application/json
```

The `api_key` is configured by the MenteeBOM admin. MenteeFlow must validate this key on incoming requests.

---

## Process Number Format

All processes use the pattern: **`X-XXX-XXX`**

| Segment | Example | Meaning |
|---------|---------|---------|
| First digit (`X`) | `2` | Badge identifier. Maps to robot version (e.g., 2 -> V3.2). Configured in MenteeBOM admin. |
| Middle 3 digits (`XXX`) | `200` | DOF identifier. Maps to a specific DOF/assembly within a robot limb. MenteeBOM uses this to look up the correct assembly. |
| Last 3 digits (`XXX`) | `349` | MenteeFlow process suffix. Opaque to MenteeBOM -- used by MenteeFlow for its own process tracking. |

**Example:** `2-200-349` -> Badge V3.2, DOF #200 (e.g., Right Arm Shoulder Pitch), MenteeFlow process #349

---

## Endpoints MenteeFlow Must Call (MenteeBOM API)

**Base URL:** `http(s)://<menteebom-host>/api/menteeflow`

### 1. Create Process (Stage 1)

Creates a new manufacturing process. The process appears immediately in MenteeBOM's Robot Assembly process flexbox.

```
POST /api/menteeflow/process/create
```

**Request Headers:**
```
X-MenteeFlow-API-Key: <webhook_secret>
Content-Type: application/json
```

**Request Body:**
```json
{
  "process_number": "2-200-349",
  "name": "Right Arm Shoulder DOF Assembly #349",
  "ticket_id": "MF-2025-00349",
  "ticket_url": "https://menteeflow.example.com/tickets/MF-2025-00349"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `process_number` | string | Yes | Format: `X-XXX-XXX`. Must be unique across all processes. |
| `name` | string | Yes | Human-readable name displayed in MenteeBOM. |
| `ticket_id` | string | No | MenteeFlow's internal ticket/process ID for reference. |
| `ticket_url` | string | No | Direct URL to view this process in MenteeFlow. |

**Success Response (201):**
```json
{
  "success": true,
  "process_id": 42,
  "process_number": "2-200-349",
  "badge": "V3.2",
  "dof_name": "Shoulder Pitch",
  "limb": "Right Arm",
  "message": "Process created successfully",
  "embed": {
    "token": "abc123...long_token_string",
    "embed_base_url": "https://menteebom.example.com/embed/process/2-200-349",
    "expires_at": "2025-06-15T18:30:00Z"
  }
}
```

> **Important:** Save the `embed.token` — it is a process-wide token that works for **all stages**. Use it to build iframe URLs:
> `{embed_base_url}/stage/{STAGE_NUMBER}?token={token}`
> Example: `https://menteebom.example.com/embed/process/2-200-349/stage/2?token=abc123...`
> The token expires after 8 hours. If expired, call `POST /api/menteeflow/process/{process_number}/embed-token` to get a new one.

**Error Responses:**

| Code | Meaning |
|------|---------|
| 400 | Invalid process_number format, missing required fields |
| 401 | Invalid or missing API key |
| 404 | Badge digit or DOF number not mapped to any assembly |
| 409 | Process number already exists |

---

### 2. Advance Process to Next Stage

Tells MenteeBOM to activate the next stage. MenteeBOM will make the appropriate stage modal available to the floor user.

```
POST /api/menteeflow/process/{process_number}/advance
```

**Request Headers:**
```
X-MenteeFlow-API-Key: <webhook_secret>
Content-Type: application/json
```

**Request Body:**
```json
{
  "stage": 2,
  "stage_data": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stage` | number | Yes | The stage to activate. Valid values: `2`, `3.1`, `3.2`, `4`, `5`, `6` |
| `stage_data` | object | No | Stage-specific data (see below) |

**Stage-specific `stage_data`:**

| Stage | Data | Description |
|-------|------|-------------|
| 2 (Picking) | `{}` | No extra data needed |
| 3.1 (Motor Assembly) | `{ "motor_type": "MA" }` | One of: MA, MB, MC, MD |
| 3.2 (Gear Assembly) | `{ "gear_assembly_serial": "200" }` | DOF serial for matching gear assembly |
| 4 (Motor+Gear Assembly) | `{}` | No extra data needed |
| 5 (Actuator Assembly) | `{}` | No extra data needed |
| 6 (DOF Assembly) | `{}` | No extra data needed |

**Important:** Stages 3.1 and 3.2 can be advanced **simultaneously** (both can be in_progress at the same time). All other stages are sequential.

**Success Response (200):**
```json
{
  "success": true,
  "process_number": "2-200-349",
  "stage": 2,
  "stage_status": "in_progress",
  "message": "Stage 2 (Picking) activated",
  "embed": {
    "token": "abc123...same_token_as_create",
    "embed_base_url": "https://menteebom.example.com/embed/process/2-200-349",
    "expires_at": "2025-06-15T18:30:00Z"
  }
}
```

> The `embed` object returns the **same process-wide token** from the `/create` call (as long as it hasn't expired). No need to store a new token per stage.

**Error Responses:**

| Code | Meaning |
|------|---------|
| 400 | Invalid stage number, stage cannot be advanced (previous stage not complete) |
| 401 | Invalid API key |
| 404 | Process number not found |
| 409 | Stage already in_progress or completed |

---

### 3. Poll Process Status

Check the current state of a process at any time. Use this as a fallback if a stage-complete callback was missed.

```
GET /api/menteeflow/process/{process_number}/status
```

**Request Headers:**
```
X-MenteeFlow-API-Key: <webhook_secret>
```

**Success Response (200):**
```json
{
  "process_number": "2-200-349",
  "name": "Right Arm Shoulder DOF Assembly #349",
  "badge": "V3.2",
  "dof_name": "Shoulder Pitch",
  "limb": "Right Arm",
  "current_stage": 2,
  "status": "active",
  "created_at": "2025-06-15T10:30:00Z",
  "updated_at": "2025-06-15T11:45:00Z",
  "stages": [
    {
      "stage_number": 1,
      "stage_name": "Process Created",
      "status": "completed",
      "started_at": "2025-06-15T10:30:00Z",
      "completed_at": "2025-06-15T10:30:00Z"
    },
    {
      "stage_number": 2,
      "stage_name": "Picking",
      "status": "in_progress",
      "started_at": "2025-06-15T11:00:00Z",
      "completed_at": null
    },
    {
      "stage_number": 3.1,
      "stage_name": "Motor Assembly",
      "status": "pending",
      "started_at": null,
      "completed_at": null
    },
    {
      "stage_number": 3.2,
      "stage_name": "Gear Assembly",
      "status": "pending",
      "started_at": null,
      "completed_at": null
    },
    {
      "stage_number": 4,
      "stage_name": "Motor and Gear Assembly",
      "status": "pending",
      "started_at": null,
      "completed_at": null
    },
    {
      "stage_number": 5,
      "stage_name": "Actuator Assembly",
      "status": "pending",
      "started_at": null,
      "completed_at": null
    },
    {
      "stage_number": 6,
      "stage_name": "DOF Assembly",
      "status": "pending",
      "started_at": null,
      "completed_at": null
    }
  ]
}
```

---

## Endpoint MenteeFlow Must Expose (Callback from MenteeBOM)

MenteeBOM will POST to MenteeFlow when a floor user completes a stage.

### Stage Completion Callback

**MenteeFlow must expose:**
```
POST https://<menteeflow-host>/api/webhook/menteebom/stage-complete
```

**Request Headers (from MenteeBOM):**
```
X-MenteeBOM-API-Key: <api_key>
Content-Type: application/json
```

**Request Body:**
```json
{
  "process_number": "2-200-349",
  "stage": 2,
  "status": "completed",
  "timestamp": "2025-06-15T11:45:00Z",
  "completed_by": "floor_user_1",
  "data": {}
}
```

### Stage-specific `data` payloads

#### Stage 2 (Picking) -- All parts picked:
```json
{
  "data": {
    "all_parts_picked": true,
    "picked_count": 24,
    "total_count": 24
  }
}
```

#### Stage 2 (Picking) -- Some parts NOT picked:
```json
{
  "data": {
    "all_parts_picked": false,
    "picked_count": 20,
    "total_count": 24,
    "unpicked_parts": [
      {
        "part_number": "029-MP-01234",
        "revision": "01",
        "description": "Shoulder Bearing Housing",
        "required_quantity": 2,
        "inventory_available": 0,
        "parent_assembly": "029-AS-00200"
      },
      {
        "part_number": "029-MP-01567",
        "revision": "03",
        "description": "M4x12 Socket Head Cap Screw",
        "required_quantity": 8,
        "inventory_available": 4,
        "parent_assembly": "029-AS-00200"
      }
    ]
  }
}
```

#### Stage 3.1 (Motor Assembly Finished):
```json
{
  "data": {
    "motor_type": "MA",
    "assembly_completed": true
  }
}
```
**MenteeFlow action:** Start timer for motor assembly process

#### Stage 3.2 (Gear Assembly Finished):
```json
{
  "data": {
    "gear_assembly_serial": "200",
    "assembly_completed": true
  }
}
```
**MenteeFlow action:** Start timer for gear assembly process

#### Stage 4 (Motor+Gear Assembly Finished):
```json
{
  "data": {
    "assembly_completed": true
  }
}
```
**MenteeFlow action:** Start timer for loctite of motor and gear assembly process

#### Stage 5 (Actuator Assembly Finished):
```json
{
  "data": {
    "assembly_completed": true
  }
}
```
**MenteeFlow action:** Raise "driver assembled" flag

#### Stage 6 (DOF Assembly Finished):
```json
{
  "data": {
    "assembly_completed": true
  }
}
```
**MenteeFlow action:** Close/finish the ticket

### Expected Response from MenteeFlow (200):
```json
{
  "success": true,
  "message": "Stage completion acknowledged"
}
```

If MenteeFlow returns a non-200 status, MenteeBOM will log the failure but will NOT retry automatically. MenteeFlow can poll `/api/menteeflow/process/{number}/status` to catch up on any missed callbacks.

---

## Complete Process Flow

```
MenteeFlow                          MenteeBOM                         Floor User
    |                                   |                                 |
    |-- POST /process/create ---------->|                                 |
    |   {process_number: "2-200-349"}   |-- Process appears in flexbox -->|
    |<-- 201 {success, process_id} -----|                                 |
    |                                   |                                 |
    |-- POST /process/2-200-349/advance |                                 |
    |   {stage: 2} -------------------->|-- Picking modal available ----->|
    |<-- 200 {stage: "in_progress"} ----|                                 |
    |                                   |                                 |
    |                                   |<-- User picks parts ------------|
    |                                   |<-- "Finish Part Picking" -------|
    |<-- POST /stage-complete ----------|                                 |
    |   {stage: 2, unpicked_parts:[]}   |                                 |
    |-- 200 {success} ----------------->|                                 |
    |                                   |                                 |
    |-- POST /advance {stage: 3.1} ---->|-- Motor assembly modal ------->|
    |-- POST /advance {stage: 3.2} ---->|-- Gear assembly modal -------->|
    |   (3.1 and 3.2 can be parallel)   |                                 |
    |                                   |<-- "Motor Assembly Finished" ---|
    |<-- POST /stage-complete {3.1} ----|                                 |
    |                                   |<-- "Gear Assembly Finished" ----|
    |<-- POST /stage-complete {3.2} ----|                                 |
    |                                   |                                 |
    |-- POST /advance {stage: 4} ------>|-- Motor+Gear modal ----------->|
    |                                   |<-- "Finished" -----------------|
    |<-- POST /stage-complete {4} ------|                                 |
    |                                   |                                 |
    |-- POST /advance {stage: 5} ------>|-- Actuator assembly modal ---->|
    |                                   |<-- "Finished" -----------------|
    |<-- POST /stage-complete {5} ------|   (raises driver assembled)     |
    |                                   |                                 |
    |-- POST /advance {stage: 6} ------>|-- DOF assembly modal --------->|
    |                                   |<-- "Finished" -----------------|
    |<-- POST /stage-complete {6} ------|   (ticket closed)              |
    |                                   |                                 |
```

---

## Setup Checklist for MenteeFlow Team

1. **Generate a shared API key** -- pass it to MenteeBOM admin for configuration
2. **Expose the callback endpoint:** `POST /api/webhook/menteebom/stage-complete`
3. **Validate incoming `X-MenteeBOM-API-Key`** header on the callback endpoint
4. **Implement the "New Process" button** that calls `POST /api/menteeflow/process/create`
5. **Implement stage advancement** -- call `/advance` when MenteeFlow is ready for the next stage
6. **Handle stage callbacks** -- process the `data` payload per stage (unpicked parts, timer triggers, flags)
7. **Implement status polling** as a fallback if callbacks are missed

---

## Error Handling & Resilience

- If MenteeBOM is down when MenteeFlow calls, MenteeFlow should retry with exponential backoff (suggested: 3 retries, 5s / 15s / 45s delays)
- If MenteeFlow is down when MenteeBOM sends a callback, MenteeBOM logs the failure. MenteeFlow can poll `/status` to recover
- Process numbers must be globally unique -- MenteeFlow is responsible for generating unique numbers
- All timestamps are in ISO 8601 UTC format (e.g., `2025-06-15T10:30:00Z`)
