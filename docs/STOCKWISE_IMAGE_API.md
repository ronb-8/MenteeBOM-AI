# StockWise Item Image API

Companion to `STOCKWISE_INTEGRATION.md`. Answers the label-printing questionnaire;
all numbers verified against the dev dataset (2,606 items) on 2026-07-30.

---

## Important expectation-setting first

**MenteeBOM does not have black-and-white outline drawings.** The image associated
with each item is the **CAD preview thumbnail** imported from PDM — a shaded,
full-color render (usually RGBA with transparent background). There is no
line-art/outline asset anywhere in the system.

For the Zebra ZD230 we added an optional server-side conversion
(`?format=bw`) that returns a **1-bit black/white PNG** (Floyd–Steinberg dithered,
transparency flattened to white). That prints acceptably as a small label
illustration, but it is a dithered render, not a crisp outline. If you need true
outline art, that would be new content creation on the engineering side — treat it
as out of scope for now and keep your adapter replaceable, as you planned.

## Endpoint

```
GET /api/stockwise/v1/items/{id}/image
GET /api/stockwise/v1/items/{id}/image?format=bw&max_size=200
```

| Question | Answer |
|---|---|
| Lookup identifier | The **stable record `id`** — same id as the items API. Each item's JSON now includes `has_image` (boolean) and `image_url` (relative URL, `null` when absent), so you never need to guess. |
| Authentication | The existing `X-StockWise-API-Key` read credential — no extra permission. Same dev-only guard as everything else. |
| Response format | **Raw binary `image/png`** (not JSON, not base64). |
| Coverage | 2,576 of 2,606 items currently have an image; 30 do not (`has_image: false`). |

### Query parameters

| Param | Values | Effect |
|---|---|---|
| `format` | `png` (default) \| `bw` | `png` returns the stored image as-is; `bw` returns 1-bit black/white PNG for thermal printing |
| `max_size` | integer 16–1200 | Downscales so the longest edge ≤ this value, aspect preserved; never upscales |

## Example responses

**Success** — `200`, headers:

```
Content-Type: image/png
Content-Length: 18021
ETag: "cf49d31a237e5f0c..."
Cache-Control: private, max-age=86400
<binary PNG body>
```

**Missing image** (item exists, no thumbnail) — `404`:

```json
{ "error": "no_image", "message": "Item 2538 has no image." }
```

**Invalid id** — `404`: `{ "error": "not_found", "message": "No item with id 999999999." }`
**Bad/missing key** — `401`: `{ "error": "invalid_api_key", "message": "Missing or invalid X-StockWise-API-Key header." }`
**Bad parameter** — `400`: `{ "error": "invalid_parameter", "message": "format must be 'png' or 'bw'." }`
**Corrupt stored image** — `500`: `{ "error": "image_processing_failed", "message": "…report the item id…" }` (do not retry-loop a 500 on the same item; skip and report)

Note the error rule: **any non-200 body is JSON**, so check the Content-Type /
status before treating the body as image bytes.

## Image characteristics (measured on the dev dataset)

- **Stored originals:** PNG; typical ~21 KB, observed max ~125 KB. Dimensions vary
  per part — common sizes 947×746, 256×192, up to 1096×827 observed. No fixed
  maximum is guaranteed; if you need a bound, request `max_size` and the response
  is bounded by construction.
- **Color:** mostly RGBA (transparent background), some RGB, a handful of
  grayscale. Assume alpha is possible whenever you process the default format.
- **`format=bw` output:** 1-bit PNG, white background, dithered; dramatically
  smaller (a 256×192 sample: 18 KB original → 1.7 KB bw, → ~1 KB at
  `max_size=200`).

## Revisions and grouped part numbers

Images are stored **per record** (per part_number + revision), and revisions can
have different images. For your grouped StockWise item, follow the same canonical
rule as the rest of the data (`STOCKWISE_PHASE1_FOLLOWUP.md` §3): use the image of
the **newest record (highest `id`) with `has_image: true`** within the
part_number group.

## Caching and invalidation

- **ETag** is the mechanism. Every response carries a strong `ETag` (content
  hash); send `If-None-Match` and you get `304 Not Modified` with an empty body
  when unchanged. Each parameter variant (`format`, `max_size`) has its own ETag.
- **You may cache images internally** for previews and label printing — confirmed.
  Recommended pattern: cache by `(item id, params) → (etag, bytes)` and revalidate
  with `If-None-Match` when you print or during your nightly full sync.
- **Incremental sync does NOT reliably signal image changes.** An image refresh
  usually accompanies a data update (which bumps `updated_at`), but the image file
  can be overwritten without the item row changing, so do not rely on
  `updated_since` for image freshness — that is what the cheap `304` revalidation
  is for. Images change rarely (on PDM re-import of a part).

## Limits, timeouts, retries

- Same informal guidance as the data API: stay under ~5 requests/second sustained;
  no enforced rate limiting or throttling headers today.
- Responses are typically well under 1 s (the `bw` conversion adds milliseconds).
  A 30 s client timeout is generous.
- GETs are idempotent — **retries are safe**, exponential backoff from ~1 s for
  network errors; do not retry 4xx, and treat per-item `500` as skip-and-report.
- For a bulk warm-up of all ~2,600 images, please run it sequentially or at your
  sync cadence rather than fully parallel.

## Testing

Confirmed: the development dataset and your existing development API key may be
used for all image-integration testing, including bulk fetches and cache
revalidation tests. Items with `has_image: false` (30 exist today) and the
missing-image `404` path are present in real data, so you can test those without
mocks.
