# Doctavian sample data files

Both files here were provided by Kanwal Roshi (Doctavian/Maven Engineering
Manager) on 2026-08-25, in her reply that identified the real root cause
of the `TEMPLATE_READ_FAILED` error that blocked Phase 2 for several
sessions. See `PROJECT_STATUS.md`'s Phase 2 section for the full timeline.

## The actual bug

Every `data.upload` call this project made before 2026-08-25 uploaded a
**bare** `{}` as the data file's JSON content. Doctavian's document
generation engine requires the uploaded data file's JSON to wrap its
contents in a top-level `"data"` key — even if that key's value is
itself empty:

```json
{ "data": {} }
```

A bare `{}` (no wrapper key) is what actually caused
`TEMPLATE_READ_FAILED` — Doctavian's own team has acknowledged the error
message is misleading, since the failure has nothing to do with the
template file itself.

## The files

- **`data-simple.json`** — the minimal fix: just the required `"data"`
  wrapper key with nothing inside it. This is what
  `scripts/verify_doctavian_template.py` now uploads (see that script
  for the corrected `json.dump({"data": {}}, tmp)` call).
- **`mission-1-data.json`** — a more elaborate example straight from
  Doctavian's own "Mission 1" quickstart materials, showing a real
  nested data structure (`Customer` → `LineItems`) under the same
  `"data"` wrapper key. Kept here for future reference in case Tegata
  ever needs to pass richer structured data into a template (Tegata's
  current templates only need flat `TemplateVariable` merge fields, so
  this shape isn't required yet — but it documents what's possible if a
  future template needs nested/repeating data, e.g. a Phase 7 "dual-
  audience document" stretch feature).

## Status as of 2026-08-25

Fix applied to `scripts/verify_doctavian_template.py` (now uploads
`{"data": {}}` instead of `{}`) — **not yet re-run against the real
Doctavian API** (Claude's own sandbox cannot reach
`demo.api.doctavian.com`; this must be verified by running the script
locally with a fresh `DOCTAVIAN_ACCESS_TOKEN`). Once confirmed working,
update `PROJECT_STATUS.md`'s Phase 2 section to mark this fully
resolved and remove the "unverified assumption" caveat.

Also worth noting: Kanwal reproduced the failure using our **unmodified**
real template (`template_builder.py`'s native Word `IF` merge field,
untouched) and only changed the data file — meaning the native-Word-
field approach was correct all along. `scripts/smoke_test_expression_syntax.py`'s
plain-text-placeholder hypothesis is now superseded and should not be
acted on.
