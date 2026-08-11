# Numeric-Range Select Chunking — Design

> Extends `docs/superpowers/specs/2026-08-11-numeric-range-dropdown-options-design.md`. Requested directly by the project owner, scoped down from an initial "raise the option cap to 100" ask after establishing Discord's real constraints: this applies **only** to `single_select` questions whose option list is a numeric range — not to hand-typed literal option lists, and not to `multi_select`.

## Goal

`/config question add options:1980-2026` today expands to 47 options and is rejected by the existing 25-option cap — a real Discord select-menu limit. This lets a `single_select` question whose options form a numeric sequence (produced by the range shorthand from the previous plan, or coincidentally typed the same way) render as **multiple stacked dropdowns** instead of one, raising the effective cap to 100.

## Why 100, and why chunks of 25

Not an arbitrary number: Discord messages allow at most 5 component rows, and a select menu maxes out at 25 options. An optional question needs one row reserved for its Skip button, leaving 4 rows × 25 options = **100** — the actual ceiling this platform allows. This is why the design targets exactly 100, not a round number chosen for convenience.

## Scope boundary: what counts as "a numeric range"

Rather than tracking *where* an option list came from (typed by hand vs. expanded from the `1980-2026` shorthand — indistinguishable by the time `parseOptionsInput` returns, and not worth threading extra metadata through the pipeline to preserve), this looks at *what the option list actually is*: a set of labels that are all digits-only and form a contiguous run with a constant step of `+1` or `-1` (`isNumericRangeLabelSet`, new in `src/db/questionnaire-repository.ts`). A hand-typed `1,2,3,4,5` is indistinguishable from — and gets the identical treatment as — the shorthand `1-5`; this is a deliberate simplification, not an oversight, since the two are semantically identical once expanded.

This check gates two things, both only for `type: 'single_select'`:

1. **The cap.** `addQuestion`/`editQuestion` allow up to 100 options when `type === 'single_select'` and the option list is a numeric range; every other case (any `multi_select`, or a `single_select` with non-range labels) keeps the existing 25-option cap unchanged.
2. **Nothing else, structurally.** The cap enforcement is the only place that needs to know "is this a range." Rendering does not — see below.

## Rendering: chunking is unconditional for single_select, not range-gated

`buildQuestionSelectRow` (component builder) is renamed `buildQuestionSelectRows` and returns an array of rows instead of one. For `type: 'single_select'`, it splits `question.options` into groups of ≤25 and emits one `StringSelectMenuBuilder` row per group — this chunking logic runs unconditionally for every `single_select` question, not only ones flagged as a range. It doesn't need to be range-gated: a non-range `single_select` is already capped at 25 by the repository layer (constraint above), so chunking such a question always produces exactly one group — an identical no-op to today's single-row behavior. Only a `single_select` question that actually has more than 25 options (which, per the cap rule, can only be a numeric range) ever produces more than one row. `multi_select` is untouched — it keeps building exactly one row, exactly as it does today, regardless of option count.

Every chunk shares the **same** custom ID (`CUSTOM_IDS.questionSelect(question.id)`) — Discord does not require component custom IDs to be unique within one message, and reusing it means `interaction-create.ts`'s existing `question-select:` routing needs no changes at all: whichever dropdown the member picks from fires the identical interaction shape as today, and the handler doesn't need to know or care which chunk it came from.

**Selection semantics across chunks:** picking a value in *any one* chunk's dropdown is the complete, final answer — the message's components clear and the flow advances, identical to today's single-select behavior. The other, unused chunks are simply discarded along with the message update; there is no cross-chunk combining logic to build. This only works because `single_select` — unlike `multi_select` — needs exactly one value, so "whichever dropdown fires first wins" is a complete, correct answer, not a partial one.

**Required vs. optional across multiple chunks:** a single chunk can't be required to be used specifically — the member might pick from any of the (up to 4) dropdowns. So when a question renders as more than one chunk, every chunk's `minValues` is `0` regardless of `required` (forcing `minValues: 1` on every chunk would make the question unsatisfiable, since nothing requires *all* chunks to be used). "Required" continues to be enforced the same way it already is for every select-type question — no Skip button is rendered — so the member has no way to advance without picking something from one of the dropdowns. The single-chunk case (≤25 options, the overwhelming majority of questions) keeps its exact current `minValues` behavior unchanged.

**Placeholders:** a chunked question's dropdowns show their sub-range in the placeholder (e.g. "Pick your answer (1980–2005)" / "Pick your answer (2006–2026)") so a member can tell them apart. The single-chunk case keeps today's plain "Pick your answer" text.

`src/discord/commands/intro.ts`'s `promptNextQuestion` spreads the returned array into the message's `components` (alongside the optional Skip row) instead of passing a single row.

## Error handling

No new error type. An option list still over the applicable cap (100 for a range, 25 otherwise) surfaces through the existing `too-many-options` error path with its existing message — unchanged from before this feature.

## Testing

- `isNumericRangeLabelSet`: ascending, descending, non-numeric entries, non-contiguous entries, fewer than 2 labels.
- `addQuestion`/`editQuestion`: a numeric range up to 100 options succeeds for `single_select`; 101 is still rejected; a non-range `single_select` list over 25 is still rejected (cap doesn't leak); a numeric-sequential `multi_select` list over 25 is still rejected (scope doesn't leak to the other type).
- `buildQuestionSelectRows`: single row for ≤25 options (existing coverage, adjusted for the array-returning signature); multiple rows for a >25-option `single_select` question, with correct per-row `maxValues`/`minValues` and differentiated placeholders; `multi_select` always produces exactly one row regardless of option count.

## Out of scope

- `multi_select` chunking (picking several values across separate dropdowns) — a materially harder problem (partial selections across independent interactions, needing an explicit submit step) that wasn't requested and isn't built.
- Any change to `/config question list`'s embed rendering of long option lists — a 100-option question's comma-joined label list is still well within Discord's embed limits for a single question; a guild with many maxed-out range questions simultaneously could theoretically approach the embed description limit, but this is a pre-existing, unlikely-in-practice edge case this feature doesn't make meaningfully worse and isn't addressed here.
- Any schema or migration change — `isNumericRangeLabelSet` is computed from existing stored data, not persisted as its own flag.
