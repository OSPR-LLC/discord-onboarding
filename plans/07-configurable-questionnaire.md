---
plan: configurable-questionnaire
project: discord-developer
updated: 2026-08-11
status: 🟡 In Progress
tags: [plan]
---

# 07 — Configurable Questionnaire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three hardcoded onboarding questions (purpose, experience, built-for-Discord) with a per-guild, admin-configurable question set — any number of questions (capped at 10), each free-text or select (single/multi), each independently required or optional, in an admin-defined order.

**Architecture:** Normalized question/option/answer tables replace the fixed-column `questionnaire_answers` table. A pure domain function (`nextUnansweredQuestion`) decides what to ask next from a guild's live question list and a member's current answers. Discord delivery stays one interaction per question (modal for text, select-menu-plus-optional-skip-button for choices), matching the platform's modal-is-text-only constraint.

**Tech Stack:** TypeScript strict, discord.js v14, better-sqlite3, Vitest — same as the rest of the project.

**Spec:** [`docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md`](../docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md)

## Global Constraints

- `src/discord/` is the only layer allowed to import discord.js. `src/core/` accepts only fully-resolved data, never loose ids. `src/db/` is the innermost layer — it must never import from `src/core/` or `src/discord/`. Shared types that both `src/db/` and `src/core/` need live in `src/types.ts` (a leaf module beside all three layers, not inside any of them), exactly like the existing `QuestionnaireAnswers`/`ExperienceLevel` types being replaced.
- **Deviation from the spec doc:** the spec's "Domain layer" section shows `QuestionType`/`QuestionOption`/`QuestionDefinition`/`QuestionAnswer` defined inside `src/core/questionnaire.ts`. Putting them there would make `src/db/questionnaire-repository.ts` import from `src/core/`, inverting the "dependencies point inward toward db" rule above. This plan instead places those four types in `src/types.ts` (Task 2) and has `src/core/questionnaire.ts` import them from there, same as `src/db/questionnaire-repository.ts` does. Same types, same API — only the file that hosts the type definitions changes.
- Every Discord write goes through the existing priority queue / `DiscordPort` — no task in this plan bypasses it.
- Prepare SQL once at repository construction, matching every existing repository in `src/db/`.
- 10 questions per guild, 25 options per question — hard caps enforced in `src/db/questionnaire-repository.ts` (Task 3).
- The migration in Task 1 is **destructive**: it drops the old fixed-column `questionnaire_answers` table and recreates it in the new normalized shape, discarding any rows in the old shape. Accepted in the design review — no guild has live production answer data yet.
- `guildId` is always the first parameter on every repository method, matching every existing repository.

---

