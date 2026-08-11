---
plan: numeric-range-select-chunking
project: discord-developer
updated: 2026-08-11
status: 🔵 Planning
tags: [plan]
---

# 10 — Numeric-Range Select Chunking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `single_select` question whose option list is a numeric range (e.g. `1980-2026`, 47 values) renders as multiple stacked dropdowns instead of being rejected by the 25-option cap — up to 100 options total (4 chunks of 25, leaving one row free for an optional Skip button, Discord's real 5-row-per-message ceiling). Scope is deliberately narrow: only `single_select` with numeric-sequential labels gets the raised cap; hand-typed non-range lists and `multi_select` are unchanged.

**Architecture:** A new pure predicate, `isNumericRangeLabelSet`, detects a contiguous run of digit-only labels and gates a raised cap (100 vs. 25) in the repository layer only. Rendering doesn't need to know "is this a range" at all: the component builder unconditionally chunks a `single_select` question's options into groups of ≤25, which is a no-op for the ≤25-option case the cap layer already guarantees for anything that isn't a range. Every chunk shares the same custom ID, so `interaction-create.ts`'s existing routing needs no changes — whichever dropdown fires first is the complete answer.

**Tech Stack:** TypeScript strict, discord.js v14, better-sqlite3, Vitest — same as the rest of the project.

**Spec:** [`docs/superpowers/specs/2026-08-11-numeric-range-select-chunking-design.md`](../docs/superpowers/specs/2026-08-11-numeric-range-select-chunking-design.md)

## Global Constraints

- The raised cap (100) applies **only** when `type === 'single_select'` AND `isNumericRangeLabelSet(options)` is true. Every other case — `multi_select` regardless of label shape, or `single_select` with non-range labels — keeps the existing 25-option cap unchanged.
- `isNumericRangeLabelSet` is computed from the option labels actually being stored, not from any new schema column or metadata about where the labels came from (range shorthand vs. hand-typed) — a hand-typed `1,2,3,4,5` gets identical treatment to `1-5`, deliberately.
- Chunking in the component builder (`buildQuestionSelectRows`) runs unconditionally for `single_select` — it does not re-check "is this a range." It is safe to run on every `single_select` question because the repository-layer cap guarantees a non-range question can never exceed 25 options, so chunking it always yields exactly one row.
- Every chunk's `StringSelectMenuBuilder` uses the same `CUSTOM_IDS.questionSelect(question.id)` — no new custom ID scheme, no changes to `src/discord/components/custom-ids.ts` or `src/discord/events/interaction-create.ts`.
- `noUncheckedIndexedAccess` is enabled in `tsconfig.json` — array indexing (chunk arrays, regex-adjacent numeric comparisons) needs explicit `undefined` narrowing, not non-null assertions.
- This project has a hard zero-`any` precedent (`grep -rn "as any" src tests` must return nothing) and no `worker_threads` usage.

---

### Task 1: Repository — numeric-range detection and the raised cap

**Files:**
- Modify: `src/db/questionnaire-repository.ts`
- Modify: `tests/db/questionnaire-repository.test.ts`

**Interfaces:**
- Produces: `isNumericRangeLabelSet(labels: readonly string[]): boolean`, exported for its own tests. `MAX_RANGE_OPTIONS = 100` (module-level constant, not exported — internal to the cap logic). `addQuestion`/`editQuestion`'s existing `too-many-options` cap check becomes conditional on this predicate; no other part of their signature or return type changes.

- [ ] **Step 1: Write the failing tests for isNumericRangeLabelSet**

Add to `tests/db/questionnaire-repository.test.ts`, after the existing `describe('slugifyOptionLabels', …)` block. First add `isNumericRangeLabelSet` to the existing import from `'../../src/db/questionnaire-repository.js'`:

```ts
import {
	createQuestionnaireRepository,
	isNumericRangeLabelSet,
	slugifyOptionLabels
} from '../../src/db/questionnaire-repository.js'
```

Then add:

