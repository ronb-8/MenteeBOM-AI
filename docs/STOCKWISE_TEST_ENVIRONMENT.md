# StockWise Test Environment

Companion to `STOCKWISE_INTEGRATION.md`. Describes the dedicated snapshot
environment created for StockWise integration testing (2026-08-03).

---

## What it is

A **separate, dedicated test database** — a consistent snapshot of the live
production database — served by its own MenteeBOM instance. It is fully isolated
from both production (which never serves StockWise requests) and from the MenteeBOM
development database (where active development happens and data can be mid-change).

| | |
|---|---|
| Base URL | `http://menteebom.menteebot.local:5001/api/stockwise/v1` |
| Authentication | `X-StockWise-API-Key` header — **a separate test key**, delivered via the secure channel. Your existing dev-environment key does **not** work here (verified), and the test key does not work on the dev environment. |
| Permissions | Read-only. The full StockWise v1 contract: `/ping`, paginated `/items` (cursor + `updated_since`), `/items/{id}`, `/items/by-part-number/{pn}`, `/items/{id}/image` (incl. `format=bw`, `max_size`, ETag/304). |
| Write access | None, structurally: no write endpoint exists in the API — any non-GET returns `405 read_only_api`. Nothing you send can reach production data. (Per your options "disabled / mocked / recorded", it is **disabled**; a mocked Warehouse-Box write will arrive with the Phase 2 contract.) |

## Snapshot contents (current)

Taken **2026-08-03 06:53 UTC** from production. The environment self-reports its
snapshot, so you never have to ask — `GET /ping` returns:

```json
{
  "ok": true,
  "api_version": "1.0",
  "environment": "test",
  "server_time": "2026-08-03T06:54:23.386326Z",
  "snapshot": {
    "snapshot_utc": "2026-08-03T06:53:53Z",
    "source": "menteebom.db (production)",
    "items": 3168,
    "items_with_image": 3149,
    "bom_instances": 275,
    "bom_links": 29902
  }
}
```

That covers everything you listed: all item types (MP, AS, electrical, cables,
fasteners, …), ids/part numbers/revisions/descriptions/types/states/statuses,
quantities and warehouse-box values, the full assembly↔child relationships
(29,902 BOM links across 275 assemblies — 702 `-AS-` items), and PNG images for
3,149 of 3,168 items.

**Environment check:** `environment` in `/ping` tells you which environment you're
talking to (`"test"` vs `"development"`) — assert on it in your test setup so a
misconfigured URL fails fast.

## ⚠ Record ids are per-environment

The test snapshot comes from **production**, while the dev environment you have
been testing against is an older, divergent copy. **Item `id` values are NOT
interchangeable between the two environments.** Ids are stable *within* the test
environment across refreshes only insofar as they are production's ids — treat
each environment as its own id space and never mix cached data across base URLs.

## Refresh method and schedule

- **Method:** a one-command snapshot script on our side
  (`python scripts/refresh_stockwise_testdb.py`) rebuilds the test database from
  production using SQLite's online-backup API (consistent even while production is
  live) and stamps the new `snapshot` metadata that `/ping` reports.
- **Effect of a refresh:** the test dataset is *replaced wholesale*. Ids follow
  production, so records created in production since the last snapshot appear, and
  records deleted from production disappear — a good periodic exercise for your
  missing-record detection.
- **Proposed schedule:** on request (same-day turnaround), plus we suggest a
  routine refresh **every Monday morning**. Tell us if you want a different
  cadence or a freeze during a test campaign — the snapshot never changes on its
  own between refreshes, which also makes it a stable fixture for repeatable tests.

## Readiness

The environment is built and verified (auth isolation, pagination, images,
assembly relationships, write rejection all tested). Two steps remain on our side
before you can connect, which we'll confirm along with the key delivery:

1. Generating the test API key and delivering it via the secure channel.
2. Starting the test instance on port 5001 and confirming that port is reachable
   from your host (same check as before:
   `Test-NetConnection menteebom.menteebot.local -Port 5001`).

Everything else — URL, contract, dataset — is as described above and identical in
behavior to the dev environment you've already integrated against.
