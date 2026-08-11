# Numeric-Range Dropdown Options — Design

> Extends `docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md`'s `options` parameter. Requested directly by the project owner: entering many sequential numeric choices (e.g. a decade of years) by hand, comma by comma, is tedious — a shorthand range should expand into individual options automatically.

## Goal

Today `/config question add`/`edit`'s `options` parameter only accepts literal, comma-separated labels (`parseOptionsInput` in `src/discord/commands/config-question.ts`). This adds a numeric-range shorthand: a comma segment matching `N-M` (e.g. `1988-2026`) expands into individual numeric options, one per integer in the inclusive range, instead of the admin typing each one out.

## Platform constraint (unchanged, still binding)

Discord select menus cap at 25 options — a hard platform limit established in the configurable-questionnaire spec. This feature is a convenience for entering a range that already fits under that cap (a decade, a rating scale, a handful of recent years) — it does not, and cannot, lift the cap. A range that expands past 25 options hits the exact same `too-many-options` rejection as if every value had been typed by hand. This is the correct guardrail, not a limitation to design around.

## Syntax

A comma-separated segment matches the range shorthand when, after trimming, it looks like `<digits> - <digits>` with optional whitespace around the dash (`1988-2026`, `1988 - 2026`, `10-5`). Both endpoints are inclusive. Direction is inferred from the order written:

- `1988-2026` → ascending, expands to `1988, 1989, …, 2026` (39 values — rejected by the existing 25-option cap unless narrowed, e.g. `2017-2026`)
- `10-1` → descending, expands to `10, 9, …, 1`
- `5-5` → collapses to the single value `5`

A segment that doesn't match this pattern (including a bare number like `5`, or a negative number like `-5`, which the regex deliberately doesn't match — see Out of scope) is treated as a literal label exactly as it is today. Ranges and literal labels can be mixed in the same list: `Prefer not to say,2017-2026` produces 11 options.

## Implementation

The expansion lives entirely inside `parseOptionsInput` (`src/discord/commands/config-question.ts`), so both `/config question add` and `/config question edit` get it automatically — they already share this one function, and neither the repository layer (`addQuestion`/`editQuestion`/`slugifyOptionLabels`) nor the 25-option cap enforcement needs to change at all. A range expands into a list of numeric-string labels before the existing comma-split/trim/filter pipeline's output is returned; the existing cap check in `src/db/questionnaire-repository.ts` (`if (input.options.length > MAX_OPTIONS) return err('too-many-options')`) sees only the final expanded list and needs no awareness that some of it came from a range.

Expanded numeric labels flow through the existing `slugifyOptionLabels` unchanged — `"1988"` slugifies to the value `"1988"` (digits pass the slug regex untouched), and since a range never produces a duplicate number, the existing numeric-suffix dedup logic never triggers for range-generated options.

## Error handling

No new error type. An oversized range surfaces through the existing `too-many-options` path with the existing message ("A question can have at most 25 options.") — an admin who tries `1988-2026` sees the same rejection they'd see typing 39 labels by hand, which is the correct, already-existing signal that the range needs narrowing.

## Testing

- Unit tests for `parseOptionsInput`'s range expansion: ascending, descending, single-value collapse (`5-5`), mixed literal-and-range in one list, whitespace tolerance around the dash, and confirmation that a bare number or a negative number is *not* treated as a range (falls through to the existing literal-label path).
- No repository or command-handler changes, so no new tests are needed at those layers — the existing cap-enforcement and slugification tests already cover what happens to whatever list `parseOptionsInput` hands them.

## Out of scope

- Negative-number ranges (e.g. `-10-10`) — the hyphen-as-both-sign-and-separator ambiguity isn't worth resolving for a feature whose only real-world use case (years, ratings, counts) is always non-negative. A literal segment starting with `-` (like `-5`) is left as a literal label, unchanged from today.
- A step/increment other than 1 (e.g. every 5th year) — not requested, not built.
- Any change to the 25-option cap itself, or to how oversized ranges are reported beyond the existing message — the cap is a Discord platform fact, not something this feature works around.