```ts
describe('isNumericRangeLabelSet', () => {
	it('accepts an ascending sequence', () => {
		expect(isNumericRangeLabelSet(['2023', '2024', '2025', '2026'])).toBe(true)
	})

	it('accepts a descending sequence', () => {
		expect(isNumericRangeLabelSet(['10', '9', '8'])).toBe(true)
	})

	it('rejects a sequence with a gap', () => {
		expect(isNumericRangeLabelSet(['1', '2', '4'])).toBe(false)
	})

	it('rejects when any label is not purely digits', () => {
		expect(isNumericRangeLabelSet(['1', 'two', '3'])).toBe(false)
	})

	it('rejects a single label', () => {
		expect(isNumericRangeLabelSet(['5'])).toBe(false)
	})

	it('rejects an empty list', () => {
		expect(isNumericRangeLabelSet([])).toBe(false)
	})

	it('rejects non-numeric literal labels', () => {
		expect(isNumericRangeLabelSet(['New to everything', 'Advanced'])).toBe(false)
	})
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/db/questionnaire-repository.test.ts`
Expected: FAIL — `isNumericRangeLabelSet` doesn't exist yet.

- [ ] **Step 3: Implement isNumericRangeLabelSet**

Add to `src/db/questionnaire-repository.ts`, after `slugifyOptionLabels` and before `isValidQuestionShape`:

```ts
const MAX_RANGE_OPTIONS = 100

export const isNumericRangeLabelSet = (labels: readonly string[]): boolean => {
	if (labels.length < 2) return false

	const values: number[] = []
	for (const label of labels) {
		if (!/^\d+$/.test(label)) return false
		values.push(Number(label))
	}

	const first = values[0]
	const second = values[1]
	if (first === undefined || second === undefined) return false
	const step = second - first
	if (step !== 1 && step !== -1) return false

	for (let i = 1; i < values.length; i += 1) {
		const prev = values[i - 1]
		const curr = values[i]
		if (prev === undefined || curr === undefined) return false
		if (curr - prev !== step) return false
	}

	return true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/db/questionnaire-repository.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing cap tests**

Add to `tests/db/questionnaire-repository.test.ts`, inside a new `describe` block after the `answer validation fields` block:

```ts
describe('the raised cap for single_select numeric ranges', () => {
	const numericLabels = (count: number): string[] => Array.from({ length: count }, (_, i) => String(i + 1))

	it('allows up to 100 options for a single_select numeric range', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Pick a number',
				type: 'single_select',
				required: true,
				options: numericLabels(100),
				numericOnly: false,
				minLength: null,
				maxLength: null
			},
			AT
		)

		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.options).toHaveLength(100)
	})

	it('still rejects more than 100 options even for a numeric range', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Pick a number',
				type: 'single_select',
				required: true,
				options: numericLabels(101),
				numericOnly: false,
				minLength: null,
				maxLength: null
			},
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('does not raise the cap for a non-range single_select option list', () => {
		const labels = Array.from({ length: 26 }, (_, i) => `Choice ${i}`)
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Pick', type: 'single_select', required: true, options: labels, numericOnly: false, minLength: null, maxLength: null },
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('does not raise the cap for multi_select even with numeric sequential labels', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Pick several',
				type: 'multi_select',
				required: true,
				options: numericLabels(26),
				numericOnly: false,
				minLength: null,
				maxLength: null
			},
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('editQuestion also allows up to 100 options for a single_select numeric range', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Pick', type: 'single_select', required: true, options: ['A', 'B'], numericOnly: false, minLength: null, maxLength: null },
			AT
		)

		const result = repo.editQuestion(GUILD, 1, { options: numericLabels(100) }, AT)
		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.options).toHaveLength(100)
	})
})
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm test tests/db/questionnaire-repository.test.ts`
Expected: FAIL — the cap is still a flat 25 everywhere.

- [ ] **Step 7: Wire the raised cap into addQuestion and editQuestion**

Replace `addQuestion` in `src/db/questionnaire-repository.ts`:

```ts
const addQuestion = (
	guildId: string,
	input: NewQuestionInput,
	createdAt: string
): Result<QuestionDefinition, AddEditError> => {
	const count = (statements.countQuestions.get(guildId) as { n: number }).n
	if (count >= MAX_QUESTIONS) return err('too-many-questions')

	const cap =
		input.type === 'single_select' && isNumericRangeLabelSet(input.options) ? MAX_RANGE_OPTIONS : MAX_OPTIONS
	if (input.options.length > cap) return err('too-many-options')

	if (!isValidQuestionShape(input.type, input.numericOnly, input.minLength, input.maxLength))
		return err('invalid-validation')

	const position = count + 1
	const info = statements.insertQuestion.run(
		guildId,
		position,
		input.prompt,
		input.type,
		input.required ? 1 : 0,
		input.numericOnly ? 1 : 0,
		input.minLength,
		input.maxLength,
		createdAt
	)
	const questionId = Number(info.lastInsertRowid)
	if (input.options.length > 0) insertOptions(questionId, input.options)

	return ok(toDefinition(statements.getQuestionAtPosition.get(guildId, position) as QuestionRow))
}
```

Replace `editQuestion`:

```ts
const editQuestion = (
	guildId: string,
	position: number,
	patch: EditQuestionInput,
	_editedAt: string
): Result<QuestionDefinition, AddEditError> => {
	const row = statements.getQuestionAtPosition.get(guildId, position) as QuestionRow | undefined
	if (!row) return err('not-found')

	const effectiveType = patch.type ?? row.type

	if (patch.options) {
		const cap =
			effectiveType === 'single_select' && isNumericRangeLabelSet(patch.options) ? MAX_RANGE_OPTIONS : MAX_OPTIONS
		if (patch.options.length > cap) return err('too-many-options')
	}

	// A type change away from text implicitly clears the three validation
	// fields rather than being rejected — the command surface has no way to
	// explicitly pass "clear" for min_length/max_length (Discord integer
	// options can't distinguish "not supplied" from "clear"), so requiring the
	// admin to clear them first would be a permanent dead end. Explicitly
	// trying to *set* validation in the same call as a non-text type change is
	// still rejected below via isValidQuestionShape.
	const clearValidation = effectiveType !== 'text'
	const effectiveNumericOnly = clearValidation
		? (patch.numericOnly ?? false)
		: (patch.numericOnly ?? row.numeric_only === 1)
	const effectiveMinLength = clearValidation
		? (patch.minLength ?? null)
		: patch.minLength !== undefined
			? patch.minLength
			: row.min_length
	const effectiveMaxLength = clearValidation
		? (patch.maxLength ?? null)
		: patch.maxLength !== undefined
			? patch.maxLength
			: row.max_length

	if (!isValidQuestionShape(effectiveType, effectiveNumericOnly, effectiveMinLength, effectiveMaxLength))
		return err('invalid-validation')

	statements.updateQuestion.run(
		patch.prompt ?? row.prompt,
		effectiveType,
		(patch.required ?? row.required === 1) ? 1 : 0,
		effectiveNumericOnly ? 1 : 0,
		effectiveMinLength,
		effectiveMaxLength,
		row.id
	)

	if (patch.options) {
		statements.deleteOptions.run(row.id)
		insertOptions(row.id, patch.options)
	}

	return ok(toDefinition(statements.getQuestionAtPosition.get(guildId, position) as QuestionRow))
}
```

(The only change from the current `editQuestion` is: `effectiveType` is now computed before the options-cap check instead of after, so the cap check can use it; the options-cap check itself now branches on the raised cap; everything else — the validation-shape logic, `updateQuestion.run`, the trailing `patch.options` block — is unchanged.)

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm test tests/db/questionnaire-repository.test.ts`
Expected: PASS

