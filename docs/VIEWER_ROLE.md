# Viewer (read-only) role

`role = 'viewer'` is a view-only account type for integrations and auditors, e.g. the logistics
system's nightly part sync (names, revisions, costs, box numbers) that logs in like a normal user.

What it can do: log in, browse, and call any `GET` endpoint that is open to logged-in users
(`bom_view`, `purchases_view`).

What it cannot do: change anything. `block_viewer_writes()` in `app.py` is a `before_request`
hook that answers **403** to every non-`GET`/`HEAD`/`OPTIONS` request from a viewer, except
`/login` and `/logout`. This is enforced in one place because most routes are guarded by
`@login_required` only, so a per-role permission table cannot make an account read-only on
its own. Role-gated routes (`@require_any_role(...)`) also exclude `viewer`.

Creating one: Admin panel → Users → role "Viewer (read-only)", or `POST /api/admin/users`
with `"role": "viewer"`.

Tests: `python -m pytest tests/test_viewer_role.py` (imports the real `app.py` against a
throwaway SQLite file).

Known gap: a handful of legacy `GET` routes have side effects (e.g. PDM refresh triggers);
they are not blocked by this hook. Convert them to `POST` if a viewer must never trigger them.