### Task 1: Schema + destructive migration

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrate.ts`
- Modify: `tests/db/migrate.test.ts`

**Interfaces:**
- Produces: three new tables — `questionnaire_questions`, `questionnaire_question_options`, `questionnaire_answers` (replacing the old fixed-column `questionnaire_answers`). Later tasks depend on these exact column names.

- [x] **Step 1: Write the failing test**

Add to `tests/db/migrate.test.ts`:

```ts
it('replaces an old fixed-column questionnaire_answers table with the normalized shape', () => {
	// Simulates a database built before this feature: the old table had
	// purpose/experience_level/built_for_discord columns directly on it.
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
		CREATE TABLE questionnaire_answers (
			guild_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			purpose TEXT,
			experience_level TEXT,
			built_for_discord INTEGER,
			answered_at TEXT,
			PRIMARY KEY (guild_id, user_id)
		)
	`)
	db.prepare(
		"INSERT INTO onboarding (guild_id, user_id, first_joined_at, last_joined_at) VALUES ('g1', 'u1', 'now', 'now')"
	).run()
	db.prepare(
		"INSERT INTO questionnaire_answers (guild_id, user_id, purpose) VALUES ('g1', 'u1', 'old data')"
	).run()

	expect(() => migrate(db)).not.toThrow()

	const columns = (db.pragma('table_info(questionnaire_answers)') as { name: string }[]).map(
		(row) => row.name
	)
	expect(columns).toContain('question_id')
	expect(columns).toContain('text_value')
	expect(columns).toContain('selected_values')
	expect(columns).not.toContain('purpose')
	// The old row is gone — this is the accepted destructive part of the migration.
	expect(db.prepare('SELECT COUNT(*) AS n FROM questionnaire_answers').get()).toEqual({ n: 0 })
	// Unrelated tables and rows are untouched.
	expect(db.prepare('SELECT COUNT(*) AS n FROM onboarding').get()).toEqual({ n: 1 })
})

it('creates the question and option tables', () => {
	const db = createTestDb()
	const names = (
		db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
	).map((row) => row.name)

	expect(names).toContain('questionnaire_questions')
	expect(names).toContain('questionnaire_question_options')
})
```

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/db/migrate.test.ts`
Expected: FAIL — `questionnaire_questions`/`questionnaire_question_options` don't exist yet, and the old-shape table isn't dropped.

- [x] **Step 3: Replace the fixed-column table in schema.sql**

In `src/db/schema.sql`, replace the existing `questionnaire_answers` table definition with:

```sql
CREATE TABLE IF NOT EXISTS questionnaire_questions (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	guild_id    TEXT NOT NULL,
	position    INTEGER NOT NULL,
	prompt      TEXT NOT NULL,
	type        TEXT NOT NULL CHECK (type IN ('text','single_select','multi_select')),
	required    INTEGER NOT NULL DEFAULT 1,
	created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_questions_guild
	ON questionnaire_questions (guild_id, position);

CREATE TABLE IF NOT EXISTS questionnaire_question_options (
	question_id INTEGER NOT NULL REFERENCES questionnaire_questions(id) ON DELETE CASCADE,
	position    INTEGER NOT NULL,
	label       TEXT NOT NULL,
	value       TEXT NOT NULL,
	PRIMARY KEY (question_id, position)
);

CREATE TABLE IF NOT EXISTS questionnaire_answers (
	guild_id        TEXT NOT NULL,
	user_id         TEXT NOT NULL,
	question_id     INTEGER NOT NULL REFERENCES questionnaire_questions(id) ON DELETE CASCADE,
	text_value      TEXT,
	selected_values TEXT,
	answered_at     TEXT NOT NULL,
	PRIMARY KEY (guild_id, user_id, question_id),
	FOREIGN KEY (guild_id, user_id) REFERENCES onboarding(guild_id, user_id) ON DELETE CASCADE
);
```

- [x] **Step 4: Add the destructive drop to migrate.ts**

In `src/db/migrate.ts`, find the existing line `db.exec(readFileSync(schemaPath, 'utf8'))` (it sits right after the pragma setup) and replace that single line with this block — the block's last line is the same `db.exec(...)` call, just with the drop-check now running immediately before it:

```ts
	// The old questionnaire_answers had fixed purpose/experience_level/built_for_discord
	// columns. The configurable-questionnaire feature (2026-08-11) replaced it with a
	// normalized per-question table of the same name — CREATE TABLE IF NOT EXISTS is a
	// no-op against the old shape, so it has to be dropped first. This discards any rows
	// in the old shape; accepted because no guild had live production answer data when
	// this landed. See docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md.
	if (hasColumn(db, 'questionnaire_answers', 'purpose'))
		db.exec('DROP TABLE questionnaire_answers')

	db.exec(readFileSync(schemaPath, 'utf8'))
```

There should be exactly one `db.exec(readFileSync(schemaPath, 'utf8'))` call in the file after this edit, not two.

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm test tests/db/migrate.test.ts`
Expected: PASS — all migrate tests green, including the two new ones and the three pre-existing ones.

- [x] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (this task touches no TypeScript signatures other than the SQL string).

- [x] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/migrate.ts tests/db/migrate.test.ts
git commit -m "replace fixed-column questionnaire_answers with normalized question/option/answer tables"
```

---

### Task 2: Shared types + domain logic (`nextUnansweredQuestion`)

**Files:**
- Modify: `src/types.ts`
- Create: `src/core/questionnaire.ts`
- Create: `tests/core/questionnaire.test.ts`
- Delete: `src/discord/components/questionnaire.ts`'s `nextQuestion` (superseded — full file rewrite happens in Task 6)
- Delete: `tests/discord/questionnaire.test.ts` (superseded by `tests/core/questionnaire.test.ts` — this old file tests the `nextQuestion` function Task 6 removes)

**Interfaces:**
- Consumes: nothing new.
- Produces: `QuestionType`, `QuestionOption`, `QuestionDefinition`, `QuestionAnswer` (from `src/types.ts`); `nextUnansweredQuestion(questions, answers): QuestionDefinition | null` (from `src/core/questionnaire.ts`). Every later task imports these exact names.

- [x] **Step 1: Write the failing test**

Create `tests/core/questionnaire.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextUnansweredQuestion } from '../../src/core/questionnaire.js'
import type { QuestionAnswer, QuestionDefinition } from '../../src/types.js'

const textQuestion: QuestionDefinition = {
	id: 1,
	position: 1,
	prompt: 'What brings you here?',
	type: 'text',
	required: true,
	options: []
}

const selectQuestion: QuestionDefinition = {
	id: 2,
	position: 2,
	prompt: 'Pick one',
	type: 'single_select',
	required: false,
	options: [
		{ position: 1, label: 'A', value: 'a' },
		{ position: 2, label: 'B', value: 'b' }
	]
}

const answered = (questionId: number): QuestionAnswer => ({
	questionId,
	textValue: null,
	selectedValues: []
})

describe('nextUnansweredQuestion', () => {
	it('returns null for an empty question list', () => {
		expect(nextUnansweredQuestion([], [])).toBeNull()
	})

	it('returns the first question when nothing is answered', () => {
		expect(nextUnansweredQuestion([textQuestion, selectQuestion], [])).toEqual(textQuestion)
	})

	it('returns the next question once the first is answered', () => {
		expect(nextUnansweredQuestion([textQuestion, selectQuestion], [answered(1)])).toEqual(
			selectQuestion
		)
	})

	it('returns null once every question has an answer row, including skipped optional ones', () => {
		expect(
			nextUnansweredQuestion([textQuestion, selectQuestion], [answered(1), answered(2)])
		).toBeNull()
	})

	it('respects question order, not answer order', () => {
		expect(nextUnansweredQuestion([textQuestion, selectQuestion], [answered(2)])).toEqual(
			textQuestion
		)
	})
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/core/questionnaire.test.ts`
Expected: FAIL — `src/core/questionnaire.js` does not exist.

- [x] **Step 3: Add the shared types**

In `src/types.ts`, remove these three exports entirely (nothing outside this plan's later tasks references them once Tasks 3–10 land):

```ts
export const EXPERIENCE_LEVELS = {
	NEW: 'new-to-everything',
	SOME: 'a-little-experience',
	WRITES: 'writes-software',
	ADVANCED: 'advanced'
} as const

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[keyof typeof EXPERIENCE_LEVELS]
```

and:

```ts
export type QuestionnaireAnswers = {
	readonly guildId: string
	readonly userId: string
	readonly purpose: string | null
	readonly experienceLevel: ExperienceLevel | null
	readonly builtForDiscord: boolean | null
	readonly answeredAt: string | null
}
```

Add in their place:

```ts
export type QuestionType = 'text' | 'single_select' | 'multi_select'

export type QuestionOption = {
	readonly position: number
	readonly label: string
	readonly value: string
}

export type QuestionDefinition = {
	readonly id: number
	readonly position: number
	readonly prompt: string
	readonly type: QuestionType
	readonly required: boolean
	readonly options: readonly QuestionOption[]
}

export type QuestionAnswer = {
	readonly questionId: number
	readonly textValue: string | null
	readonly selectedValues: readonly string[]
}
```

- [x] **Step 4: Implement `nextUnansweredQuestion`**

Create `src/core/questionnaire.ts`:

```ts
import type { QuestionAnswer, QuestionDefinition } from '../types.js'

export const nextUnansweredQuestion = (
	questions: readonly QuestionDefinition[],
	answers: readonly QuestionAnswer[]
): QuestionDefinition | null => {
	const answeredIds = new Set(answers.map((answer) => answer.questionId))
	return questions.find((question) => !answeredIds.has(question.id)) ?? null
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/core/questionnaire.test.ts`
Expected: PASS

- [x] **Step 6: Delete the superseded test file**

`tests/discord/questionnaire.test.ts` tests the fixed `nextQuestion` function that Task 6 removes. Delete it now so the suite doesn't reference a soon-to-be-gone export in the meantime:

```bash
rm tests/discord/questionnaire.test.ts
```

(`src/discord/components/questionnaire.ts` itself is rewritten in Task 6, not this task — leave it as-is for now. `pnpm typecheck`/`pnpm test` will show pre-existing failures referencing the old types until Tasks 3–10 land; that's expected mid-plan and is resolved by Task 11's final full-suite run.)

- [x] **Step 7: Commit**

```bash
git add src/types.ts src/core/questionnaire.ts tests/core/questionnaire.test.ts
git rm tests/discord/questionnaire.test.ts
git commit -m "add configurable-question types and nextUnansweredQuestion domain logic"
```

---

### Task 3: Questionnaire repository (question CRUD)

**Files:**
- Create: `src/db/questionnaire-repository.ts`
- Create: `tests/db/questionnaire-repository.test.ts`

**Interfaces:**
- Consumes: `QuestionDefinition`, `QuestionOption`, `QuestionType` from `../types.js` (Task 2).
- Produces: `createQuestionnaireRepository(db)` returning `{ listQuestions, addQuestion, editQuestion, removeQuestion, moveQuestion, clearQuestions }`, and `slugifyOptionLabels(labels: string[]): { label: string; value: string }[]`. Task 9 (admin commands) and Task 7/8 (member-facing flow) both depend on this exact shape.

- [x] **Step 1: Write the failing test**

Create `tests/db/questionnaire-repository.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
	createQuestionnaireRepository,
	slugifyOptionLabels
} from '../../src/db/questionnaire-repository.js'
import { isOk } from '../../src/types.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const OTHER_GUILD = '923456789012345678'
const AT = '2026-08-11T10:00:00.000Z'

let repo: ReturnType<typeof createQuestionnaireRepository>

beforeEach(() => {
	repo = createQuestionnaireRepository(createTestDb())
})

describe('slugifyOptionLabels', () => {
	it('lowercases and hyphenates', () => {
		expect(slugifyOptionLabels(['New to everything'])).toEqual([
			{ label: 'New to everything', value: 'new-to-everything' }
		])
	})

	it('deduplicates identical labels with a numeric suffix', () => {
		expect(slugifyOptionLabels(['Yes', 'Yes'])).toEqual([
			{ label: 'Yes', value: 'yes' },
			{ label: 'Yes', value: 'yes-2' }
		])
	})
})

describe('addQuestion', () => {
	it('appends at the next position, starting at 1', () => {
		const first = repo.addQuestion(GUILD, { prompt: 'Q1', type: 'text', required: true, options: [] }, AT)
		const second = repo.addQuestion(GUILD, { prompt: 'Q2', type: 'text', required: true, options: [] }, AT)

		expect(isOk(first) && first.value.position).toBe(1)
		expect(isOk(second) && second.value.position).toBe(2)
	})

	it('stores slugified options for a select question', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Pick', type: 'single_select', required: true, options: ['New to everything', 'Advanced'] },
			AT
		)

		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.options).toEqual([
			{ position: 1, label: 'New to everything', value: 'new-to-everything' },
			{ position: 2, label: 'Advanced', value: 'advanced' }
		])
	})

	it('rejects a guild that already has 10 questions', () => {
		for (let i = 0; i < 10; i += 1)
			repo.addQuestion(GUILD, { prompt: `Q${i}`, type: 'text', required: true, options: [] }, AT)

		const result = repo.addQuestion(GUILD, { prompt: 'Q11', type: 'text', required: true, options: [] }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-questions')
	})

	it('rejects more than 25 options', () => {
		const options = Array.from({ length: 26 }, (_, i) => `Option ${i}`)
		const result = repo.addQuestion(GUILD, { prompt: 'Q', type: 'multi_select', required: true, options }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('keeps question counts and positions independent across guilds', () => {
		repo.addQuestion(GUILD, { prompt: 'Q1', type: 'text', required: true, options: [] }, AT)
		const otherFirst = repo.addQuestion(
			OTHER_GUILD,
			{ prompt: 'Other Q1', type: 'text', required: true, options: [] },
			AT
		)
		expect(isOk(otherFirst) && otherFirst.value.position).toBe(1)
	})
})

describe('listQuestions', () => {
	it('returns questions ordered by position', () => {
		repo.addQuestion(GUILD, { prompt: 'First', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'Second', type: 'text', required: true, options: [] }, AT)

		expect(repo.listQuestions(GUILD).map((q) => q.prompt)).toEqual(['First', 'Second'])
	})

	it('returns an empty array for a guild with no questions', () => {
		expect(repo.listQuestions(GUILD)).toEqual([])
	})
})

describe('editQuestion', () => {
	beforeEach(() => {
		repo.addQuestion(GUILD, { prompt: 'Original', type: 'text', required: true, options: [] }, AT)
	})

	it('updates only the supplied fields', () => {
		const result = repo.editQuestion(GUILD, 1, { required: false }, AT)
		expect(isOk(result) && result.value.required).toBe(false)
		expect(isOk(result) && result.value.prompt).toBe('Original')
	})

	it('replaces options when a new options list is supplied', () => {
		repo.editQuestion(GUILD, 1, { type: 'single_select', options: ['X', 'Y'] }, AT)
		const [question] = repo.listQuestions(GUILD)
		expect(question?.options.map((o) => o.label)).toEqual(['X', 'Y'])
	})

	it('reports not-found for an out-of-range position', () => {
		const result = repo.editQuestion(GUILD, 5, { required: false }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('not-found')
	})
})

describe('removeQuestion', () => {
	beforeEach(() => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'C', type: 'text', required: true, options: [] }, AT)
	})

	it('removes the question and renumbers the rest contiguously', () => {
		repo.removeQuestion(GUILD, 2)
		expect(repo.listQuestions(GUILD).map((q) => [q.position, q.prompt])).toEqual([
			[1, 'A'],
			[2, 'C']
		])
	})

	it('reports not-found for an out-of-range position', () => {
		const result = repo.removeQuestion(GUILD, 99)
		expect(isOk(result)).toBe(false)
	})
})

describe('moveQuestion', () => {
	beforeEach(() => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'C', type: 'text', required: true, options: [] }, AT)
	})

	it('moves a question to a new position, shifting the others', () => {
		repo.moveQuestion(GUILD, 1, 3)
		expect(repo.listQuestions(GUILD).map((q) => q.prompt)).toEqual(['B', 'C', 'A'])
	})

	it('reports invalid-position when the target is out of range', () => {
		const result = repo.moveQuestion(GUILD, 1, 99)
		expect(isOk(result)).toBe(false)
	})
})