- [ ] **Step 9: Run the full suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — clean typecheck, every test green.

- [ ] **Step 10: Commit**

```bash
git add src/db/questionnaire-repository.ts tests/db/questionnaire-repository.test.ts
git commit -m "raise the option cap to 100 for single_select numeric-range questions"
```

---

### Task 2: Chunked rendering and docs

**Files:**
- Modify: `src/discord/components/questionnaire.ts`
- Modify: `src/discord/commands/intro.ts`
- Modify: `tests/discord/questionnaire.test.ts`
- Modify: `README.md`
- Modify: `PLAN.md`
- Modify: `plans/00-overview.md`

**Interfaces:**
- Consumes: nothing new from Task 1 directly — this task's chunking logic works purely off `QuestionDefinition.options.length`, not `isNumericRangeLabelSet` (see Global Constraints: rendering doesn't need to know "is this a range").
- Produces: `buildQuestionSelectRows(question: QuestionDefinition): ActionRowBuilder<StringSelectMenuBuilder>[]`, replacing `buildQuestionSelectRow` (singular). `src/discord/commands/intro.ts` is the only other file that imports it.

- [ ] **Step 1: Write the failing component tests**

Replace the `describe('buildQuestionSelectRow', …)` block in `tests/discord/questionnaire.test.ts` with:

