---
plan: questionnaire-answer-validation
project: discord-developer
updated: 2026-08-11
status: 🟡 In Progress
tags: [plan]
---

# 08 — Questionnaire Answer Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Text-type questionnaire questions gain two independently-optional validation rules: numeric-only (digits only) and a character limit (min/max length). Select-type questions need no new validation — the option list already constrains the answer.

**Architecture:** Character limits are enforced natively by Discord's modal `TextInputBuilder` (`setMinLength`/`setMaxLength`) — no server-side re-check needed. Numeric-only has no native Discord equivalent, so it's checked server-side on modal submit via a new pure function in `src/core/questionnaire.ts`; a failed check replies with an error and a "Try Again" button instead of saving an answer, since Discord does not allow responding to a modal submission with another modal.

**Tech Stack:** TypeScript strict, discord.js v14, better-sqlite3, Vitest — same as the rest of the project.

**Spec:** [`docs/superpowers/specs/2026-08-11-questionnaire-answer-validation-design.md`](../docs/superpowers/specs/2026-08-11-questionnaire-answer-validation-design.md)

## Global Constraints

- `src/discord/` is the only layer allowed to import discord.js. `src/core/` accepts only fully-resolved data. `src/db/` never imports from `src/core/` or `src/discord/`. Shared types live in `src/types.ts`.
- This migration is **additive only** — new nullable/defaulted columns via a guarded `ALTER TABLE` in `migrate.ts`, exactly like the existing `intro_template_text`/`intro_template_message_id` columns. No destructive changes, unlike Plan 07's `questionnaire_answers` rework.
- Prepare SQL once at repository construction, matching every existing repository in `src/db/`.
- Numeric/length validation only applies to `text`-type questions; this is checked against the **effective** (patch merged with existing row) state on edit, not just the fields present in a single call — so changing a question's type away from `text` while it still has `numericOnly`/`minLength`/`maxLength` set is rejected unless the same edit call also clears them. This keeps the stored row always internally consistent (no question can end up `type: 'single_select'` with `numeric_only: 1` sitting unused in the row).
- `min_length`/`max_length` are each bounded to 1–4000 (Discord's own modal text-input limit) and `min_length` can never exceed `max_length`, enforced in the repository layer (`src/db/questionnaire-repository.ts`) as a new `AddEditError` variant, `invalid-validation` — same place `too-many-questions`/`too-many-options` are enforced today.
- `interaction-create.ts`'s new modal-submit and button branches get no dedicated test file, matching the pre-existing convention for that file (established in Plan 07 — meaningful logic lives in `isValidNumericAnswer`, which is unit tested in `src/core/`).
- `guildId` is always the first parameter on every repository method, matching every existing repository.

---

### Task 1: Schema, migration, types, and repository

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrate.ts`
- Modify: `src/types.ts`
- Modify: `src/db/questionnaire-repository.ts`
- Modify: `tests/db/migrate.test.ts`
- Modify: `tests/db/questionnaire-repository.test.ts`
- Modify: `tests/core/questionnaire.test.ts` (fixture only — see Step 8)
- Modify: `tests/discord/questionnaire.test.ts` (fixture only — see Step 8)

**Interfaces:**
- Produces: `QuestionDefinition` (in `src/types.ts`) gains `numericOnly: boolean`, `minLength: number | null`, `maxLength: number | null` — always present, only meaningful when `type === 'text'`. `QuestionnaireRepository`'s `addQuestion`/`editQuestion` accept these three fields; a new `getQuestionById(guildId, questionId): QuestionDefinition | undefined` method is added (used by Task 4). `AddEditError` gains `'invalid-validation'`.

- [x] **Step 1: Write the failing migration tests**

Add to `tests/db/migrate.test.ts` (needs `import Database from 'better-sqlite3'` — already imported at the top of this file):

```ts
it('adds numeric_only/min_length/max_length columns to a questionnaire_questions table created before they existed', () => {
	// Simulates a deployment on the configurable-questionnaire schema (2026-08-11)
	// predating the answer-validation columns.
	const db = new Database(':memory:')
	db.exec(`
		CREATE TABLE guild_config (
			guild_id TEXT PRIMARY KEY,
			joined_at TEXT NOT NULL
		)
	`)
	db.exec(`
		CREATE TABLE onboarding (
			guild_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			first_joined_at TEXT NOT NULL,
			last_joined_at TEXT NOT NULL,
			PRIMARY KEY (guild_id, user_id)
		)
	`)
	db.exec(`
		CREATE TABLE questionnaire_questions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			prompt TEXT NOT NULL,
			type TEXT NOT NULL,
			required INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL
		)
	`)
	db.prepare(
		"INSERT INTO questionnaire_questions (guild_id, position, prompt, type, required, created_at) VALUES ('g1', 1, 'Old question', 'text', 1, 'now')"
	).run()

	expect(() => migrate(db)).not.toThrow()

	const columns = (db.pragma('table_info(questionnaire_questions)') as { name: string }[]).map(
		(row) => row.name
	)
	expect(columns).toContain('numeric_only')
	expect(columns).toContain('min_length')
	expect(columns).toContain('max_length')

	const row = db
		.prepare('SELECT numeric_only FROM questionnaire_questions WHERE guild_id = ?')
		.get('g1') as { numeric_only: number }
	expect(row.numeric_only).toBe(0)
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/db/migrate.test.ts`
Expected: FAIL — `numeric_only`/`min_length`/`max_length` don't exist on the fixture's `questionnaire_questions` table and `migrate()` has nothing to add them yet.

- [x] **Step 3: Add the columns to schema.sql**

In `src/db/schema.sql`, replace the `questionnaire_questions` table definition:

```sql
CREATE TABLE IF NOT EXISTS questionnaire_questions (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id     TEXT NOT NULL,
	position     INTEGER NOT NULL,
	prompt       TEXT NOT NULL,
	type         TEXT NOT NULL CHECK (type IN ('text','single_select','multi_select')),
	required     INTEGER NOT NULL DEFAULT 1,
	numeric_only INTEGER NOT NULL DEFAULT 0,
	min_length   INTEGER,
	max_length   INTEGER,
	created_at   TEXT NOT NULL
);
```

- [x] **Step 4: Guard the columns in migrate.ts**

In `src/db/migrate.ts`, add three entries to `ADDED_COLUMNS`:

```ts
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
	{
		table: 'guild_config',
		column: 'intro_template_text',
		ddl: 'ALTER TABLE guild_config ADD COLUMN intro_template_text TEXT'
	},
	{
		table: 'guild_config',
		column: 'intro_template_message_id',
		ddl: 'ALTER TABLE guild_config ADD COLUMN intro_template_message_id TEXT'
	},
	{
		table: 'questionnaire_questions',
		column: 'numeric_only',
		ddl: 'ALTER TABLE questionnaire_questions ADD COLUMN numeric_only INTEGER NOT NULL DEFAULT 0'
	},
	{
		table: 'questionnaire_questions',
		column: 'min_length',
		ddl: 'ALTER TABLE questionnaire_questions ADD COLUMN min_length INTEGER'
	},
	{
		table: 'questionnaire_questions',
		column: 'max_length',
		ddl: 'ALTER TABLE questionnaire_questions ADD COLUMN max_length INTEGER'
	}
]
```

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/db/migrate.test.ts`
Expected: PASS

- [x] **Step 6: Update the QuestionDefinition type**

In `src/types.ts`, replace the `QuestionDefinition` type:

```ts
export type QuestionDefinition = {
	readonly id: number
	readonly position: number
	readonly prompt: string
	readonly type: QuestionType
	readonly required: boolean
	readonly numericOnly: boolean
	readonly minLength: number | null
	readonly maxLength: number | null
	readonly options: readonly QuestionOption[]
}
```

- [x] **Step 7: Run typecheck to see the fallout**

Run: `pnpm typecheck`
Expected: FAIL — every literal `QuestionDefinition` object (the two test fixture files) is now missing the three new required fields, and `src/db/questionnaire-repository.ts`'s `toDefinition` no longer satisfies the type either. This is expected; the rest of this task fixes the repository, and Step 8 fixes the two fixture files so the whole project compiles again before moving to Task 2.

- [x] **Step 8: Fix the two existing test fixture files**

In `tests/core/questionnaire.test.ts`, add `numericOnly: false, minLength: null, maxLength: null,` to both `textQuestion` and `selectQuestion` (after `required: …`, before `options: …`):

```ts
const textQuestion: QuestionDefinition = {
	id: 1,
	position: 1,
	prompt: 'What brings you here?',
	type: 'text',
	required: true,
	numericOnly: false,
	minLength: null,
	maxLength: null,
	options: []
}

const selectQuestion: QuestionDefinition = {
	id: 2,
	position: 2,
	prompt: 'Pick one',
	type: 'single_select',
	required: false,
	numericOnly: false,
	minLength: null,
	maxLength: null,
	options: [
		{ position: 1, label: 'A', value: 'a' },
		{ position: 2, label: 'B', value: 'b' }
	]
}
```

In `tests/discord/questionnaire.test.ts`, apply the same addition to `textQuestion` and `optionalSelect` (`requiredMultiSelect` spreads `optionalSelect`, so it inherits the fields automatically):

```ts
const textQuestion: QuestionDefinition = {
	id: 1,
	position: 1,
	prompt: 'What brings you here?',
	type: 'text',
	required: true,
	numericOnly: false,
	minLength: null,
	maxLength: null,
	options: []
}

const optionalSelect: QuestionDefinition = {
	id: 2,
	position: 2,
	prompt: 'Pick one',
	type: 'single_select',
	required: false,
	numericOnly: false,
	minLength: null,
	maxLength: null,
	options: [
		{ position: 1, label: 'A', value: 'a' },
		{ position: 2, label: 'B', value: 'b' }
	]
}
```

- [x] **Step 9: Write the failing repository tests**

Add to `tests/db/questionnaire-repository.test.ts`, after the existing `describe('addQuestion', …)` block:

```ts
describe('answer validation fields', () => {
	it('stores numericOnly/minLength/maxLength on a text question', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Birth year?',
				type: 'text',
				required: true,
				options: [],
				numericOnly: true,
				minLength: 4,
				maxLength: 4
			},
			AT
		)

		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.numericOnly).toBe(true)
		expect(result.value.minLength).toBe(4)
		expect(result.value.maxLength).toBe(4)
	})

	it('defaults to no validation when not supplied', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
			AT
		)

		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.numericOnly).toBe(false)
		expect(result.value.minLength).toBeNull()
		expect(result.value.maxLength).toBeNull()
	})

	it('rejects numeric/length validation on a select question', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Pick',
				type: 'single_select',
				required: true,
				options: ['A', 'B'],
				numericOnly: true,
				minLength: null,
				maxLength: null
			},
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('invalid-validation')
	})

	it('rejects a length outside 1-4000', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: 0, maxLength: null },
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('invalid-validation')
	})

	it('rejects min_length greater than max_length', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: 10, maxLength: 5 },
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('invalid-validation')
	})

	it('editQuestion rejects changing type away from text while numeric validation is still set', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Year', type: 'text', required: true, options: [], numericOnly: true, minLength: null, maxLength: null },
			AT
		)

		const result = repo.editQuestion(GUILD, 1, { type: 'single_select', options: ['A', 'B'] }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('invalid-validation')
	})

	it('editQuestion allows the type change once numeric validation is explicitly cleared in the same edit', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Year', type: 'text', required: true, options: [], numericOnly: true, minLength: null, maxLength: null },
			AT
		)

		const result = repo.editQuestion(
			GUILD,
			1,
			{ type: 'single_select', options: ['A', 'B'], numericOnly: false },
			AT
		)
		expect(isOk(result)).toBe(true)
	})

	it('editQuestion updates only the supplied validation fields, leaving the rest untouched', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Year', type: 'text', required: true, options: [], numericOnly: true, minLength: 4, maxLength: 4 },
			AT
		)

		const result = repo.editQuestion(GUILD, 1, { maxLength: 10 }, AT)
		expect(isOk(result) && result.value.numericOnly).toBe(true)
		expect(isOk(result) && result.value.minLength).toBe(4)
		expect(isOk(result) && result.value.maxLength).toBe(10)
	})
})

describe('getQuestionById', () => {
	it('returns the question when it exists for the guild', () => {
		const added = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
			AT
		)
		if (!isOk(added)) throw new Error('setup failed')

		expect(repo.getQuestionById(GUILD, added.value.id)?.prompt).toBe('Q')
	})

	it('returns undefined for an id that does not exist', () => {
		expect(repo.getQuestionById(GUILD, 999)).toBeUndefined()
	})

	it('returns undefined when the id belongs to a different guild', () => {
		const added = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
			AT
		)
		if (!isOk(added)) throw new Error('setup failed')

		expect(repo.getQuestionById(OTHER_GUILD, added.value.id)).toBeUndefined()
	})
})
```

Every existing `addQuestion(...)` call elsewhere in this file (in the `listQuestions`/`editQuestion`/`removeQuestion`/`moveQuestion`/`clearQuestions` describe blocks) now fails to typecheck too, since `NewQuestionInput` is gaining three new required fields in Step 11. Update every existing call site in this file from:

```ts
{ prompt: 'X', type: 'text', required: true, options: [] }
```

to:

```ts
{ prompt: 'X', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }
```

(There are roughly a dozen such call sites across the file — every `repo.addQuestion(...)` call. Keep each call's existing `prompt`/`type`/`required`/`options` values exactly as they are; only append the three new fields.)

- [x] **Step 10: Run tests to verify they fail**

Run: `pnpm test tests/db/questionnaire-repository.test.ts`
Expected: FAIL to compile — `NewQuestionInput` doesn't have `numericOnly`/`minLength`/`maxLength` yet, `getQuestionById` doesn't exist yet.

- [x] **Step 11: Implement the repository changes**

In `src/db/questionnaire-repository.ts`, apply these changes:

Update `NewQuestionInput` and `AddEditError`:

```ts
export type NewQuestionInput = {
	prompt: string
	type: QuestionType
	required: boolean
	options: string[]
	numericOnly: boolean
	minLength: number | null
	maxLength: number | null
}

export type EditQuestionInput = Partial<NewQuestionInput>

export type AddEditError = 'too-many-questions' | 'too-many-options' | 'not-found' | 'invalid-validation'
```

Update `QuestionRow`:

```ts
type QuestionRow = {
	id: number
	guild_id: string
	position: number
	prompt: string
	type: QuestionType
	required: number
	numeric_only: number
	min_length: number | null
	max_length: number | null
	created_at: string
}
```

Add a shared validator (module-level, next to `slugifyOne`):

```ts
const isValidQuestionShape = (
	type: QuestionType,
	numericOnly: boolean,
	minLength: number | null,
	maxLength: number | null
): boolean => {
	if (type !== 'text' && (numericOnly || minLength !== null || maxLength !== null)) return false
	if (minLength !== null && (minLength < 1 || minLength > 4000)) return false
	if (maxLength !== null && (maxLength < 1 || maxLength > 4000)) return false
	if (minLength !== null && maxLength !== null && minLength > maxLength) return false
	return true
}
```

Update the `insertQuestion`/`updateQuestion`/`getQuestionAtPosition` statements (add a `getQuestionById` statement alongside `getQuestionAtPosition`):

```ts
insertQuestion: db.prepare(
	`INSERT INTO questionnaire_questions
	 (guild_id, position, prompt, type, required, numeric_only, min_length, max_length, created_at)
	 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
),
getQuestionAtPosition: db.prepare(
	'SELECT * FROM questionnaire_questions WHERE guild_id = ? AND position = ?'
),
getQuestionById: db.prepare(
	'SELECT * FROM questionnaire_questions WHERE guild_id = ? AND id = ?'
),
updateQuestion: db.prepare(
	`UPDATE questionnaire_questions
	 SET prompt = ?, type = ?, required = ?, numeric_only = ?, min_length = ?, max_length = ?
	 WHERE id = ?`
),
```

(Leave every other statement in the `statements` object exactly as it is.)

Update `toDefinition`:

```ts
const toDefinition = (row: QuestionRow): QuestionDefinition => ({
	id: row.id,
	position: row.position,
	prompt: row.prompt,
	type: row.type,
	required: row.required === 1,
	numericOnly: row.numeric_only === 1,
	minLength: row.min_length,
	maxLength: row.max_length,
	options: (statements.listOptions.all(row.id) as OptionRow[]).map(
		(option): QuestionOption => ({
			position: option.position,
			label: option.label,
			value: option.value
		})
	)
})
```

Update `addQuestion`:

```ts
const addQuestion = (
	guildId: string,
	input: NewQuestionInput,
	createdAt: string
): Result<QuestionDefinition, AddEditError> => {
	const count = (statements.countQuestions.get(guildId) as { n: number }).n
	if (count >= MAX_QUESTIONS) return err('too-many-questions')
	if (input.options.length > MAX_OPTIONS) return err('too-many-options')
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

Update `editQuestion`:

```ts
const editQuestion = (
	guildId: string,
	position: number,
	patch: EditQuestionInput,
	_editedAt: string
): Result<QuestionDefinition, AddEditError> => {
	const row = statements.getQuestionAtPosition.get(guildId, position) as QuestionRow | undefined
	if (!row) return err('not-found')
	if (patch.options && patch.options.length > MAX_OPTIONS) return err('too-many-options')

	const effectiveType = patch.type ?? row.type
	const effectiveNumericOnly = patch.numericOnly ?? row.numeric_only === 1
	const effectiveMinLength = patch.minLength !== undefined ? patch.minLength : row.min_length
	const effectiveMaxLength = patch.maxLength !== undefined ? patch.maxLength : row.max_length
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

Add `getQuestionById` (next to the other functions, before the final `return`):

```ts
const getQuestionById = (guildId: string, questionId: number): QuestionDefinition | undefined => {
	const row = statements.getQuestionById.get(guildId, questionId) as QuestionRow | undefined
	return row ? toDefinition(row) : undefined
}
```

Update the returned object:

```ts
return {
	listQuestions,
	addQuestion,
	editQuestion,
	removeQuestion,
	moveQuestion,
	clearQuestions,
	getQuestionById
}
```

- [x] **Step 12: Run tests and typecheck to verify everything passes**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — clean typecheck, all tests green (this now includes the fixture fixes from Step 8).

- [x] **Step 13: Commit**

```bash
git add src/db/schema.sql src/db/migrate.ts src/types.ts src/db/questionnaire-repository.ts tests/db/migrate.test.ts tests/db/questionnaire-repository.test.ts tests/core/questionnaire.test.ts tests/discord/questionnaire.test.ts
git commit -m "add numeric-only and character-limit validation fields to questionnaire questions"
```

---

### Task 2: Admin command surface

**Files:**
- Modify: `src/discord/commands/config.ts`
- Modify: `src/discord/commands/config-question.ts`

**Interfaces:**
- Consumes: `questionnaireRepo.addQuestion`/`editQuestion` (Task 1), whose `NewQuestionInput`/`EditQuestionInput` now include `numericOnly`, `minLength`, `maxLength`; `AddEditError` now includes `'invalid-validation'`.

- [x] **Step 1: Add the three new slash-command options**

In `src/discord/commands/config.ts`, inside the `question` subcommand group, add three options to **both** the `add` and `edit` subcommands, immediately after the existing `options` string option in each:

```ts
.addBooleanOption((option) =>
	option
		.setName('numeric')
		.setDescription('Text only: require the answer to be digits only')
		.setRequired(false)
)
.addIntegerOption((option) =>
	option
		.setName('min_length')
		.setDescription('Text only: minimum answer length (1-4000)')
		.setRequired(false)
		.setMinValue(1)
		.setMaxValue(4000)
)
.addIntegerOption((option) =>
	option
		.setName('max_length')
		.setDescription('Text only: maximum answer length (1-4000)')
		.setRequired(false)
		.setMinValue(1)
		.setMaxValue(4000)
)
```

So the `add` subcommand definition becomes (full block, for reference — only the three new `.add…Option` calls at the end are new):

```ts
.addSubcommand((sub) =>
	sub
		.setName('add')
		.setDescription('Add a question to the questionnaire')
		.addStringOption((option) =>
			option.setName('prompt').setDescription('The question text').setRequired(true).setMaxLength(300)
		)
		.addStringOption((option) =>
			option
				.setName('type')
				.setDescription('Answer type')
				.setRequired(true)
				.addChoices(
					{ name: 'Text response', value: 'text' },
					{ name: 'Single choice', value: 'single_select' },
					{ name: 'Multiple choice', value: 'multi_select' }
				)
		)
		.addBooleanOption((option) =>
			option.setName('required').setDescription('Must the member answer this?').setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName('options')
				.setDescription('Comma-separated choices (only for Single/Multiple choice)')
				.setRequired(false)
		)
		.addBooleanOption((option) =>
			option
				.setName('numeric')
				.setDescription('Text only: require the answer to be digits only')
				.setRequired(false)
		)
		.addIntegerOption((option) =>
			option
				.setName('min_length')
				.setDescription('Text only: minimum answer length (1-4000)')
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(4000)
		)
		.addIntegerOption((option) =>
			option
				.setName('max_length')
				.setDescription('Text only: maximum answer length (1-4000)')
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(4000)
		)
)
```

And `edit` becomes:

```ts
.addSubcommand((sub) =>
	sub
		.setName('edit')
		.setDescription('Edit an existing question')
		.addIntegerOption((option) =>
			option.setName('position').setDescription('Position from /config question list').setRequired(true)
		)
		.addStringOption((option) =>
			option.setName('prompt').setDescription('New question text').setRequired(false).setMaxLength(300)
		)
		.addStringOption((option) =>
			option
				.setName('type')
				.setDescription('New answer type')
				.setRequired(false)
				.addChoices(
					{ name: 'Text response', value: 'text' },
					{ name: 'Single choice', value: 'single_select' },
					{ name: 'Multiple choice', value: 'multi_select' }
				)
		)
		.addBooleanOption((option) =>
			option.setName('required').setDescription('Must the member answer this?').setRequired(false)
		)
		.addStringOption((option) =>
			option
				.setName('options')
				.setDescription('New comma-separated choices (replaces the old list)')
				.setRequired(false)
		)
		.addBooleanOption((option) =>
			option
				.setName('numeric')
				.setDescription('Text only: require the answer to be digits only')
				.setRequired(false)
		)
		.addIntegerOption((option) =>
			option
				.setName('min_length')
				.setDescription('Text only: minimum answer length (1-4000)')
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(4000)
		)
		.addIntegerOption((option) =>
			option
				.setName('max_length')
				.setDescription('Text only: maximum answer length (1-4000)')
				.setRequired(false)
				.setMinValue(1)
				.setMaxValue(4000)
		)
)
```

- [x] **Step 2: Update the add handler**

In `src/discord/commands/config-question.ts`, replace the `if (subcommand === 'add') { … }` block:

```ts
if (subcommand === 'add') {
	const prompt = interaction.options.getString('prompt', true)
	const type = interaction.options.getString('type', true) as
		'text' | 'single_select' | 'multi_select'
	const required = interaction.options.getBoolean('required', true)
	const options = parseOptionsInput(interaction.options.getString('options'))
	const numericOnly = interaction.options.getBoolean('numeric') ?? false
	const minLength = interaction.options.getInteger('min_length')
	const maxLength = interaction.options.getInteger('max_length')

	if (type === 'text' && options.length > 0) {
		await interaction.reply({
			content: 'Text questions cannot have options — leave `options` empty.',
			...ephemeral
		})
		return
	}
	if (type !== 'text' && options.length === 0) {
		await interaction.reply({
			content: 'Single/Multiple choice questions need `options` (comma-separated).',
			...ephemeral
		})
		return
	}

	const result = questionnaireRepo.addQuestion(
		guild.id,
		{ prompt, type, required, options, numericOnly, minLength, maxLength },
		now()
	)
	if (!isOk(result)) {
		await interaction.reply({
			content:
				result.error === 'too-many-questions'
					? 'This server already has the maximum of 10 questions.'
					: result.error === 'too-many-options'
						? 'A question can have at most 25 options.'
						: 'Numeric/length validation only applies to text questions, lengths must be 1-4000, and `min_length` cannot exceed `max_length`.',
			...ephemeral
		})
		return
	}

	await interaction.reply({
		content: `Added question **${result.value.position}**: ${prompt}`,
		...ephemeral
	})
	return
}
```

- [x] **Step 3: Update the edit handler**

Replace the `if (subcommand === 'edit') { … }` block:

```ts
if (subcommand === 'edit') {
	const position = interaction.options.getInteger('position', true)
	const prompt = interaction.options.getString('prompt') ?? undefined
	const type = (interaction.options.getString('type') ?? undefined) as
		'text' | 'single_select' | 'multi_select' | undefined
	const required = interaction.options.getBoolean('required') ?? undefined
	const rawOptions = interaction.options.getString('options')
	const options = rawOptions === null ? undefined : parseOptionsInput(rawOptions)
	const numericOnly = interaction.options.getBoolean('numeric') ?? undefined
	const minLength = interaction.options.getInteger('min_length') ?? undefined
	const maxLength = interaction.options.getInteger('max_length') ?? undefined

	const result = questionnaireRepo.editQuestion(
		guild.id,
		position,
		{
			...(prompt !== undefined && { prompt }),
			...(type !== undefined && { type }),
			...(required !== undefined && { required }),
			...(options !== undefined && { options }),
			...(numericOnly !== undefined && { numericOnly }),
			...(minLength !== undefined && { minLength }),
			...(maxLength !== undefined && { maxLength })
		},
		now()
	)
	if (!isOk(result)) {
		await interaction.reply({
			content:
				result.error === 'not-found'
					? `No question at position ${position}.`
					: result.error === 'too-many-options'
						? 'A question can have at most 25 options.'
						: 'Numeric/length validation only applies to text questions (pass `numeric:False` if changing away from Text while it was previously set), lengths must be 1-4000, and `min_length` cannot exceed `max_length`.',
			...ephemeral
		})
		return
	}

	await interaction.reply({ content: `Updated question **${position}**.`, ...ephemeral })
	return
}
```

Note: `min_length`/`max_length` can be set or changed via `edit`, but not explicitly cleared back to "unlimited" once set (Discord integer options have no way to distinguish "not supplied" from "clear it" — `getInteger` returns `null` for both). This is an accepted, narrow limitation: clearing a length limit requires removing and re-adding the question.

- [x] **Step 4: Run typecheck and the full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. No new test file for this step — `config-question.ts`'s interaction handling isn't unit tested beyond the pure `parseOptionsInput` function (pre-existing convention); the new validation logic itself is already covered by Task 1's repository tests.

- [x] **Step 5: Commit**

```bash
git add src/discord/commands/config.ts src/discord/commands/config-question.ts
git commit -m "add numeric/min_length/max_length params to /config question add and edit"
```

---

### Task 3: Native character-limit enforcement in the modal

**Files:**
- Modify: `src/discord/components/questionnaire.ts`
- Modify: `tests/discord/questionnaire.test.ts`

**Interfaces:**
- Consumes: `QuestionDefinition.minLength`/`maxLength` (Task 1).

- [x] **Step 1: Write the failing tests**

Add to `tests/discord/questionnaire.test.ts`, inside the existing `describe('buildQuestionModal', …)` block:

```ts
it('defaults max length to 1000 when no character limit is configured', () => {
	const modal = buildQuestionModal(textQuestion)
	const input = modal.components[0]?.components[0]
	expect((input?.data as { max_length?: number })?.max_length).toBe(1000)
	expect((input?.data as { min_length?: number })?.min_length).toBeUndefined()
})

it('applies a configured min and max length', () => {
	const modal = buildQuestionModal({ ...textQuestion, minLength: 4, maxLength: 4 })
	const input = modal.components[0]?.components[0]
	expect((input?.data as { min_length?: number })?.min_length).toBe(4)
	expect((input?.data as { max_length?: number })?.max_length).toBe(4)
})

it('raises the default max length so it never sits below a configured min length', () => {
	const modal = buildQuestionModal({ ...textQuestion, minLength: 4000, maxLength: null })
	const input = modal.components[0]?.components[0]
	expect((input?.data as { max_length?: number })?.max_length).toBe(4000)
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/discord/questionnaire.test.ts`
Expected: FAIL — `buildQuestionModal` still hardcodes `setMaxLength(1000)` and never calls `setMinLength`.

- [x] **Step 3: Implement**

Replace `buildQuestionModal` in `src/discord/components/questionnaire.ts`:

```ts
export const buildQuestionModal = (question: QuestionDefinition): ModalBuilder => {
	const maxLength = question.maxLength ?? Math.max(question.minLength ?? 0, 1000)

	const input = new TextInputBuilder()
		.setCustomId(CUSTOM_IDS.questionAnswerInput)
		.setLabel(question.prompt.slice(0, 45))
		.setStyle(TextInputStyle.Paragraph)
		.setMaxLength(maxLength)
		.setRequired(question.required)

	if (question.minLength !== null) input.setMinLength(question.minLength)

	return new ModalBuilder()
		.setCustomId(CUSTOM_IDS.questionModal(question.id))
		.setTitle(question.prompt.slice(0, 45))
		.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/discord/questionnaire.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/discord/components/questionnaire.ts tests/discord/questionnaire.test.ts
git commit -m "apply configured character limits natively in the question modal"
```

---

### Task 4: Numeric-only validation and the retry flow

**Files:**
- Modify: `src/core/questionnaire.ts`
- Modify: `tests/core/questionnaire.test.ts`
- Modify: `src/discord/components/custom-ids.ts`
- Modify: `tests/discord/custom-ids.test.ts`
- Modify: `src/discord/events/interaction-create.ts`

**Interfaces:**
- Produces: `isValidNumericAnswer(value: string): boolean` in `src/core/questionnaire.ts`. `CUSTOM_IDS.questionRetry(questionId: number): string`.
- Consumes: `questionnaireRepo.getQuestionById` (Task 1), `buildQuestionModal` (Task 3).

- [x] **Step 1: Write the failing core tests**

Add to `tests/core/questionnaire.test.ts`:

```ts
describe('isValidNumericAnswer', () => {
	it('accepts digits only', () => {
		expect(isValidNumericAnswer('1990')).toBe(true)
	})

	it('rejects letters', () => {
		expect(isValidNumericAnswer('nineteen ninety')).toBe(false)
	})

	it('rejects a decimal point', () => {
		expect(isValidNumericAnswer('19.90')).toBe(false)
	})

	it('rejects an empty string', () => {
		expect(isValidNumericAnswer('')).toBe(false)
	})

	it('trims surrounding whitespace before checking', () => {
		expect(isValidNumericAnswer('  1990  ')).toBe(true)
	})

	it('rejects a leading minus sign', () => {
		expect(isValidNumericAnswer('-5')).toBe(false)
	})
})
```

Add `isValidNumericAnswer` to the existing import from `'../../src/core/questionnaire.js'` at the top of the file.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/core/questionnaire.test.ts`
Expected: FAIL — `isValidNumericAnswer` doesn't exist yet.

- [x] **Step 3: Implement isValidNumericAnswer**

Add to `src/core/questionnaire.ts`:

```ts
export const isValidNumericAnswer = (value: string): boolean => /^\d+$/.test(value.trim())
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/core/questionnaire.test.ts`
Expected: PASS

- [x] **Step 5: Write the failing custom-id test**

Add to `tests/discord/custom-ids.test.ts`, inside the existing `describe('dynamic question custom ids', …)` block:

```ts
it('builds a parseable retry id for a question', () => {
	expect(parseCustomId(CUSTOM_IDS.questionRetry(7))).toEqual({
		namespace: 'onboarding',
		action: 'question-retry',
		value: '7'
	})
})
```

- [x] **Step 6: Run tests to verify they fail**

Run: `pnpm test tests/discord/custom-ids.test.ts`
Expected: FAIL — `CUSTOM_IDS.questionRetry` doesn't exist yet.

- [x] **Step 7: Add the custom id**

In `src/discord/components/custom-ids.ts`, add `questionRetry` to `CUSTOM_IDS`, next to `questionSkip`:

```ts
export const CUSTOM_IDS = {
	rulesAgree: `${NAMESPACE}:rules-agree`,
	questionAnswerInput: `${NAMESPACE}:question-answer`,
	questionModal: (questionId: number) => `${NAMESPACE}:question-modal:${questionId}`,
	questionSelect: (questionId: number) => `${NAMESPACE}:question-select:${questionId}`,
	questionSkip: (questionId: number) => `${NAMESPACE}:question-skip:${questionId}`,
	questionRetry: (questionId: number) => `${NAMESPACE}:question-retry:${questionId}`,
	rulesTextModal: `${NAMESPACE}:rules-text-modal`,
	rulesTextInput: `${NAMESPACE}:rules-text-input`,
	introTemplateModal: `${NAMESPACE}:intro-template-modal`,
	introTemplateInput: `${NAMESPACE}:intro-template-input`
} as const
```

- [x] **Step 8: Run tests to verify they pass**

Run: `pnpm test tests/discord/custom-ids.test.ts`
Expected: PASS

- [x] **Step 9: Wire numeric validation and the retry button into interaction-create.ts**

Replace the full contents of `src/discord/events/interaction-create.ts`:

```ts
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	type Interaction
} from 'discord.js'
import { isValidNumericAnswer } from '../../core/questionnaire.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import { promptNextQuestion, type PromptableInteraction } from '../commands/intro.js'
import { handleOnboardingCommand } from '../commands/onboarding.js'
import { buildQuestionModal } from '../components/questionnaire.js'
import { CUSTOM_IDS, parseCustomId } from '../components/custom-ids.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export type OnboardingInteractionDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly service: OnboardingService
	readonly now: () => string
}

const NOT_ACTIVE = 'Onboarding is not set up in this server yet.'

export const handleOnboardingInteraction = async (
	interaction: Interaction,
	deps: OnboardingInteractionDeps
): Promise<void> => {
	if (!interaction.guildId) return

	const { guildConfig, repo, questionnaireRepo, service, now } = deps
	const userId = interaction.user.id

	// Shared by every branch that ends by walking to the next (or completing)
	// question. `onComplete` stamps the questionnaire step — passed in here
	// rather than baked into promptNextQuestion, since only this file has
	// `service`/`config` in scope. Completion is derived from live config
	// every time this fires, never asserted ahead of time, so a stale
	// interaction can't mark an unfinished (or since-reconfigured)
	// questionnaire done — see promptNextQuestion's own comment on this.
	const advance = (
		responder: PromptableInteraction,
		config: NonNullable<ReturnType<typeof resolveActiveConfig>>
	): Promise<void> =>
		promptNextQuestion(responder, repo, questionnaireRepo, config.guildId, userId, async () => {
			await service.recordStep(config, userId, 'questionnaire')
		})

	if (interaction.isChatInputCommand() && interaction.commandName === 'intro') {
		const config = resolveActiveConfig(guildConfig, interaction.guildId)
		if (!config) {
			await interaction.reply({ content: NOT_ACTIVE, flags: MessageFlags.Ephemeral })
			return
		}
		await advance(interaction, config)
		return
	}

	if (interaction.isChatInputCommand() && interaction.commandName === 'onboarding') {
		// Not an inline literal: `OnboardingCommandDeps` (onboarding.ts, Task 10)
		// doesn't declare `questionnaireRepo` yet, and TS's excess-property check
		// only fires on object literals passed directly at a call site — binding
		// first passes it through structurally without waiting on that task.
		const commandDeps = { guildConfig, repo, questionnaireRepo, service }
		await handleOnboardingCommand(interaction, commandDeps)
		return
	}

	if (interaction.isModalSubmit()) {
		const parsed = parseCustomId(interaction.customId)
		if (parsed?.action === 'question-modal' && parsed.value) {
			const config = resolveActiveConfig(guildConfig, interaction.guildId)
			if (!config) return

			const questionId = Number(parsed.value)
			const question = questionnaireRepo.getQuestionById(config.guildId, questionId)
			const textValue = interaction.fields.getTextInputValue(CUSTOM_IDS.questionAnswerInput)
			const trimmed = textValue.trim()

			if (question?.numericOnly && trimmed.length > 0 && !isValidNumericAnswer(trimmed)) {
				await interaction.reply({
					content: 'This question requires a number. Try again.',
					components: [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder()
								.setCustomId(CUSTOM_IDS.questionRetry(questionId))
								.setLabel('Try Again')
								.setStyle(ButtonStyle.Primary)
						)
					],
					flags: MessageFlags.Ephemeral
				})
				return
			}

			repo.saveAnswer(
				config.guildId,
				userId,
				questionId,
				{ textValue: textValue || null, selectedValues: [] },
				now()
			)
			await interaction.reply({ content: 'Answer saved.', flags: MessageFlags.Ephemeral })
			await advance(interaction, config)
			return
		}
	}

	if (interaction.isStringSelectMenu()) {
		const parsed = parseCustomId(interaction.customId)
		if (parsed?.action === 'question-select' && parsed.value) {
			const config = resolveActiveConfig(guildConfig, interaction.guildId)
			if (!config) return

			const questionId = Number(parsed.value)
			repo.saveAnswer(
				config.guildId,
				userId,
				questionId,
				{ textValue: null, selectedValues: [...interaction.values] },
				now()
			)
			await interaction.update({ content: 'Answer saved.', components: [] })
			await advance(interaction, config)
			return
		}
	}

	if (!interaction.isButton()) return

	const parsed = parseCustomId(interaction.customId)
	if (!parsed) return

	const config = resolveActiveConfig(guildConfig, interaction.guildId)
	if (!config) {
		await interaction.reply({ content: NOT_ACTIVE, flags: MessageFlags.Ephemeral })
		return
	}

	if (parsed.action === 'rules-agree') {
		await service.recordStep(config, userId, 'rules')
		// No reply() here on purpose. The next question may be a modal, and
		// showModal must be the first response to this interaction.
		await advance(interaction, config)
		return
	}

	if (parsed.action === 'question-skip' && parsed.value) {
		const questionId = Number(parsed.value)
		repo.saveAnswer(config.guildId, userId, questionId, { textValue: null, selectedValues: [] }, now())
		await interaction.update({ content: 'Skipped.', components: [] })
		await advance(interaction, config)
		return
	}

	if (parsed.action === 'question-retry' && parsed.value) {
		const questionId = Number(parsed.value)
		const question = questionnaireRepo.getQuestionById(config.guildId, questionId)
		// The question may have been removed or reconfigured since the error
		// was shown — nothing to reopen a modal for in that case.
		if (!question) return
		await interaction.showModal(buildQuestionModal(question))
	}
}
```

- [x] **Step 10: Run typecheck and the full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. No dedicated test file for the `interaction-create.ts` changes, matching the pre-existing convention for this file — the new logic that's actually testable (`isValidNumericAnswer`) is already covered by Step 1-4 above.

- [x] **Step 11: Commit**

```bash
git add src/core/questionnaire.ts tests/core/questionnaire.test.ts src/discord/components/custom-ids.ts tests/discord/custom-ids.test.ts src/discord/events/interaction-create.ts
git commit -m "validate numeric-only answers server-side with a Try Again retry flow"
```

---

### Task 5: Docs and final verification

**Files:**
- Modify: `README.md`
- Modify: `plans/00-overview.md`
- Modify: `PLAN.md`

**Interfaces:**
- None — documentation only.

- [x] **Step 1: Update README.md's command list**

In `README.md`, replace the `/config question add`/`edit` lines in the configuration commands block:

```
/config question add prompt:… type:… required:… options:… numeric:… min_length:… max_length:…   # add a questionnaire question
/config question edit position:… …                                                                # edit an existing question
```

- [x] **Step 2: Add a sentence on validation to the questionnaire paragraph**

In `README.md`, in the existing paragraph beginning "The onboarding questionnaire is fully admin-configurable via `/config question`…", append this sentence at the end:

> Text questions can additionally require digits-only answers and/or a character limit (`numeric`, `min_length`, `max_length` on `/config question add`/`edit`) — see [`docs/superpowers/specs/2026-08-11-questionnaire-answer-validation-design.md`](docs/superpowers/specs/2026-08-11-questionnaire-answer-validation-design.md).

- [x] **Step 3: Add an architecture decision to plans/00-overview.md**

In `plans/00-overview.md`, append to **Architecture Decisions**:

```
- 2026-08-11 — **Questionnaire answer validation.** Text-type questions can require numeric-only answers and/or a character limit. Character limits are enforced natively by Discord's modal text input; numeric-only has no native equivalent and is checked server-side, with a "Try Again" button reopening the modal on failure (Discord disallows responding to a modal submission with another modal). Requested directly by the user. See [[08-questionnaire-answer-validation]]
```

Add a row to **Module Plans**:

```
| [[08-questionnaire-answer-validation]] | 🟡 In Progress | —                                    |
```

- [x] **Step 4: Register the plan in PLAN.md**

Add a row to the **Phases & Sub-Plans** table:

```
| 08  | [plans/08-questionnaire-answer-validation](plans/08-questionnaire-answer-validation.md) | 🟡 In Progress | Numeric-only and character-limit validation for text questions |
```

Update the **Current Focus** section's opening line and checklist. Replace:

```
> **Plans 01–07 are all code-complete.**
```

with:

```
> **Plans 01–08 are all code-complete.**
```

and append a new bullet to the human-verification checklist:

```
> - Plan 08: Add a numeric-only question with a length limit via `/config question add`, and confirm both the character limit (rejected by Discord's own modal UI) and a non-numeric answer (rejected server-side with a Try Again button) behave as expected
```

Update the test count mentioned in the paragraph (`pnpm typecheck` and `pnpm test` both green) to the actual count after Task 4's implementation completes — run `pnpm test` and read the final summary line for the real number rather than guessing.

- [x] **Step 5: Run final verification**

Run: `pnpm typecheck && pnpm test`
Expected: PASS — clean typecheck, all tests green.

Run: `grep -rn "worker_threads" src/`
Expected: no matches (Hard Rule check, matching every prior plan's final verification).

- [x] **Step 6: Mark this plan's own frontmatter and checkboxes complete**

Set this file's frontmatter `status:` to `🟡 In Progress` (matching every other non-✅ plan in the project) and check off every `- [ ]` step above as `- [x]` once its work is actually done — don't do this as a batch at the end; check each box as you complete that step, per the project's `CLAUDE.md` convention ("Mark `[x]` as completed").

- [x] **Step 7: Commit**

```bash
git add README.md plans/00-overview.md PLAN.md plans/08-questionnaire-answer-validation.md
git commit -m "document questionnaire answer validation"
```