describe('clearQuestions', () => {
	it('removes every question for the guild', () => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [] }, AT)
		repo.clearQuestions(GUILD)
		expect(repo.listQuestions(GUILD)).toEqual([])
	})

	it('leaves other guilds untouched', () => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(OTHER_GUILD, { prompt: 'B', type: 'text', required: true, options: [] }, AT)
		repo.clearQuestions(GUILD)
		expect(repo.listQuestions(OTHER_GUILD)).toHaveLength(1)
	})
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/db/questionnaire-repository.test.ts`
Expected: FAIL — `src/db/questionnaire-repository.js` does not exist.

- [x] **Step 3: Implement the repository**

Create `src/db/questionnaire-repository.ts`:

```ts
import type { Database } from 'better-sqlite3'
import { err, ok, type Result } from '../types.js'
import type { QuestionDefinition, QuestionOption, QuestionType } from '../types.js'

const MAX_QUESTIONS = 10
const MAX_OPTIONS = 25

export type NewQuestionInput = {
	prompt: string
	type: QuestionType
	required: boolean
	options: string[]
}

export type EditQuestionInput = Partial<NewQuestionInput>

export type AddEditError = 'too-many-questions' | 'too-many-options' | 'not-found'
export type MoveError = 'not-found' | 'invalid-position'

const slugifyOne = (label: string): string => {
	const slug = label
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return slug || 'option'
}

export const slugifyOptionLabels = (labels: string[]): { label: string; value: string }[] => {
	const seen = new Map<string, number>()
	return labels.map((label) => {
		const base = slugifyOne(label)
		const count = seen.get(base) ?? 0
		seen.set(base, count + 1)
		return { label, value: count === 0 ? base : `${base}-${count + 1}` }
	})
}

type QuestionRow = {
	id: number
	guild_id: string
	position: number
	prompt: string
	type: QuestionType
	required: number
	created_at: string
}

type OptionRow = {
	question_id: number
	position: number
	label: string
	value: string
}

