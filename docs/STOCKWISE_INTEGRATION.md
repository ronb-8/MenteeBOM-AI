# MenteeBOM ↔ StockWise Integration Guide

**API version:** v1.0 · **Status: Phase 1 — read-only, development environment only**

This document answers the StockWise team's integration questionnaire. The current
integration surface is deliberately minimal: a read-only REST API over the MenteeBOM
parts library, served **only by the development server against the development
database**. Write access (Warehouse Box updates) is a planned Phase 2 and is **not
yet enabled** — see §5.

---

## 1. API documentation and environments

| | |
|---|---|
| Base URL (development) | `http://menteebom.menteebot.local:5000/api/stockwise/v1` (stable domain DNS name — do not configure by IP, the server's address is DHCP-assigned) |
| Base URL (production) | **Not available.** Production refuses all StockWise routes with HTTP 403 regardless of credentials. |
| Versioning | URL-path versioned (`/v1`). Breaking changes will ship as `/v2`; `/v1` will keep working during a migration window agreed with your team. |
| OpenAPI/Postman | Not yet published; this document is the reference. Endpoints are few enough to hand-write a Postman collection from §3. |
| Sandbox | Two non-production environments: the dev server (port 5000) and a dedicated production-snapshot **test environment** on port 5001 with its own API key — see `STOCKWISE_TEST_ENVIRONMENT.md`. Production itself never serves StockWise routes. |

## 2. Authentication and permissions

- **Method:** static API key in the `X-StockWise-API-Key` request header, over the
  internal network. There is no OAuth/token expiry — the key is valid until rotated.
- **Provisioning:** a MenteeBOM admin generates and saves the key in
  **Admin → StockWise API** (generate / copy / rotate / disable). Delivery to
  StockWise happens through the agreed secure channel, not email.
- **Rotation:** set a new key on the server; the old key stops working immediately.
  Coordinate rotation windows with the MenteeBOM team.
- **Network restrictions:** the dev server listens on the internal LAN only. No
  additional IP allow-listing is currently enforced.
- **Scope / least privilege:** the key grants **read-only** access. This is enforced
  structurally, not just by policy:
  - Only `GET` endpoints exist; any other HTTP method returns `405 read_only_api`.
  - The blueprint serving this API contains no code path that writes to the database.
  - The production server rejects every StockWise route with `403 stockwise_disabled`.
- **Warehouse-Box-only write scope:** the same key also authorizes the single
  Warehouse Box PATCH endpoint, but only while a server-side admin toggle is on
  (per environment, default off) — see `STOCKWISE_WRITE_API.md`. Quantities and
  engineering data remain unwritable through this API permanently.

## 3. Item read API

### Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /ping` | Authenticated health check |
| `GET /items` | Paginated / filtered item list |
| `GET /items/{id}` | Single item by stable record id |
| `GET /items/by-part-number/{part_number}` | All revisions of an exact part number |
| `GET /items/{id}/image` | Item image as raw `image/png` (optional `?format=bw&max_size=N` for label printing) — see `STOCKWISE_IMAGE_API.md` |

### Field mapping

Identifiers like `MB10-MP-10001` live in `part_number`. Note that MenteeBOM stores
**one record per (part_number, revision)** — the same engineering item can appear as
several records across revisions, and multiple records of one part number are
routinely `active` at once (`status` is not a revision-lifecycle marker). If
StockWise treats `part_number` alone as the unique item: group by `part_number`,
take the **newest record (highest `id`)** as canonical, **sum `quantity`** across
the group (stock is a shared pool per part number), and take the warehouse box from
the newest record that has one. Do not sort by the `revision` field — it is free
text. See `STOCKWISE_PHASE1_FOLLOWUP.md` §3 for the full rules.

| StockWise requirement | Field | Notes |
|---|---|---|
| Stable external record ID | `id` | integer, never reused |
| Item number | `part_number` | e.g. `MB10-MP-10001` |
| Description | `description`, also `part_name` | |
| Quantity | `quantity` | current stock count; **read-only** |
| Assembly membership | `assemblies[]` | parent assemblies (`…-AS-…`) from the latest active BOM of each assembly, with `quantity_in_assembly`. Note: these are assembly **part numbers**, not per-unit serial numbers — MenteeBOM tracks manufacturing serials in a separate subsystem not exposed here. |
| Engineering state | `state` | PDM lifecycle state (free text from PDM) |
| Active/inactive/deleted | `status` | `active` / `obsolete` / `pending`. Deleted records are **hard-deleted** — see §4 tombstones. |
| Warehouse Box | `warehouse_box_number` | string, max 50 chars, nullable |
| Size / searchable metadata | `material`, `finish1`, `finish2`, `part_type`, `vendor`, `manufacturer`, `manufacturer_pn` | there is no dedicated "size" field; dimensional info, where present, is in `description` |
| Timestamps | `created_at`, `updated_at` | ISO-8601 UTC (`Z` suffix) |
| Concurrency token | `revision_token` | currently equals `updated_at`; treat as opaque |
| Image | `has_image`, `image_url` | CAD preview thumbnail (shaded render, not an outline); fetch via the image endpoint, cache with ETag |

### Example — normal active item

```json
GET /api/stockwise/v1/items/4211

{
  "item": {
    "id": 4211,
    "part_number": "MB10-MP-10001",
    "revision": "02",
    "part_name": "Bracket, elbow pitch",
    "description": "Machined bracket, AL6061, anodized",
    "part_type": "Mechanical part",
    "state": "Released",
    "status": "active",
    "quantity": 34,
    "warehouse_box_number": "A-01",
    "material": "AL6061-T6",
    "finish1": "Anodize black",
    "finish2": null,
    "vendor": "Acme Machining",
    "manufacturer": null,
    "manufacturer_pn": null,
    "created_at": "2025-11-02T09:14:33Z",
    "updated_at": "2026-07-12T06:40:01Z",
    "revision_token": "2026-07-12T06:40:01Z",
    "assemblies": [
      {
        "assembly_part_number": "MB10-AS-20004",
        "assembly_revision": "03",
        "assembly_name": "Elbow assembly",
        "bom_version": "v3",
        "quantity_in_assembly": 2.0
      },
      {
        "assembly_part_number": "MB10-AS-20011",
        "assembly_revision": "01",
        "assembly_name": "Arm, left",
        "bom_version": "v1",
        "quantity_in_assembly": 2.0
      }
    ]
  }
}
```

Variants you asked about:

- **Inactive item:** identical shape, `"status": "obsolete"` (or `"pending"`).
- **Item in multiple assemblies:** `assemblies` has multiple entries (as above).
- **No Warehouse Box:** `"warehouse_box_number": null`.
- **Deleted/archived record:** not returned at all — deletion is physical (404 on
  the id; absent from lists). See §4.
- **Missing optional fields:** returned as JSON `null` (never omitted), as with
  `finish2` / `manufacturer` above. `quantity` may be `null` for items whose stock
  was never counted — treat as "unknown", not zero.

## 4. Pagination and synchronization

- **Method:** cursor-based. Each `GET /items` page returns `next_cursor`; pass it
  back as `?cursor=`. Treat the cursor as opaque.
- **Page size:** `page_size` param, default 100, max 500.
- **Ordering:** by record id ascending — stable across pages and repeat syncs.
- **Cursor expiration:** cursors do not expire (they encode a position, not server
  state). A cursor from an old sync is safe to resume.
- **Incremental sync:** `?updated_since=2026-07-29T00:00:00Z` (inclusive) returns
  items created or modified at/after that instant. Recommended loop: remember the
  max `updated_at` you have seen, and query with `updated_since` = that value minus
  a small overlap (e.g. 5 minutes); upsert by `id`. Caveat: BOM membership changes
  do **not** bump an item's `updated_at`, so `assemblies[]` is only reliably
  refreshed by the full sync.
- **Tombstones:** none — deleted parts are physically removed and simply stop
  appearing. To detect deletions, run a periodic **full sync** (walk all pages with
  no filter) and remove local records whose ids were not seen. Obsolete
  (`status != "active"`) records DO remain available and are returned normally, so
  most "retired" items surface as status changes rather than disappearances.
- **Response envelope:** `items`, `page_size`, `total_count` (for the current
  filter), `has_more`, `next_cursor`.
- **Volume / frequency:** the parts library is on the order of thousands of records
  (well under 100k). A full sync is a handful of pages. Suggested cadence:
  incremental every 5–15 minutes, full sync nightly.
- **Rate limits:** none enforced and no throttling headers today. Please stay under
  ~5 requests/second sustained; if we add limiting later it will use standard `429`
  + `Retry-After` and we will notify you before rollout.

## 5. Warehouse Box update API

Implemented — see **`STOCKWISE_WRITE_API.md`** for the full contract:
`PATCH /items/{id}/warehouse-box`, same key as reads (gated by a per-environment
admin toggle), required `If-Match` (revision_token), value-based idempotency,
`null` to clear, free text ≤ 50 chars, full audit trail. Currently **enabled on
the test environment (port 5001) only**; the dev environment stays read-only and
production is not served at all.

## 6. Errors and reliability

All errors are JSON: `{"error": "<machine_code>", "message": "<human text>"}`.

| HTTP | `error` code | Meaning |
|---|---|---|
| 401 | `invalid_api_key` | Missing/wrong `X-StockWise-API-Key` header |
| 403 | `stockwise_disabled` | You reached a server where the integration is off (e.g. production) — do not retry |
| 404 | `not_found` | Unknown item id / part number |
| 400 | `invalid_parameter`, `invalid_cursor` | Bad query parameter; message says which |
| 405 | `read_only_api` | Non-GET request |
| 503 | `not_configured` | Server has no StockWise key configured — contact us |

- **Retries:** GETs are safe to retry. Use exponential backoff starting at ~1 s for
  5xx and network errors; do not retry 4xx except after fixing the request.
- **Timeouts:** requests normally complete in well under 2 s; a 30 s client timeout
  is generous.
- **Escalation:** contact the MenteeBOM maintainer (rone@menteebot.com) for
  credentials, failures, or schema questions.

## 7. Testing approval

Confirmed, with the dev-only scope described above:

- ✅ Development API credentials (via secure channel).
- ✅ Read access to the full dev dataset (a copy of production — please treat it as
  internal-confidential even though it is a test copy).
- ✅ Full and incremental synchronization tests — the dev DB is disposable; sync as
  hard as you like within the informal rate guidance in §4.
- ⏳ Warehouse Box update permission and a writable test item — **deferred to
  Phase 2**; nothing is writable today.

---

## Appendix: enabling the API (MenteeBOM side)

1. In the MenteeBOM web app (dev server), go to **Admin → StockWise API**, click the
   key-generate button, then **Save Key**. The same page shows/copies the current
   key, rotates it (save a new one), and disables the integration.
2. The key is stored in `instance/stockwise_api_key` (not in the database and not
   in `.env`, which is tracked in git). The `STOCKWISE_API_KEY` environment
   variable, if set, overrides the saved key — the admin page warns when that is
   the case.
3. Verify: `curl -H "X-StockWise-API-Key: <key>" http://localhost:5000/api/stockwise/v1/ping`.
4. The production server needs no configuration: it refuses StockWise routes by
   design (the guard checks the connected database, not an env flag).
