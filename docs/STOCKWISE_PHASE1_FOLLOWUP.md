# StockWise Phase 1 — Follow-up Answers

Companion to `STOCKWISE_INTEGRATION.md`. Answers verified against the actual dev
database (2,606 item records) and API behavior on 2026-07-29.

---

## 1. Development server address

```
http://menteebom.menteebot.local:5000/api/stockwise/v1
```

- `menteebom.menteebot.local` is the domain-registered DNS name of the dev server
  (machine `MENTEEBOM` on the `menteebot.local` AD domain). It stays valid across
  DHCP address changes — do **not** configure the raw IP (currently
  `192.168.31.159`, DHCP-assigned, may change).
- **Network:** the StockWise host must be on the internal office network with
  access to `menteebot.local` DNS. No VPN is needed on-site. If your host sits on
  a separate VLAN, ask IT to allow TCP 5000 toward `MENTEEBOM`.
- **Port 5000:** the dev server listens on `0.0.0.0:5000` (all interfaces), but
  inbound reachability through the Windows Firewall has **not yet been verified
  from another host**. Once you tell us the StockWise hostname we will confirm
  with a live test; from your side,
  `Test-NetConnection menteebom.menteebot.local -Port 5000` (or `nc -zv`) settles
  it in seconds. If blocked, we'll add the inbound rule.
- **HTTPS:** not available on the dev server and not planned for Phase 1 — it is
  plain HTTP on the internal LAN. We acknowledge the key travels in cleartext;
  mitigations today are: dev-only scope (production refuses these routes
  entirely), internal network only, and instant key rotation. TLS will be part of
  the review before any production enablement.

## 2. Development API key

- The key will be generated in MenteeBOM's admin panel and delivered via the
  agreed secure channel — never in email and never in this document.
- **Rotation owner:** Ron Eliezer (rone@menteebot.com), MenteeBOM administrator.
- **Scheduled rotation:** none planned. Rotation happens on demand (suspected
  exposure, personnel change, or your request).
- **Advance notice:** yes — we will coordinate before any planned rotation or
  disabling. Rotation takes effect immediately (the old key dies the moment a new
  one is saved), so StockWise should treat an unexpected `401` as "halt sync and
  alert", not retry-loop.

## 3. Revision and canonical-item behavior — **please read, this corrects assumptions**