export const createQuestionnaireRepository = (db: Database) => {
	// Compiled once at construction, matching every other repository in src/db/.
	const statements = {
		listQuestions: db.prepare(
			'SELECT * FROM questionnaire_questions WHERE guild_id = ? ORDER BY position'
		),
		countQuestions: db.prepare(
			'SELECT COUNT(*) AS n FROM questionnaire_questions WHERE guild_id = ?'
		),
		insertQuestion: db.prepare(
			`INSERT INTO questionnaire_questions (guild_id, position, prompt, type, required, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		),
		getQuestionAtPosition: db.prepare(
			'SELECT * FROM questionnaire_questions WHERE guild_id = ? AND position = ?'
		),
		updateQuestion: db.prepare(
			'UPDATE questionnaire_questions SET prompt = ?, type = ?, required = ? WHERE id = ?'
		),
		deleteQuestion: db.prepare('DELETE FROM questionnaire_questions WHERE id = ?'),
		shiftPositionsDown: db.prepare(
			'UPDATE questionnaire_questions SET position = position - 1 WHERE guild_id = ? AND position > ?'
		),
		setPosition: db.prepare('UPDATE questionnaire_questions SET position = ? WHERE id = ?'),
		clearQuestions: db.prepare('DELETE FROM questionnaire_questions WHERE guild_id = ?'),
		listOptions: db.prepare(
			'SELECT * FROM questionnaire_question_options WHERE question_id = ? ORDER BY position'
		),
		insertOption: db.prepare(
			'INSERT INTO questionnaire_question_options (question_id, position, label, value) VALUES (?, ?, ?, ?)'
		),
		deleteOptions: db.prepare('DELETE FROM questionnaire_question_options WHERE question_id = ?')
	}

	const toDefinition = (row: QuestionRow): QuestionDefinition => ({
		id: row.id,
		position: row.position,
		prompt: row.prompt,
		type: row.type,
		required: row.required === 1,
		options: (statements.listOptions.all(row.id) as OptionRow[]).map(
			(option): QuestionOption => ({
				position: option.position,
				label: option.label,
				value: option.value
			})
		)
	})

	const insertOptions = (questionId: number, labels: string[]): void => {
		slugifyOptionLabels(labels).forEach((option, index) => {
			statements.insertOption.run(questionId, index + 1, option.label, option.value)
		})
	}

	const listQuestions = (guildId: string): QuestionDefinition[] =>
		(statements.listQuestions.all(guildId) as QuestionRow[]).map(toDefinition)

	const addQuestion = (
		guildId: string,
		input: NewQuestionInput,
		createdAt: string
	): Result<QuestionDefinition, AddEditError> => {
		const count = (statements.countQuestions.get(guildId) as { n: number }).n
		if (count >= MAX_QUESTIONS) return err('too-many-questions')
		if (input.options.length > MAX_OPTIONS) return err('too-many-options')

		const position = count + 1
		const info = statements.insertQuestion.run(
			guildId,
			position,
			input.prompt,
			input.type,
			input.required ? 1 : 0,
			createdAt
		)
		const questionId = Number(info.lastInsertRowid)
		if (input.options.length > 0) insertOptions(questionId, input.options)

		return ok(toDefinition(statements.getQuestionAtPosition.get(guildId, position) as QuestionRow))
	}

	const editQuestion = (
		guildId: string,
		position: number,
		patch: EditQuestionInput,
		_editedAt: string
	): Result<QuestionDefinition, AddEditError> => {
		const row = statements.getQuestionAtPosition.get(guildId, position) as QuestionRow | undefined
		if (!row) return err('not-found')
		if (patch.options && patch.options.length > MAX_OPTIONS) return err('too-many-options')

		statements.updateQuestion.run(
			patch.prompt ?? row.prompt,
			patch.type ?? row.type,
			(patch.required ?? row.required === 1) ? 1 : 0,
			row.id
		)

		if (patch.options) {
			statements.deleteOptions.run(row.id)
			insertOptions(row.id, patch.options)
		}

		return ok(toDefinition(statements.getQuestionAtPosition.get(guildId, position) as QuestionRow))
	}

	const removeQuestion = (guildId: string, position: number): Result<void, AddEditError> => {
		const row = statements.getQuestionAtPosition.get(guildId, position) as QuestionRow | undefined
		if (!row) return err('not-found')

		statements.deleteQuestion.run(row.id)
		statements.shiftPositionsDown.run(guildId, position)
		return ok(undefined)
	}

	const moveQuestion = (
		guildId: string,
		fromPosition: number,
		toPosition: number
	): Result<void, MoveError> => {
		const questions = listQuestions(guildId)
		const fromIndex = fromPosition - 1
		const toIndex = toPosition - 1
		if (fromIndex < 0 || fromIndex >= questions.length) return err('not-found')
		if (toIndex < 0 || toIndex >= questions.length) return err('invalid-position')

		const reordered = [...questions]
		const [moved] = reordered.splice(fromIndex, 1)
		if (!moved) return err('not-found')
		reordered.splice(toIndex, 0, moved)

		reordered.forEach((question, index) => {
			statements.setPosition.run(index + 1, question.id)
		})

		return ok(undefined)
	}

	const clearQuestions = (guildId: string): void => {
		statements.clearQuestions.run(guildId)
	}

	return { listQuestions, addQuestion, editQuestion, removeQuestion, moveQuestion, clearQuestions }
}

export type QuestionnaireRepository = ReturnType<typeof createQuestionnaireRepository>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/db/questionnaire-repository.test.ts`
Expected: PASS

- [x] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors from this file (other files still mid-migration will still error until Task 11 — that's expected, see Task 2 Step 6 note).

- [x] **Step 6: Commit**

```bash
git add src/db/questionnaire-repository.ts tests/db/questionnaire-repository.test.ts
git commit -m "add questionnaire-repository for admin-configured question CRUD"
```

---

### Task 4: Rewrite onboarding-repository answer storage + onboarding-service audit detail

**Files:**
- Modify: `src/db/onboarding-repository.ts`
- Modify: `tests/db/onboarding-repository.test.ts`
- Modify: `src/core/onboarding-service.ts`
- Modify: `tests/core/onboarding-service.test.ts`
- Modify: `tests/load/onboarding-load.test.ts`

**Interfaces:**
- Consumes: `QuestionAnswer` from `../types.js` (Task 2); `createQuestionnaireRepository` from `../db/questionnaire-repository.js` (Task 3, tests only).
- Produces: `repo.getAnswers(guildId, userId): QuestionAnswer[]` (was a single nullable object, now an array); `repo.saveAnswer(guildId, userId, questionId, answer, at): void` (was a patch object, now one full answer per question). Tasks 7 and 8 call these exact signatures.

- [x] **Step 1: Write the failing test**

Replace the `saveAnswer` and `guild isolation` answer-related tests in `tests/db/onboarding-repository.test.ts`. Replace the two answer-related lines inside `describe('guild isolation', ...)`:

```ts
	it('keeps answers separate for the same user in two guilds', () => {
		repo.saveAnswer(GUILD, USER, 1, { textValue: 'here for the code', selectedValues: [] }, '2026-08-10T11:00:00.000Z')
		expect(repo.getAnswers(GUILD, USER)).toEqual([
			{ questionId: 1, textValue: 'here for the code', selectedValues: [] }
		])
		expect(repo.getAnswers(OTHER_GUILD, USER)).toEqual([])
	})
```

Replace the entire `describe('saveAnswer', ...)` block with:

```ts
describe('saveAnswer', () => {
	beforeEach(() => repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z'))

	it('stores a text answer for a question', () => {
		repo.saveAnswer(GUILD, USER, 1, { textValue: 'learning backend', selectedValues: [] }, '2026-08-10T11:00:00.000Z')
		expect(repo.getAnswers(GUILD, USER)).toEqual([
			{ questionId: 1, textValue: 'learning backend', selectedValues: [] }
		])
	})

	it('stores a select answer for a question', () => {
		repo.saveAnswer(GUILD, USER, 2, { textValue: null, selectedValues: ['a', 'b'] }, '2026-08-10T11:00:00.000Z')
		expect(repo.getAnswers(GUILD, USER)).toEqual([
			{ questionId: 2, textValue: null, selectedValues: ['a', 'b'] }
		])
	})

	it('accumulates answers to different questions', () => {
		repo.saveAnswer(GUILD, USER, 1, { textValue: 'a', selectedValues: [] }, '2026-08-10T11:00:00.000Z')
		repo.saveAnswer(GUILD, USER, 2, { textValue: 'b', selectedValues: [] }, '2026-08-10T11:01:00.000Z')
		expect(repo.getAnswers(GUILD, USER)).toHaveLength(2)
	})

	it('overwrites a previously given answer to the same question', () => {
		repo.saveAnswer(GUILD, USER, 1, { textValue: 'first', selectedValues: [] }, '2026-08-10T11:00:00.000Z')
		repo.saveAnswer(GUILD, USER, 1, { textValue: 'second', selectedValues: [] }, '2026-08-10T11:05:00.000Z')
		expect(repo.getAnswers(GUILD, USER)).toEqual([
			{ questionId: 1, textValue: 'second', selectedValues: [] }
		])
	})
})
```

Note: `saveAnswer` now references `question_id`, which has a foreign key to `questionnaire_questions.id`. These tests run against `createTestDb()` with `foreign_keys = ON` (set in `migrate.ts`) but never insert a matching row in `questionnaire_questions` — SQLite only enforces a foreign key when the referenced table exists and the pragma is on, so an insert against a non-existent `question_id` **will fail** unless a matching question row exists. Because this test file only exercises `onboarding-repository.ts` in isolation, insert a throwaway question row directly in each `saveAnswer` test's `beforeEach` (or right before the assertion) with:

```ts
db.prepare(
	`INSERT INTO questionnaire_questions (id, guild_id, position, prompt, type, required, created_at)
	 VALUES (1, ?, 1, 'Q1', 'text', 1, '2026-08-10T00:00:00.000Z'),
	        (2, ?, 2, 'Q2', 'text', 1, '2026-08-10T00:00:00.000Z')`
).run(GUILD, GUILD)
```

Restructure the top of the file so `db` is available to this insert: change

```ts
let repo: ReturnType<typeof createOnboardingRepository>

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
})
```

to

```ts
let db: ReturnType<typeof createTestDb>
let repo: ReturnType<typeof createOnboardingRepository>

beforeEach(() => {
	db = createTestDb()
	repo = createOnboardingRepository(db)
})
```

and add the throwaway-question insert as a `beforeEach` inside both `describe('guild isolation', ...)` and `describe('saveAnswer', ...)`, seeding for both `GUILD` and `OTHER_GUILD` in the isolation block (question ids 1 and 2 respectively, so each guild's answer references a question that actually belongs to it — semantically correct, not just FK-satisfying):

```ts
	beforeEach(() => {
		db.prepare(
			`INSERT INTO questionnaire_questions (id, guild_id, position, prompt, type, required, created_at)
			 VALUES (1, ?, 1, 'Q1', 'text', 1, '2026-08-10T00:00:00.000Z')`
		).run(GUILD)
	})
```

(adjust the guild id / question id per describe block as shown above).

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/db/onboarding-repository.test.ts`
Expected: FAIL — `saveAnswer`/`getAnswers` still have the old patch-object signature.

- [x] **Step 3: Rewrite the repository's answer handling**

In `src/db/onboarding-repository.ts`:

Replace the imports:

```ts
import type { Database, Statement } from 'better-sqlite3'
import type { OnboardingRecord, OnboardingStep, QuestionAnswer } from '../types.js'
```

Replace `AnswerRow` and `AnswerPatch`:

```ts
type AnswerRow = {
	guild_id: string
	user_id: string
	question_id: number
	text_value: string | null
	selected_values: string | null
	answered_at: string
}

export type AnswerInput = {
	textValue: string | null
	selectedValues: string[]
}
```

Replace `toAnswers`:

```ts
const toAnswer = (row: AnswerRow): QuestionAnswer => ({
	questionId: row.question_id,
	textValue: row.text_value,
	selectedValues: row.selected_values ? (JSON.parse(row.selected_values) as string[]) : []
})
```

Replace the `getAnswers`/`deleteAnswers`/`insertAnswers`/`setPurpose`/`setExperience`/`setBuilt`/`stampAnsweredAt`/`stampQuestionnaireComplete` statements with:

```ts
		getAnswers: db.prepare(
			'SELECT * FROM questionnaire_answers WHERE guild_id = ? AND user_id = ?'
		),
		deleteAnswers: db.prepare(
			'DELETE FROM questionnaire_answers WHERE guild_id = ? AND user_id = ?'
		),
		upsertAnswer: db.prepare(
			`INSERT INTO questionnaire_answers (guild_id, user_id, question_id, text_value, selected_values, answered_at)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(guild_id, user_id, question_id) DO UPDATE SET
			   text_value = excluded.text_value,
			   selected_values = excluded.selected_values,
			   answered_at = excluded.answered_at`
		),
```

(remove the old `setPurpose`/`setExperience`/`setBuilt`/`stampAnsweredAt`/`stampQuestionnaireComplete`/`insertAnswers` statements — completion is no longer decided inside this repository; see Task 7/8, which call the existing generic `stampStep(guildId, userId, 'questionnaire', at)` explicitly once `nextUnansweredQuestion` returns `null`).

Replace `getAnswers`:

```ts
	const getAnswers = (guildId: string, userId: string): QuestionAnswer[] =>
		(statements.getAnswers.all(guildId, userId) as AnswerRow[]).map(toAnswer)
```

Replace `saveAnswerTx` and the exported `saveAnswer`:

```ts
	const saveAnswerTx = db.transaction(
		(guildId: string, userId: string, questionId: number, answer: AnswerInput, at: string) => {
			// The member must have a record before answers can reference it.
			upsertOnJoin(guildId, userId, at)
			statements.upsertAnswer.run(
				guildId,
				userId,
				questionId,
				answer.textValue,
				answer.selectedValues.length > 0 ? JSON.stringify(answer.selectedValues) : null,
				at
			)
		}
	)
```

and in the returned object:

```ts
		saveAnswer: (
			guildId: string,
			userId: string,
			questionId: number,
			answer: AnswerInput,
			at: string
		): void => {
			saveAnswerTx(guildId, userId, questionId, answer, at)
		},
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/db/onboarding-repository.test.ts`
Expected: PASS

- [x] **Step 5: Fix the audit-detail formatting in onboarding-service.ts**

In `src/core/onboarding-service.ts`, replace:

```ts
		const answers = repo.getAnswers(config.guildId, record.userId)
		await port.postAudit(config.guildId, config.modLogChannelId, {
			kind: 'verified',
			userId: record.userId,
			detail: answers
				? `purpose="${answers.purpose ?? ''}" · experience=${answers.experienceLevel ?? 'unknown'} · builtForDiscord=${String(answers.builtForDiscord)}`
				: 'verified with no stored answers'
		})
```

with:

```ts
		const answers = repo.getAnswers(config.guildId, record.userId)
		await port.postAudit(config.guildId, config.modLogChannelId, {
			kind: 'verified',
			userId: record.userId,
			detail:
				answers.length > 0
					? answers
							.map((a) => `q${a.questionId}=${a.textValue ?? `[${a.selectedValues.join(', ')}]`}`)
							.join(' · ')
					: 'verified with no stored answers'
		})
```

(This deliberately doesn't look up question prompts — that would require threading `questionnaireRepo` into `ServiceDeps` for a cosmetic audit-log improvement. `/onboarding status`, Task 10, already shows full prompt text and answers for a mod who needs the detail.)

- [x] **Step 6: Update onboarding-service.test.ts**

Replace the imports:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { createQuestionnaireRepository } from '../../src/db/questionnaire-repository.js'
import { isOk } from '../../src/types.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'
```

Change the `beforeEach` to build both repositories against the same database and seed one text question, capturing its id for `completeAllSteps`:

```ts
let repo: ReturnType<typeof createOnboardingRepository>
let questionId: number
let fake: ReturnType<typeof createFakeDiscordPort>
let service: ReturnType<typeof createOnboardingService>

beforeEach(() => {
	const db = createTestDb()
	repo = createOnboardingRepository(db)
	const questionnaireRepo = createQuestionnaireRepository(db)
	const created = questionnaireRepo.addQuestion(
		GUILD,
		{ prompt: 'Why are you here?', type: 'text', required: true, options: [] },
		CLOCK
	)
	questionId = isOk(created) ? created.value.id : (() => {
		throw new Error('seed question failed')
	})()
	fake = createFakeDiscordPort()
	service = createOnboardingService({ repo, port: fake.port, now: () => CLOCK })
})

const completeAllSteps = async () => {
	await service.recordStep(config, USER, 'rules')
	repo.saveAnswer(GUILD, USER, questionId, { textValue: 'learning', selectedValues: [] }, CLOCK)
	await service.recordStep(config, USER, 'questionnaire')
	return service.recordStep(config, USER, 'intro')
}
```

Update the one other `saveAnswer` call site (inside the `'accepts steps in any order'` test):

```ts
	it('accepts steps in any order', async () => {
		await service.recordStep(config, USER, 'intro')
		repo.saveAnswer(GUILD, USER, questionId, { textValue: 'p', selectedValues: [] }, CLOCK)
		await service.recordStep(config, USER, 'questionnaire')
		expect(await service.recordStep(config, USER, 'rules')).toBe('grant')
	})
```

- [x] **Step 7: Update tests/load/onboarding-load.test.ts**

Replace the `EXPERIENCE_LEVELS` import with `createQuestionnaireRepository` and `isOk`:

```ts
import { describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { createCachedGuildConfigRepository } from '../../src/db/cached-guild-config-repository.js'
import { createGuildConfigRepository } from '../../src/db/guild-config-repository.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { createQuestionnaireRepository } from '../../src/db/questionnaire-repository.js'
import { isOk } from '../../src/types.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'
```

Inside the load test, seed one question per guild before the user loop and use its id in `saveAnswer`:

```ts
			for (let guildIndex = 0; guildIndex < 50; guildIndex += 1) {
				const config = configFor(`guild-${guildIndex}`)
				const created = questionnaireRepo.addQuestion(
					config.guildId,
					{ prompt: 'Why are you here?', type: 'text', required: true, options: [] },
					AT
				)
				const questionId = isOk(created) ? created.value.id : -1

				for (let userIndex = 0; userIndex < 100; userIndex += 1) {
					const userId = `user-${userIndex}`
					await service.handleJoin(config, userId, Date.parse(AT))
					await service.recordStep(config, userId, 'rules')
					repo.saveAnswer(config.guildId, userId, questionId, { textValue: 'load test', selectedValues: [] }, AT)
					await service.recordStep(config, userId, 'questionnaire')
					await service.recordStep(config, userId, 'intro')
				}
			}
```

and construct `questionnaireRepo` alongside `repo` at the top of the test:

```ts
			const db = createTestDb()
			const repo = createOnboardingRepository(db)
			const questionnaireRepo = createQuestionnaireRepository(db)
```

(remove the now-unused `createTestDb()` call inside `service`'s construction line if it duplicated — `service` should be built from the same `repo`.)

- [x] **Step 8: Run the full test suite for this task's files**

Run: `pnpm test tests/db/onboarding-repository.test.ts tests/core/onboarding-service.test.ts tests/load/onboarding-load.test.ts`
Expected: PASS across all three files.

- [x] **Step 9: Typecheck**

Run: `pnpm typecheck`
Expected: errors remaining only in files not yet touched (`src/discord/components/questionnaire.ts`, `src/discord/commands/intro.ts`, `src/discord/events/interaction-create.ts`, `src/discord/commands/onboarding.ts`) — those are Tasks 5–10.

- [x] **Step 10: Commit**

```bash
git add src/db/onboarding-repository.ts src/core/onboarding-service.ts tests/db/onboarding-repository.test.ts tests/core/onboarding-service.test.ts tests/load/onboarding-load.test.ts
git commit -m "store questionnaire answers per-question instead of fixed columns"
```

---

### Task 5: Dynamic custom IDs

**Files:**
- Modify: `src/discord/components/custom-ids.ts`
- Modify: `tests/discord/custom-ids.test.ts`

**Interfaces:**
- Produces: `CUSTOM_IDS.questionAnswerInput` (fixed string), `CUSTOM_IDS.questionModal(id)`, `CUSTOM_IDS.questionSelect(id)`, `CUSTOM_IDS.questionSkip(id)` (functions). Tasks 6, 7, 8 depend on these names.

- [x] **Step 1: Write the failing test**

Add to `tests/discord/custom-ids.test.ts`:

```ts
describe('dynamic question custom ids', () => {
	it('builds a parseable modal id for a question', () => {
		expect(parseCustomId(CUSTOM_IDS.questionModal(42))).toEqual({
			namespace: 'onboarding',
			action: 'question-modal',
			value: '42'
		})
	})

	it('builds a parseable select id for a question', () => {
		expect(parseCustomId(CUSTOM_IDS.questionSelect(7))).toEqual({
			namespace: 'onboarding',
			action: 'question-select',
			value: '7'
		})
	})

	it('builds a parseable skip id for a question', () => {
		expect(parseCustomId(CUSTOM_IDS.questionSkip(7))).toEqual({
			namespace: 'onboarding',
			action: 'question-skip',
			value: '7'
		})
	})
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/discord/custom-ids.test.ts`
Expected: FAIL — `CUSTOM_IDS.questionModal` etc. don't exist.

- [x] **Step 3: Add the dynamic id builders**

In `src/discord/components/custom-ids.ts`, replace the fixed `purposeModal`/`purposeInput`/`experienceSelect`/`builtYes`/`builtNo` entries with:

```ts
export const CUSTOM_IDS = {
	rulesAgree: `${NAMESPACE}:rules-agree`,
	questionAnswerInput: `${NAMESPACE}:question-answer`,
	questionModal: (questionId: number) => `${NAMESPACE}:question-modal:${questionId}`,
	questionSelect: (questionId: number) => `${NAMESPACE}:question-select:${questionId}`,
	questionSkip: (questionId: number) => `${NAMESPACE}:question-skip:${questionId}`,
	rulesTextModal: `${NAMESPACE}:rules-text-modal`,
	rulesTextInput: `${NAMESPACE}:rules-text-input`,
	introTemplateModal: `${NAMESPACE}:intro-template-modal`,
	introTemplateInput: `${NAMESPACE}:intro-template-input`
} as const
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/discord/custom-ids.test.ts`
Expected: PASS

- [x] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: new errors appear in `src/discord/components/questionnaire.ts` (still references the removed `purposeModal`/`experienceSelect`/etc.) — expected, fixed in Task 6.

- [x] **Step 6: Commit**

```bash
git add src/discord/components/custom-ids.ts tests/discord/custom-ids.test.ts
git commit -m "add dynamic custom ids for admin-configured questions"
```

---

### Task 6: Dynamic question component builders

**Files:**
- Modify: `src/discord/components/questionnaire.ts` (full rewrite)
- Create: `tests/discord/questionnaire.test.ts` (new content — the old file was deleted in Task 2)

**Interfaces:**
- Consumes: `QuestionDefinition` from `../../types.js` (Task 2); `CUSTOM_IDS` from `./custom-ids.js` (Task 5).
- Produces: `buildQuestionModal(question)`, `buildQuestionSelectRow(question)`, `buildQuestionSkipRow(question)`. Task 7 calls these.

- [x] **Step 1: Write the failing test**

Create `tests/discord/questionnaire.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
	buildQuestionModal,
	buildQuestionSelectRow,
	buildQuestionSkipRow
} from '../../src/discord/components/questionnaire.js'
import type { QuestionDefinition } from '../../src/types.js'

const textQuestion: QuestionDefinition = {
	id: 1,
	position: 1,
	prompt: 'What brings you here?',
	type: 'text',
	required: true,
	options: []
}

const optionalSelect: QuestionDefinition = {
	id: 2,
	position: 2,
	prompt: 'Pick one',
	type: 'single_select',
	required: false,
	options: [
		{ position: 1, label: 'A', value: 'a' },
		{ position: 2, label: 'B', value: 'b' }
	]
}

const requiredMultiSelect: QuestionDefinition = {
	...optionalSelect,
	id: 3,
	type: 'multi_select',
	required: true
}

describe('buildQuestionModal', () => {
	it('builds a modal whose custom id encodes the question id', () => {
		const modal = buildQuestionModal(textQuestion)
		expect(modal.data.custom_id).toBe('onboarding:question-modal:1')
	})
})

describe('buildQuestionSelectRow', () => {
	it('caps maxValues at 1 for a single-select question', () => {
		const row = buildQuestionSelectRow(optionalSelect)
		const select = row.components[0]
		expect(select?.data.custom_id).toBe('onboarding:question-select:2')
		expect(select?.data.max_values).toBe(1)
		expect(select?.data.min_values).toBe(0)
	})

	it('caps maxValues at the option count for a multi-select question', () => {
		const row = buildQuestionSelectRow(requiredMultiSelect)
		const select = row.components[0]
		expect(select?.data.max_values).toBe(2)
		expect(select?.data.min_values).toBe(1)
	})
})

describe('buildQuestionSkipRow', () => {
	it('returns null for a required question', () => {
		expect(buildQuestionSkipRow(requiredMultiSelect)).toBeNull()
	})

	it('returns a skip button row for an optional question', () => {
		const row = buildQuestionSkipRow(optionalSelect)
		expect(row?.components[0]?.data.custom_id).toBe('onboarding:question-skip:2')
	})
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/discord/questionnaire.test.ts`
Expected: FAIL — the current file still exports the old fixed builders, not these.

- [x] **Step 3: Rewrite the component builders**

Replace the entire contents of `src/discord/components/questionnaire.ts`:

```ts
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle
} from 'discord.js'
import type { QuestionDefinition } from '../../types.js'
import { CUSTOM_IDS } from './custom-ids.js'

export const buildQuestionModal = (question: QuestionDefinition): ModalBuilder =>
	new ModalBuilder()
		.setCustomId(CUSTOM_IDS.questionModal(question.id))
		.setTitle(question.prompt.slice(0, 45))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId(CUSTOM_IDS.questionAnswerInput)
					.setLabel(question.prompt.slice(0, 45))
					.setStyle(TextInputStyle.Paragraph)
					.setMaxLength(1000)
					.setRequired(question.required)
			)
		)

export const buildQuestionSelectRow = (
	question: QuestionDefinition
): ActionRowBuilder<StringSelectMenuBuilder> =>
	new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId(CUSTOM_IDS.questionSelect(question.id))
			.setPlaceholder('Pick your answer')
			.setMinValues(question.required ? 1 : 0)
			.setMaxValues(question.type === 'multi_select' ? question.options.length : 1)
			.addOptions(question.options.map((option) => ({ label: option.label, value: option.value })))
	)

export const buildQuestionSkipRow = (
	question: QuestionDefinition
): ActionRowBuilder<ButtonBuilder> | null => {
	if (question.required) return null

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(CUSTOM_IDS.questionSkip(question.id))
			.setLabel('Skip')
			.setStyle(ButtonStyle.Secondary)
	)
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/discord/questionnaire.test.ts`
Expected: PASS

- [x] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: errors remain in `src/discord/commands/intro.ts` and `src/discord/events/interaction-create.ts` (still call the old builder names) — fixed in Tasks 7–8.

- [x] **Step 6: Commit**

```bash
git add src/discord/components/questionnaire.ts tests/discord/questionnaire.test.ts
git commit -m "rewrite questionnaire component builders for dynamic questions"
```

---

### Task 7: Rewrite `promptNextQuestion` for dynamic questions

**Files:**
- Modify: `src/discord/commands/intro.ts`

**Interfaces:**
- Consumes: `nextUnansweredQuestion` (Task 2), `buildQuestionModal`/`buildQuestionSelectRow`/`buildQuestionSkipRow` (Task 6), `QuestionnaireRepository` (Task 3), `OnboardingRepository.getAnswers` (Task 4).
- Produces: `promptNextQuestion(interaction, repo, questionnaireRepo, guildId, userId, onComplete)` — Task 8 calls this with one new parameter (`questionnaireRepo`) and a completion callback.

No dedicated test file for this task, matching the existing project convention already established for `intro.ts` (thin Discord-orchestration code — the meaningful logic it calls, `nextUnansweredQuestion`, is already unit tested in Task 2). Verified by `pnpm typecheck` plus the full suite in Task 11.

- [x] **Step 1: Rewrite `promptNextQuestion`**

Replace the entire contents of `src/discord/commands/intro.ts`:

```ts
import {
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	type MessageComponentInteraction,
	type ModalSubmitInteraction
} from 'discord.js'
import { nextUnansweredQuestion } from '../../core/questionnaire.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import {
	buildQuestionModal,
	buildQuestionSelectRow,
	buildQuestionSkipRow
} from '../components/questionnaire.js'

export const introCommand = new SlashCommandBuilder()
	.setName('intro')
	.setDescription('Start or resume the introduction questionnaire')
	.setDMPermission(false)

export type PromptableInteraction =
	ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction

export const promptNextQuestion = async (
	interaction: PromptableInteraction,
	repo: OnboardingRepository,
	questionnaireRepo: QuestionnaireRepository,
	guildId: string,
	userId: string,
	onComplete: () => Promise<void>
): Promise<void> => {
	const questions = questionnaireRepo.listQuestions(guildId)
	const answers = repo.getAnswers(guildId, userId)
	const next = nextUnansweredQuestion(questions, answers)

	if (!next) {
		// Stamping completion lives here, not in each caller, because this is the
		// only place that knows "nothing left to answer" — including the guild
		// having zero configured questions, where no answer-saving branch ever
		// runs to trigger it otherwise. `recordStep` is idempotent (COALESCE), so
		// calling it on every re-entry (e.g. a repeat /intro) is harmless.
		await onComplete()

		const payload = {
			content:
				'All questions answered. The last step is to introduce yourself in the introductions channel.',
			components: []
		}
		if (interaction.replied || interaction.deferred)
			await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
		else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
		return
	}

	const position = `**${next.position} of ${questions.length}**`

	if (next.type === 'text') {
		// showModal must be the FIRST response to an interaction — it cannot
		// follow reply() or update(). Anything already replied to can only be
		// pointed at /intro, which arrives as a fresh interaction.
		if (!interaction.replied && !interaction.deferred && !interaction.isModalSubmit()) {
			await interaction.showModal(buildQuestionModal(next))
			return
		}

		await interaction.followUp({
			content: `Run \`/intro\` to answer ${position} — ${next.prompt}`,
			flags: MessageFlags.Ephemeral
		})
		return
	}

	const skipRow = buildQuestionSkipRow(next)
	const payload = {
		content: `${position} — ${next.prompt}`,
		components: skipRow ? [buildQuestionSelectRow(next), skipRow] : [buildQuestionSelectRow(next)]
	}

	if (interaction.replied || interaction.deferred)
		await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
	else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
}
```

- [x] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: errors remain only in `src/discord/events/interaction-create.ts` (still calls `promptNextQuestion` with the old 4-argument signature and references the removed `nextQuestion`/old custom ids) — fixed in Task 8.

- [x] **Step 3: Commit**

```bash
git add src/discord/commands/intro.ts
git commit -m "rewrite promptNextQuestion to walk the guild's configured question list"
```

---

### Task 8: Rewrite interaction routing for dynamic questions

**Files:**
- Modify: `src/discord/events/interaction-create.ts`
- Modify: `src/index.ts` (thread `questionnaireRepo` into `onboardingDeps`)

**Interfaces:**
- Consumes: `promptNextQuestion` (Task 7, new signature), `parseCustomId` (existing), `CUSTOM_IDS.questionAnswerInput`/`questionModal`/`questionSelect`/`questionSkip` (Task 5), `QuestionnaireRepository` (Task 3).
- Produces: `OnboardingInteractionDeps` gains a `questionnaireRepo: QuestionnaireRepository` field — this is a breaking change to the type, so every construction site must be updated (this task updates `src/index.ts`'s `onboardingDeps` literal, the only construction site outside tests).

No dedicated test file, matching the existing convention for this file (thin Discord-orchestration/routing code; the logic it delegates to is unit tested elsewhere). Verified by `pnpm typecheck` plus the full suite in Task 11.

- [x] **Step 1: Rewrite the questionnaire-interaction branches**

In `src/discord/events/interaction-create.ts`, replace the imports:

```ts
import { MessageFlags, type Interaction } from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import { promptNextQuestion, type PromptableInteraction } from '../commands/intro.js'
import { handleOnboardingCommand } from '../commands/onboarding.js'
import { CUSTOM_IDS, parseCustomId } from '../components/custom-ids.js'
import { resolveActiveConfig } from '../resolve-active-config.js'
```

Replace `OnboardingInteractionDeps`:

```ts
export type OnboardingInteractionDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly service: OnboardingService
	readonly now: () => string
}
```

Replace the body of `handleOnboardingInteraction` from the `/intro` branch onward — the modal/select/button handling for questions becomes one shared completion-check helper plus three thin dispatchers:

```ts
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
		await handleOnboardingCommand(interaction, { guildConfig, repo, questionnaireRepo, service })
		return
	}

	if (interaction.isModalSubmit()) {
		const parsed = parseCustomId(interaction.customId)
		if (parsed?.action === 'question-modal' && parsed.value) {
			const config = resolveActiveConfig(guildConfig, interaction.guildId)
			if (!config) return

			const questionId = Number(parsed.value)
			const textValue = interaction.fields.getTextInputValue(CUSTOM_IDS.questionAnswerInput)
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
	}
}
```

`advance`'s `responder` parameter is typed `PromptableInteraction` (imported above from `../commands/intro.js`, exported there in Task 7) — it covers every interaction kind this file passes to it (chat-input, button, select-menu, modal-submit), so no further import is needed beyond the one added to the top import block above.

- [x] **Step 2: Wire `questionnaireRepo` into index.ts**

In `src/index.ts`, add the import:

```ts
import { createQuestionnaireRepository } from './db/questionnaire-repository.js'
```

Construct it alongside `onboarding`:

```ts
const onboarding = createOnboardingRepository(db)
const questionnaireRepo = createQuestionnaireRepository(db)
```

Add it to `onboardingDeps`:

```ts
const onboardingDeps = {
	guildConfig,
	repo: onboarding,
	questionnaireRepo,
	service,
	now: () => new Date().toISOString()
}
```

- [x] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: errors remain only in `src/discord/commands/onboarding.ts` (Task 10, still reads `answers.purpose` etc.) and possibly `src/discord/commands/config.ts` (Task 9, not yet touched — should be unaffected by this task, but confirm). Everything in `interaction-create.ts` and `intro.ts` should be clean now.

- [x] **Step 4: Commit**

```bash
git add src/discord/events/interaction-create.ts src/index.ts
git commit -m "route dynamic question interactions through prefix-parsed custom ids"
```

---

### Task 9: `/config question` admin commands

**Files:**
- Modify: `src/discord/commands/config.ts`
- Create: `src/discord/commands/config-question.ts`
- Create: `tests/discord/config-question.test.ts`

**Interfaces:**
- Consumes: `QuestionnaireRepository` (Task 3).
- Produces: `handleConfigQuestionCommand(interaction, deps)`; `parseOptionsInput(raw: string | null): string[]` (pure, unit tested). `ConfigCommandDeps` gains a `questionnaireRepo: QuestionnaireRepository` field.

- [x] **Step 1: Write the failing test for the pure helper**

Create `tests/discord/config-question.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOptionsInput } from '../../src/discord/commands/config-question.js'