```ts
describe('buildQuestionSelectRows', () => {
	it('caps maxValues at 1 for a single-select question', () => {
		const rows = buildQuestionSelectRows(optionalSelect)
		expect(rows).toHaveLength(1)
		const select = rows[0]?.components[0]
		expect(select?.data.custom_id).toBe('onboarding:question-select:2')
		expect(select?.data.max_values).toBe(1)
		expect(select?.data.min_values).toBe(0)
	})

	it('caps maxValues at the option count for a multi-select question', () => {
		const rows = buildQuestionSelectRows(requiredMultiSelect)
		expect(rows).toHaveLength(1)
		const select = rows[0]?.components[0]
		expect(select?.data.max_values).toBe(2)
		expect(select?.data.min_values).toBe(1)
	})

	it('uses the plain placeholder for a single row', () => {
		const rows = buildQuestionSelectRows(optionalSelect)
		expect(rows[0]?.components[0]?.data.placeholder).toBe('Pick your answer')
	})

	it('splits a single_select question with more than 25 options into multiple rows', () => {
		const manyOptions = Array.from({ length: 47 }, (_, i) => ({
			position: i + 1,
			label: String(1980 + i),
			value: String(1980 + i)
		}))
		const rangeQuestion: QuestionDefinition = { ...optionalSelect, options: manyOptions }

		const rows = buildQuestionSelectRows(rangeQuestion)
		expect(rows).toHaveLength(2)
		expect(rows[0]?.components[0]?.data.options).toHaveLength(25)
		expect(rows[1]?.components[0]?.data.options).toHaveLength(22)
	})

	it('sets minValues to 0 on every row when a question with multiple rows is required', () => {
		const manyOptions = Array.from({ length: 30 }, (_, i) => ({
			position: i + 1,
			label: String(1990 + i),
			value: String(1990 + i)
		}))
		const requiredRangeQuestion: QuestionDefinition = { ...optionalSelect, required: true, options: manyOptions }

		const rows = buildQuestionSelectRows(requiredRangeQuestion)
		expect(rows).toHaveLength(2)
		expect(rows[0]?.components[0]?.data.min_values).toBe(0)
		expect(rows[1]?.components[0]?.data.min_values).toBe(0)
	})

	it('shows the label range in each row placeholder when there is more than one row', () => {
		const manyOptions = Array.from({ length: 30 }, (_, i) => ({
			position: i + 1,
			label: String(1990 + i),
			value: String(1990 + i)
		}))
		const rangeQuestion: QuestionDefinition = { ...optionalSelect, options: manyOptions }

		const rows = buildQuestionSelectRows(rangeQuestion)
		expect(rows[0]?.components[0]?.data.placeholder).toBe('Pick your answer (1990–2014)')
		expect(rows[1]?.components[0]?.data.placeholder).toBe('Pick your answer (2015–2019)')
	})

	it('never splits a multi_select question, even with many options', () => {
		const manyOptions = Array.from({ length: 25 }, (_, i) => ({
			position: i + 1,
			label: String(i),
			value: String(i)
		}))
		const bigMultiSelect: QuestionDefinition = { ...requiredMultiSelect, options: manyOptions }

		const rows = buildQuestionSelectRows(bigMultiSelect)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.components[0]?.data.max_values).toBe(25)
	})
})
```

Update the import at the top of the file from `buildQuestionSelectRow` to `buildQuestionSelectRows`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/discord/questionnaire.test.ts`
Expected: FAIL — `buildQuestionSelectRows` doesn't exist yet (still `buildQuestionSelectRow`, singular, non-chunking).

- [ ] **Step 3: Implement buildQuestionSelectRows**

Replace `buildQuestionSelectRow` in `src/discord/components/questionnaire.ts`:

```ts
const OPTIONS_PER_ROW = 25

const chunkOptions = (options: readonly QuestionOption[]): QuestionOption[][] => {
	const chunks: QuestionOption[][] = []
	for (let i = 0; i < options.length; i += OPTIONS_PER_ROW) chunks.push(options.slice(i, i + OPTIONS_PER_ROW))
	return chunks
}

