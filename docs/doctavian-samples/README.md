# Doctavian reference materials

Everything in this folder was provided by Kanwal Roshi (Doctavian/Maven
Engineering Manager) across two rounds of investigation into
`TEMPLATE_READ_FAILED` and the follow-up conditional-syntax question.
See `PROJECT_STATUS.md`'s Phase 2 section for the full timeline —
this README just summarizes the final, confirmed answer.

## The final answer (2026-08-26)

Doctavian's document generation engine does **not** evaluate native
Word MERGEFIELD/IF field codes at all — confirmed conclusively both by
direct API testing (real documents generated with real data still came
back with every field blank and IF logic unevaluated) and by Kanwal
directly ("that's expected behavior, not a bug"). Instead, Doctavian
reads its own plain-text templating language straight out of ordinary
paragraph text:

- **Merge fields:** `{!fieldname}` — substituted from the uploaded data
  file's top-level `"data"` object.
- **Expressions** (anything beyond a bare field — comparisons,
  functions, ternaries): `{!$expression}`, built on
  [Jexl](https://github.com/TomFrost/Jexl). No `IF()`/`IIF()` function
  exists — use Jexl's native ternary: `{!$x == "2" ? "A" : "B"}`.
- **Conditional blocks** (Tegata's actual use case — swapping an entire
  sentence, not just a word): the `mdoc:paragraph` element, with a
  `hidden` attribute holding an expression. Two `mdoc:paragraph` blocks,
  each hidden under the opposite condition, implement an if/else. See
  `template_builder.py`'s module docstring for Tegata's exact
  implementation of this.

This is fully implemented in `apps/agent/src/tegata_agent/template_builder.py`
as of 2026-08-26 (a complete rewrite from the earlier native-Word-field
version).

## Files in this folder

- **`data-simple.json`** — Kanwal's minimal fix for `TEMPLATE_READ_FAILED`:
  just the required `"data"` wrapper key with nothing inside it. A bare
  `{}` (no wrapper key) is what actually caused the error — Doctavian's
  team has acknowledged the error message is misleading, since the
  failure has nothing to do with the template file itself.
- **`mission-1-data.json`** — a real, richer example data payload from
  Doctavian's own "Mission 1" quickstart materials (nested
  `Customer` → `LineItems` structure), for reference if Tegata ever
  needs nested/repeating data (e.g. a Phase 7 "dual-audience document"
  stretch feature).
- **`mission-1-agreement.docx`** — the actual real template Doctavian's
  Mission 1 quickstart uses, showing the confirmed syntax in a working
  example: plain-text `{!Customer.Name}` merge fields, an
  `mdoc:repeater` for the line-items table, and an `mdoc:paragraph`
  block (`hidden="{!$toDecimal(sum(Customer.LineItems, "LineAmount")) < 10000}"`)
  implementing a volume-discount clause — the same pattern Tegata's
  approval clause now uses. Notably, the **closing tag repeats the
  `name` attribute** (`</mdoc:paragraph name="exc10000">`, not just
  `</mdoc:paragraph>`) — not standard XML, but Doctavian's own
  convention, matched exactly in `template_builder.py`.
- **`Elements_Reference.pdf`** — official docs for every templating
  element (`mdoc:paragraph`, `mdoc:repeater`, `mdoc:table`,
  `mdoc:image`, `mdoc:text`, `mdoc:link`, and more), their parameters,
  and per-format support (DOCX/XLSX/PPTX/Google Docs/Sheets/Slides).
- **`Expressions_Reference.pdf`** — official docs for the full Jexl-based
  expression language: array/string/number/date functions, comparison
  operators, and the native ternary. This is the page that was
  previously JS-rendered and unreadable from Claude's sandbox; Kanwal
  sent a PDF export instead.

## Investigation history (for context)

1. **`TEMPLATE_READ_FAILED`** — root cause: the uploaded data file's
   JSON needs a top-level `"data"` wrapper key, even if empty
   (`{"data": {}}`, not a bare `{}`). Fixed 2026-08-25.
2. **Native Word field codes silently not evaluated** — even with a
   correctly-wrapped, fully-populated data file, native Word
   MERGEFIELD/IF field codes never rendered real values. Confirmed via
   two real API test runs (2026-08-26) before Kanwal's reply arrived.
3. **7 candidate conditional syntaxes tried and failed** (2026-08-26,
   `scripts/smoke_test_conditional_syntax.py`) before escalating — see
   that script's docstring for the specific candidates and why they
   were informative failures (they proved `{!...}` genuinely attempts
   expression evaluation, just not with the function names/operators
   guessed).
4. **Kanwal's reply** confirmed the plain-text `{!fieldname}` mechanism,
   explained native Word fields are correctly never processed, and gave
   the actual conditional syntax (Jexl ternary + `mdoc:paragraph` for
   block-level conditionals), plus the reference files above.