describe('parseOptionsInput', () => {
	it('returns an empty array for null input', () => {
		expect(parseOptionsInput(null)).toEqual([])
	})

	it('splits on commas and trims whitespace', () => {
		expect(parseOptionsInput('New to everything, Some experience ,Advanced')).toEqual([
			'New to everything',
			'Some experience',
			'Advanced'
		])
	})

	it('drops empty segments from stray commas', () => {
		expect(parseOptionsInput('A,,B,')).toEqual(['A', 'B'])
	})
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/discord/config-question.test.ts`
Expected: FAIL — `src/discord/commands/config-question.js` does not exist.

- [x] **Step 3: Add the subcommand group to configCommand**

In `src/discord/commands/config.ts`, add this `.addSubcommandGroup(...)` call to the `configCommand` builder chain, right before `.addSubcommand((sub) => sub.setName('enable')...)`:

```ts
	.addSubcommandGroup((group) =>
		group
			.setName('question')
			.setDescription('Manage the onboarding questionnaire')
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
			)
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
			)
			.addSubcommand((sub) =>
				sub
					.setName('remove')
					.setDescription('Remove a question')
					.addIntegerOption((option) =>
						option.setName('position').setDescription('Position from /config question list').setRequired(true)
					)
			)
			.addSubcommand((sub) =>
				sub
					.setName('move')
					.setDescription('Reorder a question')
					.addIntegerOption((option) =>
						option.setName('position').setDescription('Current position').setRequired(true)
					)
					.addIntegerOption((option) =>
						option.setName('to').setDescription('New position').setRequired(true)
					)
			)
			.addSubcommand((sub) => sub.setName('list').setDescription('List the configured questions'))
			.addSubcommand((sub) => sub.setName('clear').setDescription('Remove every configured question'))
	)
