---
plan: numeric-range-dropdown-options
project: discord-developer
updated: 2026-08-11
status: 🔵 Planning
tags: [plan]
---

# 09 — Numeric-Range Dropdown Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/config question add`/`edit`'s `options` parameter accepts a numeric-range shorthand (`1988-2026`) that expands into individual numeric options, instead of requiring every value to be typed out by hand.

**Architecture:** The expansion lives entirely inside the existing `parseOptionsInput` function in `src/discord/commands/config-question.ts` — both `add` and `edit` already share it, so neither gets touched directly. No repository, schema, or command-surface change: the existing 25-option cap and slugification pipeline see only the final expanded list and need no awareness of where it came from.

**Tech Stack:** TypeScript strict, Vitest — same as the rest of the project.

**Spec:** [`docs/superpowers/specs/2026-08-11-numeric-range-dropdown-options-design.md`](../docs/superpowers/specs/2026-08-11-numeric-range-dropdown-options-design.md)

## Global Constraints

- Discord's select-menu 25-option cap is unchanged and unaffected — an oversized range must hit the existing `too-many-options` rejection in `src/db/questionnaire-repository.ts`, not a new error path. This plan does not touch that file.
- Only `src/discord/commands/config-question.ts`'s `parseOptionsInput` changes. `slugifyOptionLabels` (`src/db/questionnaire-repository.ts`) and the cap-enforcement logic in `addQuestion`/`editQuestion` are not modified — they already operate on `parseOptionsInput`'s output, which is where this feature's whole surface area lives.
- `noUncheckedIndexedAccess` is enabled in `tsconfig.json` — a regex `exec()` match's capture groups are typed `string | undefined`, even when the pattern guarantees they exist on a successful match. Narrow with an explicit `undefined` check, not a non-null assertion.
- A range endpoint is always a non-negative integer (`\d+`); a segment starting with `-` (a negative number) or a bare number with no dash is left untouched as a literal label — this is a deliberate scope boundary from the spec, not an oversight.

---

### Task 1: Range expansion in parseOptionsInput

**Files:**
- Modify: `src/discord/commands/config-question.ts`
- Modify: `tests/discord/config-question.test.ts`

**Interfaces:**
- `parseOptionsInput(raw: string | null): string[]` — signature unchanged; only its behavior on a range-shaped segment changes. No other file in the codebase needs to change: `handleConfigQuestionCommand`'s `add`/`edit` branches already call `parseOptionsInput` and pass its result straight to `questionnaireRepo.addQuestion`/`editQuestion`.

- [x] **Step 1: Write the failing tests**

Add to `tests/discord/config-question.test.ts`, after the existing `describe('parseOptionsInput', …)` block's current tests (inside the same `describe`, as additional `it`s):

```ts
it('expands an ascending numeric range', () => {
	expect(parseOptionsInput('2023-2026')).toEqual(['2023', '2024', '2025', '2026'])
})

it('expands a descending numeric range', () => {
	expect(parseOptionsInput('10-8')).toEqual(['10', '9', '8'])
})

it('collapses a range with equal endpoints to a single value', () => {
	expect(parseOptionsInput('5-5')).toEqual(['5'])
})

it('tolerates whitespace around the dash', () => {
	expect(parseOptionsInput('1988 - 1990')).toEqual(['1988', '1989', '1990'])
})

it('mixes a literal label with a range in the same list', () => {
	expect(parseOptionsInput('Prefer not to say,2023-2025')).toEqual([
		'Prefer not to say',
		'2023',
		'2024',
		'2025'
	])
})

it('treats a bare number with no dash as a literal label, not a range', () => {
	expect(parseOptionsInput('5')).toEqual(['5'])
})

it('treats a negative number as a literal label, not a range', () => {
	expect(parseOptionsInput('-5')).toEqual(['-5'])
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/discord/config-question.test.ts`
Expected: FAIL — `parseOptionsInput` doesn't expand ranges yet, so `'2023-2026'` currently comes back as the single literal `['2023-2026']`.

- [x] **Step 3: Implement the range expansion**

Replace `parseOptionsInput` in `src/discord/commands/config-question.ts`:

```ts
const RANGE_PATTERN = /^(\d+)\s*-\s*(\d+)$/

const expandRange = (segment: string): string[] => {
	const match = RANGE_PATTERN.exec(segment)
	const startText = match?.[1]
	const endText = match?.[2]
	if (startText === undefined || endText === undefined) return [segment]

	const start = Number(startText)
	const end = Number(endText)
	const step = start <= end ? 1 : -1
	const values: string[] = []
	for (let n = start; step > 0 ? n <= end : n >= end; n += step) values.push(String(n))
	return values
}

export const parseOptionsInput = (raw: string | null): string[] =>
	raw === null
		? []
		: raw
				.split(',')
				.map((segment) => segment.trim())
				.filter((segment) => segment.length > 0)
				.flatMap(expandRange)
```

(`RANGE_PATTERN` and `expandRange` are module-level, not exported — only `parseOptionsInput` is part of this file's public surface, matching the existing convention where `TYPE_LABEL` and `ephemeral` are also unexported module-level constants.)

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/discord/config-question.test.ts`
Expected: PASS

- [x] **Step 5: Run the full suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — clean typecheck, every test green. No other file changes, so no other test file is affected.

- [x] **Step 6: Update README's questionnaire paragraph**

In `README.md`, in the sentence added for Plan 08 ("Text questions can additionally require digits-only answers and/or a character limit…"), append one more sentence:

```
For select-type questions, a comma-separated option can also be a numeric range like `2017-2026`, which expands into individual choices — still subject to the same 25-option cap as if each value were typed out.
```

- [x] **Step 7: Register the plan and update PLAN.md**

Add a row to `PLAN.md`'s **Phases & Sub-Plans** table:

```
| 09  | [plans/09-numeric-range-dropdown-options](plans/09-numeric-range-dropdown-options.md) | 🟡 In Progress | Numeric-range shorthand (e.g. 1988-2026) for dropdown options |
```

Update the **Current Focus** paragraph's opening line from `Plans 01–08` to `Plans 01–09`, and append one sentence describing Plan 09 in the same style as the existing Plan 06/07/08 descriptions. Append a bullet to the human-verification checklist:

```
> - Plan 09: Add a select question via `/config question add` with `options:2020-2025` and confirm the dropdown shows five individual year choices
```

Add an architecture decision to `plans/00-overview.md`:

```
- 2026-08-11 — **Numeric-range dropdown options.** `/config question add`/`edit`'s `options` parameter accepts a shorthand like `1988-2026`, expanding into individual numeric choices instead of requiring each to be typed out — still bounded by Discord's existing 25-option select-menu cap. Requested directly by the user. See [[09-numeric-range-dropdown-options]]
```

Add a row to `plans/00-overview.md`'s **Module Plans** table:

```
| [[09-numeric-range-dropdown-options]] | 🟡 In Progress | —                                    |
```

- [x] **Step 8: Run final verification**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

Run: `grep -rn "worker_threads" src/`
Expected: no matches.

Run: `grep -rn "as any" src tests`
Expected: no matches.

- [x] **Step 9: Mark this plan's own frontmatter and checkboxes complete**

Set this file's frontmatter `status:` to `🟡 In Progress` and check off every `- [ ]` step above as `- [x]` as you complete it, per the project's `CLAUDE.md` convention.

- [x] **Step 10: Commit**

```bash
git add src/discord/commands/config-question.ts tests/discord/config-question.test.ts README.md PLAN.md plans/00-overview.md plans/09-numeric-range-dropdown-options.md
git commit -m "add numeric-range shorthand for dropdown question options"
```