export const buildQuestionSelectRows = (
	question: QuestionDefinition
): ActionRowBuilder<StringSelectMenuBuilder>[] => {
	if (question.type === 'multi_select') {
		return [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId(CUSTOM_IDS.questionSelect(question.id))
					.setPlaceholder('Pick your answer')
					.setMinValues(question.required ? 1 : 0)
					.setMaxValues(question.options.length)
					.addOptions(question.options.map((option) => ({ label: option.label, value: option.value })))
			)
		]
	}

	const chunks = chunkOptions(question.options)

	return chunks.map((options) => {
		const first = options[0]
		const last = options[options.length - 1]
		const placeholder =
			chunks.length > 1 && first && last
				? `Pick your answer (${first.label}–${last.label})`
				: 'Pick your answer'

		return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId(CUSTOM_IDS.questionSelect(question.id))
				.setPlaceholder(placeholder)
				.setMinValues(chunks.length > 1 ? 0 : question.required ? 1 : 0)
				.setMaxValues(1)
				.addOptions(options.map((option) => ({ label: option.label, value: option.value })))
		)
	})
}
```

Add `QuestionOption` to the existing `import type { QuestionDefinition } from '../../types.js'` line, making it `import type { QuestionDefinition, QuestionOption } from '../../types.js'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/discord/questionnaire.test.ts`
Expected: PASS

- [ ] **Step 5: Wire the renamed function into intro.ts**

In `src/discord/commands/intro.ts`, update the import:

```ts
import {
	buildQuestionModal,
	buildQuestionSelectRows,
	buildQuestionSkipRow
} from '../components/questionnaire.js'
```

Replace the non-text branch's payload construction (the part after the `if (next.type === 'text') { … }` block):

```ts
const skipRow = buildQuestionSkipRow(next)
const selectRows = buildQuestionSelectRows(next)
const payload = {
	content: `${position} — ${next.prompt}`,
	components: skipRow ? [...selectRows, skipRow] : selectRows
}
```

(This replaces the current two-line version that calls `buildQuestionSelectRow(next)` — singular — twice.)

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — clean typecheck, every test green. `intro.ts` has no dedicated test file, matching the established convention for this file (Plan 07); its change here is a mechanical call-site update to an already-tested function.

- [ ] **Step 7: Update README**

In `README.md`, append one sentence to the paragraph already covering the numeric-range option shorthand (added by Plan 09):

```
A `single_select` question whose range expands past 25 options (up to 100) renders as several dropdowns instead of one — picking a value from any of them is a complete answer.
```

- [ ] **Step 8: Register the plan and update PLAN.md**

Add a row to `PLAN.md`'s **Phases & Sub-Plans** table:

```
| 10  | [plans/10-numeric-range-select-chunking](plans/10-numeric-range-select-chunking.md) | 🟡 In Progress | Chunked dropdowns for single_select numeric ranges over 25 options |
```

Update the **Current Focus** paragraph's opening line from `Plans 01–09` to `Plans 01–10`, and append one sentence describing Plan 10 in the same style as the existing Plan 08/09 descriptions — mention the 100-option ceiling and why (5-row message limit, 4×25 + 1 Skip row). Update the test count to the actual final count (run `pnpm test` and read the real number rather than guessing). Append a bullet to the human-verification checklist:

```
> - Plan 10: Add a single-select question via `/config question add` with `options:1980-2026` (47 values) and confirm it renders as two dropdowns in Discord, and that picking a value from either one completes the question
```

Add an architecture decision to `plans/00-overview.md`:

```
- 2026-08-11 — **Numeric-range select chunking.** A `single_select` question whose option labels form a numeric sequence can have up to 100 options (Discord's real ceiling: 4 rows of 25 plus one row for an optional Skip button, out of the platform's 5-row-per-message limit), rendered as multiple stacked dropdowns — any one of which completes the answer. Scoped to `single_select` only; `multi_select` and non-range option lists keep the existing 25-option cap. Requested directly by the user. See [[10-numeric-range-select-chunking]]
```

Add a row to `plans/00-overview.md`'s **Module Plans** table:

```
| [[10-numeric-range-select-chunking]] | 🟡 In Progress | —                                    |
```

- [ ] **Step 9: Run final verification**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

Run: `grep -rn "worker_threads" src/`
Expected: no matches.

Run: `grep -rn "as any" src tests`
Expected: no matches.

- [ ] **Step 10: Mark this plan's own frontmatter and checkboxes complete**

Set this file's frontmatter `status:` to `🟡 In Progress` and check off every `- [ ]` step above (both Task 1 and Task 2) as `- [x]` as you complete it, per the project's `CLAUDE.md` convention.

- [ ] **Step 11: Commit**

```bash
git add src/discord/components/questionnaire.ts src/discord/commands/intro.ts tests/discord/questionnaire.test.ts README.md PLAN.md plans/00-overview.md plans/10-numeric-range-select-chunking.md
git commit -m "render single_select numeric-range questions as chunked dropdowns"
```