Your proposed model ("single active revision = canonical; multiple actives =
integration conflict") **will not work** against real data:

- **A part number is NOT guaranteed at most one `active` record.** Today 298 of
  ~2,600 part numbers have multiple records with `status = "active"`. In practice
  `status` is not maintained as a revision-lifecycle marker at all — 2,604 of
  2,606 records are `active` (1 `obsolete`, 1 `pending`). Do not build canonical
  selection on it, and do **not** record multiple actives as a conflict — it is
  the normal state.
- **Correct canonical rule:** all records of one `part_number` are compatible by
  design (an incompatible change gets a *new part number*, not a new revision).
  The canonical record is simply the **newest one — highest `id`** (record ids
  are assigned in creation order, which follows revision order).
- **Do not order by the `revision` field.** It is free text imported from PDM and
  includes values like `""`, `" "`, `"-"`, `"____"`, `"ANY"`, `"0"`, `"12"`
  (58 records are empty/whitespace). The column is technically non-null but treat
  it as optional display text only.
- **Quantity:** MenteeBOM itself treats stock as a **shared pool per
  part_number** — its UI shows the *sum* of `quantity` across all revision
  records, and when a new revision is created, stock is automatically transferred
  to it (older records zeroed). StockWise should do the same: **sum `quantity`
  over all records of the part number**. Normally the whole pool sits on the
  newest record, but summing is the robust rule.
- **Warehouse Box:** copied forward on revision creation, so all records of a
  part number normally share the same value. Because it is a copy (not a shared
  pointer), an older record *can* hold a stale different value — take the value
  from the **newest record that has one non-null**.
- **All revisions obsolete/pending:** with status barely used this is a
  ~2-records-in-the-database edge case. Same rule applies: canonical = newest
  record; display its `status` as-is.

Summary for your importer: group by `part_number`; canonical record = max `id`;
quantity = sum across the group; warehouse box = newest non-null; keep `revision`
for display only.

## 4. List and synchronization details

### Sample: `GET /items?page_size=2` (real dev-server response, first page)

```json
{
  "has_more": true,
  "next_cursor": "2",
  "page_size": 2,
  "total_count": 2606,
  "items": [
    {
      "id": 1,
      "part_number": "026-AS-00780",
      "revision": "03",
      "part_name": "026-AS-00780.SLDASM",
      "description": "MD - Motor assy without driver",
      "part_type": "Assembly",
      "state": "Released",
      "status": "active",
      "quantity": 0,
      "warehouse_box_number": null,
      "material": "",
      "finish1": "",
      "finish2": "",
      "vendor": null,
      "manufacturer": null,
      "manufacturer_pn": null,
      "created_at": "2025-12-01T12:37:59.728006Z",
      "updated_at": "2026-04-28T11:35:57.421060Z",
      "revision_token": "2026-04-28T11:35:57.421060Z",
      "assemblies": [
        {
          "assembly_part_number": "021-AS-00973",
          "assembly_revision": "REV03",
          "assembly_name": "V3.1 Left Arm",
          "bom_version": "v3",
          "quantity_in_assembly": 1.0
        },
        {
          "assembly_part_number": "021-AS-00991",
          "assembly_revision": "REV04",
          "assembly_name": "V3.1 Right Arm",
          "bom_version": "v3",
          "quantity_in_assembly": 1.0
        }
      ]
    },
    {
      "id": 2,
      "part_number": "ES-00023",
      "revision": "____",
      "part_name": "ES-00023.SLDPRT",
      "description": "King Kong Encoder DPT 15-20-30",
      "part_type": "Electrical OTS",
      "state": "Standard Library",
      "status": "active",
      "quantity": 84,
      "warehouse_box_number": null,
      "material": "Material 1",
      "finish1": "",
      "finish2": "",
      "vendor": "KingKong Technology",
      "manufacturer": null,
      "manufacturer_pn": null,
      "created_at": "2025-12-01T12:37:59.731297Z",
      "updated_at": "2026-05-10T17:38:52.677722Z",
      "revision_token": "2026-05-10T17:38:52.677722Z",
      "assemblies": [
        { "assembly_part_number": "026-AS-00780", "assembly_revision": "REV03", "assembly_name": "MD - Motor assy without driver", "bom_version": "v1", "quantity_in_assembly": 1.0 },
        { "assembly_part_number": "034-AS-01143", "assembly_revision": "REV01", "assembly_name": "MCII Motor Unit Assy", "bom_version": "v4", "quantity_in_assembly": 1.0 }
      ]
    }
  ]
}
```

(Second item's `assemblies` truncated here to two of seven entries. Note the
`"____"` revision and empty-string vs null metadata — both occur in real data.)

### Final page (last record reached)

```json
{ "has_more": false, "next_cursor": null, "page_size": 2, "total_count": 2606, "items": [ "…1 item…" ] }
```

### Cursor pointing past the end

```json
{ "has_more": false, "next_cursor": null, "page_size": 500, "total_count": 2606, "items": [] }
```

### Confirmations

| Question | Answer |
|---|---|
| `cursor` + `updated_since` together | Yes — that is the intended incremental-paging pattern. Both are independent filters and compose. |
| `updated_since` inclusive? | Yes — `updated_at >= updated_since`. |
| Timestamp precision | Microseconds, UTC, `Z` suffix (`2026-05-10T17:38:52.677722Z`). Fractional seconds accepted in `updated_since`. |
| Can records share `updated_at`? | Yes, routinely — bulk imports; one timestamp is currently shared by 247 records. Use inclusive `updated_since` with an overlap window and upsert by `id`. |
| `next_cursor` on final page | Always `null` (also when the final page is exactly full). |
| `has_more = false` ⇒ done? | Yes, authoritative. |
| `total_count` semantics | Count of ALL records matching the filters, independent of cursor position — usable for progress display. |
| Full sync during concurrent edits | Safe. Ordering by `id` is stable; records created mid-sync get higher ids (appear in later pages or the next sync); there is no cross-page snapshot, so an edit mid-sync may or may not be visible — the overlap incremental pass catches it. Reads never block MenteeBOM writes. |
| IDs reserved after hard delete? | **Not formally guaranteed.** (SQLite rowid semantics: a deleted id can be reused only in the narrow case where it was the highest id at deletion time.) Practically stable; your planned full-sync reconciliation fully covers the edge case. |

## 5. Quantity and assembly fields

| Question | Answer |
|---|---|
| Quantity a non-negative integer? | When present it is always an integer (integer column). It may be **`null`** — currently 1,732 of 2,606 records — meaning "never counted", not zero. Remember quantity is per-record; sum across revisions per §3. |
| Negative stock possible? | Stock-withdrawal code paths clamp at 0 and no negative value exists in the data, but it is not schema-enforced — tolerate defensively. |
| `quantity_in_assembly` fractional? | Schema allows decimals; every current value is integral. Treat as decimal. |
| Duplicate assemblies in `assemblies[]`? | No — one entry per assembly, guaranteed. Where an item occurs at several positions inside one BOM (732 real cases), quantities are summed into a single entry. |
| Only active assembly revisions? | Membership reflects only the **latest BOM version** of each assembly with active status. |
| Does assembly removal bump the child's `updated_at`? | **No.** BOM membership changes do not touch the child item record, so incremental sync will not see them. Refresh `assemblies[]` during the full sync (one more reason for the nightly full sync). |

## 6. Phase 2 Warehouse Box write-back (positions, not commitments)

Phase 2 has **no committed timeline** — it will be scheduled after Phase 1 runs
stably and gets internal approval. Current design intent:

| Question | Position |
|---|---|
| Credential | A **separate write-scoped key** is planned; the Phase 1 key stays read-only permanently. |
| Write scope | Strictly `warehouse_box_number`; any other field in the request body rejected. |
| Clearing with `null` | Yes. |
| Obsolete/pending items | To be decided in the Phase 2 review (leaning "allowed" — a box location is a physical fact independent of lifecycle). |
| Idempotency keys | Not planned initially; `revision_token` concurrency already makes retries safe (a replayed request carries a now-stale token → `409`, and setting the same value twice is naturally idempotent). |
| Does `revision_token` change after an update? | Yes — a successful write produces a new token, returned with the response. |
| Audit identity | Writes will be attributed to a `stockwise` integration identity (same pattern as our existing `menteeflow` integration), with timestamp and old/new values. |
| Full updated item in response? | Yes. |
| Location format | Stays free text, max 50 characters (`A-01`, `F-02`, `BP-01` all fine). |

## Your planned test list

All eight tests are supported today. Two notes: for "revision grouping", build it
on §3's rules (max-`id` canonical, summed quantity), not on `status`; for
"missing-record detection", the full-page walk with id reconciliation is exactly
right.