```

Add `questionnaireRepo` to `ConfigCommandDeps`:

```ts
export type ConfigCommandDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly now: () => string
}
```

Add the import:

```ts
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import { handleConfigQuestionCommand } from './config-question.js'
```

At the very top of `handleConfigCommand`, before `const subcommand = interaction.options.getSubcommand()`, delegate the whole `question` group:

```ts
	if (interaction.options.getSubcommandGroup(false) === 'question') {
		await handleConfigQuestionCommand(interaction, deps)
		return
	}

```

- [x] **Step 4: Implement config-question.ts**

Create `src/discord/commands/config-question.ts`:

```ts
import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import { isOk } from '../../types.js'

export type ConfigQuestionDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly now: () => string
}

const ephemeral = { flags: MessageFlags.Ephemeral } as const

export const parseOptionsInput = (raw: string | null): string[] =>
	raw === null
		? []
		: raw
				.split(',')
				.map((segment) => segment.trim())
				.filter((segment) => segment.length > 0)

const TYPE_LABEL: Record<string, string> = {
	text: 'Text response',
	single_select: 'Single choice',
	multi_select: 'Multiple choice'
}

export const handleConfigQuestionCommand = async (
	interaction: ChatInputCommandInteraction,
	deps: ConfigQuestionDeps
): Promise<void> => {
	const { guild } = interaction
	if (!guild) return

	const { questionnaireRepo, now } = deps
	const subcommand = interaction.options.getSubcommand()

	if (subcommand === 'add') {
		const prompt = interaction.options.getString('prompt', true)
		const type = interaction.options.getString('type', true) as
			'text' | 'single_select' | 'multi_select'
		const required = interaction.options.getBoolean('required', true)
		const options = parseOptionsInput(interaction.options.getString('options'))

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

		const result = questionnaireRepo.addQuestion(guild.id, { prompt, type, required, options }, now())
		if (!isOk(result)) {
			await interaction.reply({
				content:
					result.error === 'too-many-questions'
						? 'This server already has the maximum of 10 questions.'
						: 'A question can have at most 25 options.',
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

	if (subcommand === 'edit') {
		const position = interaction.options.getInteger('position', true)
		const prompt = interaction.options.getString('prompt') ?? undefined
		const type = (interaction.options.getString('type') ?? undefined) as
			'text' | 'single_select' | 'multi_select' | undefined
		const required = interaction.options.getBoolean('required') ?? undefined
		const rawOptions = interaction.options.getString('options')
		const options = rawOptions === null ? undefined : parseOptionsInput(rawOptions)

		const result = questionnaireRepo.editQuestion(
			guild.id,
			position,
			{ prompt, type, required, options },
			now()
		)
		if (!isOk(result)) {
			await interaction.reply({
				content:
					result.error === 'not-found'
						? `No question at position ${position}.`
						: 'A question can have at most 25 options.',
				...ephemeral
			})
			return
		}

		await interaction.reply({ content: `Updated question **${position}**.`, ...ephemeral })
		return
	}

	if (subcommand === 'remove') {
		const position = interaction.options.getInteger('position', true)
		const result = questionnaireRepo.removeQuestion(guild.id, position)
		await interaction.reply({
			content: isOk(result)
				? `Removed question **${position}**.`
				: `No question at position ${position}.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'move') {
		const from = interaction.options.getInteger('position', true)
		const to = interaction.options.getInteger('to', true)
		const result = questionnaireRepo.moveQuestion(guild.id, from, to)
		await interaction.reply({
			content: isOk(result)
				? `Moved question **${from}** to position **${to}**.`
				: `Could not move — check both positions with \`/config question list\`.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'list') {
		const questions = questionnaireRepo.listQuestions(guild.id)
		if (questions.length === 0) {
			await interaction.reply({
				content: 'No questions configured — the questionnaire step is skipped entirely.',
				...ephemeral
			})
			return
		}

		const embed = new EmbedBuilder()
			.setTitle('Questionnaire')
			.setDescription(
				questions
					.map(
						(q) =>
							`**${q.position}.** ${q.prompt}\n_${TYPE_LABEL[q.type]}${q.required ? '' : ' · optional'}${
								q.options.length > 0 ? ` · ${q.options.map((o) => o.label).join(', ')}` : ''
							}_`
					)
					.join('\n\n')
			)

		await interaction.reply({ embeds: [embed], ...ephemeral })
		return
	}

	if (subcommand === 'clear') {
		questionnaireRepo.clearQuestions(guild.id)
		await interaction.reply({
			content: 'Every question removed. The questionnaire step is now skipped entirely.',
			...ephemeral
		})
	}
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/discord/config-question.test.ts`
Expected: PASS

- [x] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: `src/discord/commands/config.ts` now needs `questionnaireRepo` at its call site in `src/index.ts` — add it there too (this task's job, since `ConfigCommandDeps` changed):

In `src/index.ts`, find where `deps` is built inside the `InteractionCreate` handler:

```ts
			const deps = { guildConfig, questionnaireRepo, now: () => new Date().toISOString() }
```

- [x] **Step 7: Run full typecheck again**

Run: `pnpm typecheck`
Expected: errors remain only in `src/discord/commands/onboarding.ts` (Task 10).

- [x] **Step 8: Commit**

```bash
git add src/discord/commands/config.ts src/discord/commands/config-question.ts tests/discord/config-question.test.ts src/index.ts
git commit -m "add /config question admin commands for managing the questionnaire"
```

---

### Task 10: `/onboarding status` shows dynamic answers

**Files:**
- Modify: `src/discord/commands/onboarding.ts`
- Modify: `src/index.ts` (thread `questionnaireRepo` into onboarding-command deps)

**Interfaces:**
- Consumes: `QuestionnaireRepository` (Task 3), `QuestionAnswer[]` from `repo.getAnswers` (Task 4).

No dedicated test file, matching this file's existing convention (no `tests/discord/onboarding.test.ts` exists today either). Verified by `pnpm typecheck` plus the full suite in Task 11.

- [x] **Step 1: Rewrite the answer-rendering part of buildStatusEmbed**

In `src/discord/commands/onboarding.ts`, add the import:

```ts
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
```

Add `questionnaireRepo` to `OnboardingCommandDeps`:

```ts
export type OnboardingCommandDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly service: OnboardingService
}
```

Change `buildStatusEmbed`'s signature to accept the question list, and replace the fixed Purpose/Experience/Built-for-Discord fields:

```ts
const formatAnswer = (
	question: { type: string; options: { value: string; label: string }[] },
	answer: { textValue: string | null; selectedValues: readonly string[] } | undefined
): string => {
	if (!answer) return '⬜ not answered'
	if (question.type === 'text') return answer.textValue || '_(skipped)_'
	if (answer.selectedValues.length === 0) return '_(skipped)_'
	const labels = new Map(question.options.map((o) => [o.value, o.label]))
	return answer.selectedValues.map((value) => labels.get(value) ?? value).join(', ')
}

const buildStatusEmbed = (
	guildId: string,
	userId: string,
	record: OnboardingRecord,
	repo: OnboardingRepository,
	questionnaireRepo: QuestionnaireRepository
): EmbedBuilder => {
	const embed = new EmbedBuilder()
		.setTitle('Onboarding status')
		.setDescription(`<@${userId}>`)
		.addFields(
			stepField('1. Rules accepted', record.rulesAcceptedAt),
			stepField('2. Questionnaire completed', record.questionnaireCompletedAt),
			stepField('3. Posted in introductions', record.introPostedAt),
			stepField('Verified', record.verifiedAt)
		)

	if (record.verificationHoldAt)
		embed.addFields({
			name: '⛔ Hold',
			value: `Applied ${record.verificationHoldAt} by <@${record.verificationHoldBy ?? 'unknown'}>`
		})

	const questions = questionnaireRepo.listQuestions(guildId)
	if (questions.length > 0) {
		const answers = new Map(repo.getAnswers(guildId, userId).map((a) => [a.questionId, a]))
		embed.addFields(
			questions.map((question) => ({
				name: `${question.position}. ${question.prompt}`,
				value: formatAnswer(question, answers.get(question.id))
			}))
		)
	}

	return embed
}
```

Update the one call site inside `handleOnboardingCommand`:

```ts
		await interaction.reply(
			record
				? {
						embeds: [buildStatusEmbed(config.guildId, target.id, record, deps.repo, deps.questionnaireRepo)],
						...ephemeral
					}
				: { content: `<@${target.id}> has no onboarding record in this server.`, ...ephemeral }
		)
```

- [x] **Step 2: Wire questionnaireRepo into the onboarding command deps**

In `src/index.ts`, find where `handleOnboardingCommand` is invoked (inside `handleOnboardingInteraction` in `interaction-create.ts`, which already receives `questionnaireRepo` via `deps` since Task 8) — confirm the call site at `src/discord/events/interaction-create.ts`'s `/onboarding` branch already passes `questionnaireRepo` (it does, per Task 8 Step 1's rewritten `handleOnboardingCommand(interaction, { guildConfig, repo, questionnaireRepo, service })`). No further change needed here — this step just confirms wiring is already complete via Task 8.

- [x] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean — zero errors across the whole project.

- [x] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: every test file passes.

- [x] **Step 5: Commit**

```bash
git add src/discord/commands/onboarding.ts
git commit -m "show dynamic questionnaire answers in /onboarding status"
```

---

### Task 11: Docs, plan bookkeeping, and final verification

**Files:**
- Modify: `README.md`
- Modify: `plans/00-overview.md`
- Modify: `PLAN.md`

- [x] **Step 1: Update README.md**

In the `## Configuration` section, add the new commands to the fenced command block, right after `/config intro-template`:

```
/config question add prompt:… type:… required:… options:…    # add a questionnaire question
/config question edit position:… …                            # edit an existing question
/config question remove position:…                             # remove a question
/config question move position:… to:…                          # reorder questions
/config question list                                          # show the configured questions
/config question clear                                         # remove every question
```

Add a short paragraph after the existing `/config enable` description block:

```markdown
The onboarding questionnaire is fully admin-configurable via `/config question` — any number of questions up to 10, each free-text or multiple-choice (single or multi-select), each independently required or optional, in whatever order you set. A server with zero configured questions skips the questionnaire step entirely, going straight from rules acceptance to the introduction post. See [`docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md`](docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md) for the full design, including why modal-only questions can't include multiple-choice options (a Discord platform constraint, not a choice).
```

Update the `## Plans` table to add a row:

```
| 07  | [configurable-questionnaire](plans/07-configurable-questionnaire.md) | Admin-configurable questionnaire — question CRUD, dynamic delivery |
```

- [x] **Step 2: Update plans/00-overview.md**

Append to `## Architecture Decisions`:

```
- 2026-08-11 — **Configurable questionnaire.** The three hardcoded onboarding questions are replaced by a per-guild, admin-configurable question set (`/config question add/edit/remove/move/list/clear`), each question free-text or select (single/multi), each independently required. Requested directly by the user. The old fixed-column `questionnaire_answers` table was dropped and recreated in a normalized shape — a deliberate, accepted data-loss migration since no guild had live answer data yet. See [[07-configurable-questionnaire]]
```

Add a row to `## Module Plans`:

```
| [[07-configurable-questionnaire]]    | 🔵 Planning    | —                                    |
```

- [x] **Step 3: Update PLAN.md**

Add a row to the Phases & Sub-Plans table:

```
| 07  | [plans/07-configurable-questionnaire](plans/07-configurable-questionnaire.md) | 🟡 In Progress | Admin-configurable questionnaire replacing the 3 fixed questions |
```

Rewrite the `## Current Focus` section's opening paragraph to mention Plan 07 alongside Plan 06, and note that its live-verification step (creating a few questions of each type via `/config question add` and walking `/intro` through them by hand) joins the existing checklist.

- [x] **Step 4: Final full verification**

Run: `pnpm typecheck && pnpm test`
Expected: both clean, no errors, all tests passing (the full suite, including every file touched across Tasks 1–10).

- [x] **Step 5: Commit**

```bash
git add README.md plans/00-overview.md PLAN.md
git commit -m "document the configurable questionnaire feature"
```

## Open Questions

- [ ] None.

## Dependencies

- Requires: [[02-guild-configuration]] (extends `/config`), [[03-verification-gate]] (replaces the questionnaire step's data model and delivery)
- Blocks: —
