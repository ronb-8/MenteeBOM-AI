# StockWise Warehouse Box Write API — Final Contract

Companion to `STOCKWISE_INTEGRATION.md`. Verified against the test environment on
2026-08-06.

## Status

**Credential model (simplified 2026-08-10):** there is now **one API key per
environment**, used for both reads and writes — **the key you already use for
reads is your write credential**. No separate write key exists anymore; set
`MENTEEBOM_WRITE_API_TOKEN` to the same value as `MENTEEBOM_API_TOKEN` and you
are done. Whether that key may write is controlled by a server-side admin
toggle, so write capability remains a deliberate MenteeBOM decision.

| Environment | Warehouse Box writes |
|---|---|
| **Test** (`http://menteebom.menteebot.local:5001`) | **ENABLED** — your existing read token writes |
| Development (port 5000) | Disabled (`403 writes_disabled`) |
| Production | Out of scope entirely — the StockWise API does not serve production at all. Enabling production (reads or writes) is a separate future review, including transport security. Please treat production write-back as **not scheduled**. |

## Endpoint (your proposed shape, accepted with one addition)

```
PATCH /api/stockwise/v1/items/{id}/warehouse-box
X-StockWise-API-Key: <write-scoped-key>
If-Match: <current-revision-token>          ← REQUIRED (428 if missing)
Idempotency-Key: <unique-stable-request-id> ← optional, recorded in the audit log
Content-Type: application/json

{ "warehouse_box_number": "F-001" }
```

Clearing: `{ "warehouse_box_number": null }` — exactly as you proposed.

## Approval model — none required

**MenteeBOM does not require any approval for Warehouse Box changes.** A request
with a valid write-scoped key and a current `If-Match` token is applied
**immediately** — there is no review queue, no pending state, and no
approval-workflow API to integrate with. This is deliberate:

- The bin location is operational warehouse data, not engineering data. StockWise
  (with its own authorized-user step) is the authority for bin assignments;
  MenteeBOM just stores the result.
- Every change is fully audited (actor, old → new, timestamp, idempotency key)
  and trivially reversible by another write.
- The `If-Match` / `428 precondition_required` mechanism is **concurrency
  protection only** (it prevents overwriting a concurrent edit) — it is not an
  approval gate, and no human action is ever needed to satisfy it.

If your side needs a sign-off step, keep it inside StockWise before the request
is sent — from MenteeBOM's perspective the PATCH itself is the final word.

## Authorization scope

- One key per environment authorizes reads and — only while the server-side
  admin toggle is on — this single PATCH endpoint. Every other method/route
  remains `405 read_only_api` regardless of the toggle.
- The endpoint can change **only** `warehouse_box_number`. Any other field in the
  body — quantities, descriptions, revisions, anything — is rejected with
  `400 field_not_writable` before anything is touched. Part numbers, BOM
  relationships, images, and engineering data have no write path at all.
- Keys are per-environment: the test key works only on port 5001, the dev key
  only on port 5000.
- With the toggle off, writes return `403 writes_disabled` while reads continue
  to work unchanged.

## Concurrency (If-Match) and idempotency

- **`If-Match` is required** and must equal the item's current `revision_token`
  (from any read response). This forces read-before-write, which matches your
  queue design.
  - Missing → `428 precondition_required`.
  - Stale → `409 conflict`, and the response body includes the **current full
    item** so you can re-check without an extra read.
- **Idempotency is structural**: if the item already holds the requested value,
  the request returns `200` with `"applied": "no_change"` — *regardless of the
  If-Match token*. A queued retry of an already-applied request therefore
  succeeds cleanly even though the original write changed the token. Verified:
  update → retry with the old token → `no_change`.
- `Idempotency-Key` is accepted and written into the audit record for
  traceability; it is not used for dedup (the value-based no-op above already
  guarantees safe retries).
- A successful write returns a **new `revision_token`** — chain it if you send
  consecutive updates to the same item.

## Validation rules

| Rule | Response |
|---|---|
| Value must be a JSON string or `null` | `400 invalid_value` |
| Trimmed; max **50 characters** (free text — `A-01`, `F-02`, `BP-01` all valid) | `400 invalid_value` if longer |
| Empty string rejected — clearing is `null` only | `400 invalid_value` |
| Only `warehouse_box_number` in the body | `400 field_not_writable` listing the rejected fields |
| Item must exist | `404 not_found` |
| Obsolete/pending items | **Writes allowed** — a bin location is a physical fact independent of lifecycle (as previously proposed) |

## Responses

**Success (200):**

```json
{
  "applied": "updated",
  "audit": { "actor": "stockwise", "old_value": null, "new_value": "F-001", "at": "2026-08-06T07:28:31.109310Z" },
  "item": { "...": "complete item, including the NEW revision_token" }
}
```

`"applied"` is `"updated"` or `"no_change"`. The complete updated item is always
included, as you requested.

**Errors** (same JSON schema as the read API):

| HTTP | `error` | Meaning / action |
|---|---|---|
| 400 | `invalid_request`, `invalid_value`, `field_not_writable` | Fix the request; do not retry as-is |
| 401 | `invalid_api_key` | Wrong key, or the read key used for a write |
| 403 | `writes_disabled` | This server has no write credential (e.g. dev/prod) — do not retry |
| 404 | `not_found` | Unknown item id |
| 409 | `conflict` | Stale `If-Match`; body carries the current item — re-read/re-verify, then retry with the fresh token. If the current value already equals your target, treat as applied. |
| 428 | `precondition_required` | `If-Match` header missing |

**Retry guidance:** the endpoint is retry-safe by construction. Network
errors/timeouts: retry with the same request (worst case you get `no_change` or a
`409` telling you the world moved). Never retry 4xx other than `409`.

## Audit

Every applied change is recorded in MenteeBOM's action log with actor
`stockwise` (integration role), item id, part number + revision, old → new
value, timestamp, and your `Idempotency-Key` if provided. The write also bumps
the item's `updated_at`, which means **your own writes will appear in your next
incremental sync** — expected; don't classify them as external changes.

## Rate limits

Same as the read API: nothing enforced today, stay under ~5 sustained
requests/second. Your queue-based, user-triggered design is well within this.

## Write-credential resolution (2026-08-10)

The earlier 31 authentication rejections were caused by a write-key delivery
mismatch. That whole failure mode is now gone: **the separate write key has been
retired**. Use your existing, already-working read token for writes too:

```
MENTEEBOM_WRITE_API_TOKEN = <same value as MENTEEBOM_API_TOKEN>
```

Formal confirmations, verified live against the port-5001 instance:

1. Your read token (64 chars, SHA-256 fingerprint prefix `762ad523897a`) is
   accepted on `PATCH …/warehouse-box` — writes are enabled on the test
   environment.
2. **Header:** `X-StockWise-API-Key: <key>` with **no scheme prefix** — no
   `Bearer`, no quotes. `MENTEEBOM_WRITE_AUTH_SCHEME=` (empty) is correct.
3. The PATCH is the only writable route; the key changes
   `warehouse_box_number` on existing snapshot items (including
   obsolete/pending) and **nothing else, ever**.
4. **No IP/hostname/allow-list rules exist** on the MenteeBOM side — a `401` is
   always a key-value mismatch, never a network or permission rule.
5. **Successful PATCH response** contains `"applied"` (`"updated"`/`"no_change"`),
   an `audit` block, and the complete updated `item` with its **new
   `revision_token`**.

### `GET /auth-check` — credential diagnostic

Unauthenticated diagnostic endpoint. Send it whatever token your client is
configured with:

```
GET /api/stockwise/v1/auth-check
X-StockWise-API-Key: <the token you intend to use>

{ "environment": "test", "key_received": true, "key_length": 64,
  "key_sha256_prefix": "762ad523897a", "matches": "read+write",
  "writes_enabled": true }
```

- `matches` is `"read+write"` when the token is valid and writes are enabled,
  `"read"` when valid but writes are off, `"none"` otherwise. Before requeueing,
  check it returns `"read+write"` for the token in your write slot.
- `key_length` / `key_sha256_prefix` describe the value **actually received**,
  so truncation, added whitespace, or quotes are immediately visible (a trailing
  space shows as length + 1). The endpoint never returns key material.

## Readiness

No credential delivery is pending — your existing read token is the write
credential, and writes are enabled on port 5001. The snapshot database is
disposable — assign, move, swap, and clear bins freely; a snapshot refresh
resets everything. `GET /ping` still tells you which environment you are on;
assert `"environment": "test"` before enabling your write path, and
`/auth-check` should report `"matches": "read+write"`. Then requeue the 31
pending updates.
