---
plan: bot-foundation
project: discord-developer
updated: 2026-08-10
status: 🔵 Planning
tags: [plan]
---

# 01 — Bot foundation & multi-guild data layer

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md`](../docs/superpowers/specs/2026-08-08-onboarding-verification-gate-design.md)

## Status

🔵 Planning

## Goal

> A bot that boots, connects, and has a tested multi-guild persistence layer: per-guild configuration plus onboarding records keyed on `(guild_id, user_id)`. No onboarding behaviour and no commands yet — this is the floor everything else stands on.

## Global Constraints

Every task below inherits these:

- Node.js 20+, ESM only (`"type": "module"`), `node:` prefix on builtin imports
- TypeScript strict mode, `module`/`moduleResolution` both `NodeNext`, `.js` extensions on every relative import
- `unknown` over `any`; `import type` for type-only imports
- Named exports only, kebab-case filenames, no classes for state
- discord.js v14, `better-sqlite3`, Vitest
- Formatting: tabs, width 2, single quotes, no semicolons
- pnpm as package manager
- Timestamps are ISO 8601 UTC strings (`new Date().toISOString()`)
- Gateway intents: `Guilds`, `GuildMembers`, `GuildMessages` — **never** `MessageContent`
- Only two environment variables exist: `DISCORD_TOKEN` and `DATABASE_PATH` (plus optional `DEV_GUILD_ID`). Everything server-specific lives in the database.

## File Structure

| File                                                                      | Responsibility                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts` | Toolchain                                                    |
| `.env.example`, `.gitignore`                                              | Local setup                                                  |
| `src/types.ts`                                                            | `Result<T,E>` helpers, shared domain types                   |
| `src/env.ts`                                                              | The two env vars, validated                                  |
| `src/db/schema.sql`                                                       | Table definitions                                            |
| `src/db/migrate.ts`                                                       | Idempotent schema application                                |
| `src/db/guild-config-repository.ts`                                       | All SQL for `guild_config`                                   |
| `src/db/onboarding-repository.ts`                                         | All SQL for onboarding + answers                             |
| `src/discord/client.ts`                                                   | Client construction and intents                              |
| `src/index.ts`                                                            | Entrypoint                                                   |
| `README.md`                                                               | Setup + run docs (written in plan 02, once `/config` exists) |

---

### Task 1: Project scaffold

**Files:**

- Create: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`, `.gitignore`, `.env.example`

**Interfaces:**

- Produces: `pnpm dev`, `pnpm test`, `pnpm build`, `pnpm typecheck` used by every later task.

- [ ] **Step 1: Initialise the repo**

```bash
git init
pnpm init
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm i discord.js better-sqlite3 dotenv
pnpm i -D typescript @types/node @types/better-sqlite3 vitest tsx prettier
```

- [ ] **Step 3: Write `package.json` scripts and module type**

Merge into the generated `package.json`. `typecheck` covers tests as well as source — Vitest transpiles without type checking, so without this a type error in a test is invisible until it fails at runtime.

```json
{
	"type": "module",
	"engines": { "node": ">=20" },
	"scripts": {
		"dev": "tsx watch src/index.ts",
		"start": "node dist/index.js",
		"build": "tsc && cp src/db/schema.sql dist/db/schema.sql",
		"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.test.json",
		"test": "vitest run --passWithNoTests",
		"test:watch": "vitest",
		"format": "prettier --write ."
	}
}
```

- [ ] **Step 4: Write `tsconfig.json`**

`NodeNext` is deliberate: this code is executed by Node, not bundled, so the compiler should model Node's real ESM resolution and enforce the `.js` import extensions the runtime requires.

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "NodeNext",
		"moduleResolution": "NodeNext",
		"lib": ["ES2023"],
		"outDir": "dist",
		"rootDir": "src",
		"strict": true,
		"noUncheckedIndexedAccess": true,
		"exactOptionalPropertyTypes": true,
		"noImplicitOverride": true,
		"verbatimModuleSyntax": true,
		"skipLibCheck": true,
		"resolveJsonModule": true,
		"esModuleInterop": true
	},
	"include": ["src/**/*.ts"],
	"exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Write `tsconfig.test.json`**

```json
{
	"extends": "./tsconfig.json",
	"compilerOptions": {
		"rootDir": ".",
		"noEmit": true
	},
	"include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node'
	}
})
```

- [ ] **Step 7: Write `.gitignore`**

```
node_modules/
dist/
data/
.env
.env.local
*.db
*.db-journal
*.db-wal
*.db-shm
.DS_Store
```

- [ ] **Step 8: Write `.env.example`**

```
# The only two settings that are not per-server.
# Everything else is configured in Discord with /config
DISCORD_TOKEN=
DATABASE_PATH=./data/onboarding.db

# Optional: register slash commands to this one guild instantly during
# development, instead of waiting up to an hour for global propagation.
DEV_GUILD_ID=
```

- [ ] **Step 9: Verify the toolchain runs**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck passes; Vitest exits 0 reporting no test files. (Without `--passWithNoTests` Vitest exits 1 here, failing the chain.)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold TypeScript bot project"
```

---

### Task 2: Result type and shared domain types

**Files:**

- Create: `src/types.ts`
- Test: `tests/types.test.ts`

**Interfaces:**

- Produces: `Result<T,E>`, `ok()`, `err()`, `isOk()`, `EXPERIENCE_LEVELS`, `ExperienceLevel`, `OnboardingStep`, `OnboardingRecord`, `QuestionnaireAnswers`, `GuildConfigRow`. Every later task consumes these.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { err, isOk, ok } from '../src/types.js'

describe('Result', () => {
	it('marks a success value as ok and exposes it', () => {
		const result = ok(42)
		expect(isOk(result)).toBe(true)
		if (isOk(result)) expect(result.value).toBe(42)
	})

	it('marks a failure as not ok and exposes the error', () => {
		const result = err('boom')
		expect(isOk(result)).toBe(false)
		if (!isOk(result)) expect(result.error).toBe('boom')
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test`
Expected: FAIL — cannot resolve `../src/types.js`.

- [ ] **Step 3: Write `src/types.ts`**

```ts
export type Result<T, E> =
	{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } => result.ok

export const EXPERIENCE_LEVELS = {
	NEW: 'new-to-everything',
	SOME: 'a-little-experience',
	WRITES: 'writes-software',
	ADVANCED: 'advanced'
} as const

export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[keyof typeof EXPERIENCE_LEVELS]

export type OnboardingStep = 'rules' | 'questionnaire' | 'intro'

export type OnboardingRecord = {
	readonly guildId: string
	readonly userId: string
	readonly firstJoinedAt: string
	readonly lastJoinedAt: string
	readonly rulesAcceptedAt: string | null
	readonly questionnaireCompletedAt: string | null
	readonly introPostedAt: string | null
	readonly introMessageId: string | null
	readonly verifiedAt: string | null
	readonly verificationHoldAt: string | null
	readonly verificationHoldBy: string | null
	readonly remindersSent: number
	readonly lastReminderAt: string | null
}

export type QuestionnaireAnswers = {
	readonly guildId: string
	readonly userId: string
	readonly purpose: string | null
	readonly experienceLevel: ExperienceLevel | null
	readonly builtForDiscord: boolean | null
	readonly answeredAt: string | null
}

export type GuildConfigRow = {
	readonly guildId: string
	readonly rulesChannelId: string | null
	readonly introductionsChannelId: string | null
	readonly modLogChannelId: string | null
	readonly verifiedRoleId: string | null
	readonly unverifiedRoleId: string | null
	readonly rulesText: string | null
	readonly rulesMessageId: string | null
	readonly enabled: boolean
	readonly grandfatherBefore: string | null
	readonly joinedAt: string
	readonly configuredAt: string | null
	readonly configuredBy: string | null
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add Result type and shared domain types"
```

---

### Task 3: Environment loading

**Files:**

- Create: `src/env.ts`
- Test: `tests/env.test.ts`

**Interfaces:**

- Produces: `loadEnv(source?: NodeJS.ProcessEnv): Env` and the `Env` type. Throws on invalid input — a bot with no token must not half-start.
- The env source is a parameter so tests never mutate `process.env`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env.js'

describe('loadEnv', () => {
	it('reads the token and defaults the database path', () => {
		const env = loadEnv({ DISCORD_TOKEN: 'token-value' })
		expect(env.discordToken).toBe('token-value')
		expect(env.databasePath).toBe('./data/onboarding.db')
	})

	it('throws naming the token when it is missing', () => {
		expect(() => loadEnv({})).toThrow(/DISCORD_TOKEN/)
	})

	it('leaves the dev guild id undefined when not supplied', () => {
		expect(loadEnv({ DISCORD_TOKEN: 't' }).devGuildId).toBeUndefined()
	})

	it('rejects a dev guild id that is not a snowflake', () => {
		expect(() => loadEnv({ DISCORD_TOKEN: 't', DEV_GUILD_ID: 'nope' })).toThrow(/DEV_GUILD_ID/)
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/env.test.ts`
Expected: FAIL — cannot resolve `../src/env.js`.

- [ ] **Step 3: Write `src/env.ts`**

```ts
import { env as processEnv } from 'node:process'

export const SNOWFLAKE_PATTERN = /^\d{17,20}$/

export type Env = {
	readonly discordToken: string
	readonly databasePath: string
	readonly devGuildId?: string
}

export const loadEnv = (source: NodeJS.ProcessEnv = processEnv): Env => {
	const discordToken = source.DISCORD_TOKEN?.trim()
	if (!discordToken) throw new Error('Missing required environment variable: DISCORD_TOKEN')

	const devGuildId = source.DEV_GUILD_ID?.trim()
	if (devGuildId && !SNOWFLAKE_PATTERN.test(devGuildId))
		throw new Error(`Environment variable DEV_GUILD_ID is not a valid snowflake: ${devGuildId}`)

	const base = {
		discordToken,
		databasePath: source.DATABASE_PATH?.trim() || './data/onboarding.db'
	}

	// Assigned conditionally rather than as `devGuildId: undefined`, which
	// exactOptionalPropertyTypes rejects for an optional property.
	return devGuildId ? { ...base, devGuildId } : base
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/env.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/env.ts tests/env.test.ts
git commit -m "feat: add environment loading"
```

---

### Task 4: Database schema and migration

**Files:**

- Create: `src/db/schema.sql`, `src/db/migrate.ts`, `tests/helpers/test-db.ts`
- Test: `tests/db/migrate.test.ts`

**Interfaces:**

- Produces: `migrate(db): void` and the test helper `createTestDb(): Database.Database` returning an in-memory database with the schema applied. Every later database test uses `createTestDb`.

- [ ] **Step 1: Write `src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS guild_config (
	guild_id                 TEXT PRIMARY KEY,
	rules_channel_id         TEXT,
	introductions_channel_id TEXT,
	mod_log_channel_id       TEXT,
	verified_role_id         TEXT,
	unverified_role_id       TEXT,
	rules_text               TEXT,
	rules_message_id         TEXT,
	enabled                  INTEGER NOT NULL DEFAULT 0,
	grandfather_before       TEXT,
	joined_at                TEXT NOT NULL,
	configured_at            TEXT,
	configured_by            TEXT
);

CREATE TABLE IF NOT EXISTS onboarding (
	guild_id                   TEXT NOT NULL,
	user_id                    TEXT NOT NULL,
	first_joined_at            TEXT NOT NULL,
	last_joined_at             TEXT NOT NULL,
	rules_accepted_at          TEXT,
	questionnaire_completed_at TEXT,
	intro_posted_at            TEXT,
	intro_message_id           TEXT,
	verified_at                TEXT,
	verification_hold_at       TEXT,
	verification_hold_by       TEXT,
	reminders_sent             INTEGER NOT NULL DEFAULT 0,
	last_reminder_at           TEXT,
	PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS questionnaire_answers (
	guild_id          TEXT NOT NULL,
	user_id           TEXT NOT NULL,
	purpose           TEXT,
	experience_level  TEXT,
	built_for_discord INTEGER,
	answered_at       TEXT,
	PRIMARY KEY (guild_id, user_id),
	FOREIGN KEY (guild_id, user_id) REFERENCES onboarding(guild_id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_onboarding_pending
	ON onboarding (guild_id, verified_at, verification_hold_at, reminders_sent, last_joined_at);
```

- [ ] **Step 2: Write the failing test**

Note the idempotency test runs `migrate` **twice on the same database** — creating two separate in-memory databases would not test anything.

```ts
import { describe, expect, it } from 'vitest'
import { migrate } from '../../src/db/migrate.js'
import { createTestDb } from '../helpers/test-db.js'

describe('migrate', () => {
	it('creates all three tables', () => {
		const db = createTestDb()
		const names = (
			db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
		).map((row) => row.name)

		expect(names).toContain('guild_config')
		expect(names).toContain('onboarding')
		expect(names).toContain('questionnaire_answers')
	})

	it('is safe to run twice against the same database', () => {
		const db = createTestDb()
		db.prepare(
			"INSERT INTO guild_config (guild_id, joined_at) VALUES ('g1', '2026-08-10T00:00:00.000Z')"
		).run()

		expect(() => migrate(db)).not.toThrow()

		expect(db.prepare('SELECT COUNT(*) AS n FROM guild_config').get()).toEqual({ n: 1 })
	})

	it('allows the same user id in two different guilds', () => {
		const db = createTestDb()
		const insert = db.prepare(
			'INSERT INTO onboarding (guild_id, user_id, first_joined_at, last_joined_at) VALUES (?, ?, ?, ?)'
		)
		insert.run('guild-a', 'user-1', 'now', 'now')

		expect(() => insert.run('guild-b', 'user-1', 'now', 'now')).not.toThrow()
	})
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `pnpm test tests/db/migrate.test.ts`
Expected: FAIL — cannot resolve the migrate module.

- [ ] **Step 4: Write `src/db/migrate.ts`**

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from 'better-sqlite3'

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql')

export const migrate = (db: Database): void => {
	db.pragma('foreign_keys = ON')

	// WAL lets readers run concurrently with a writer, which is what makes a
	// single database file safe to share across shard processes. It is
	// unsupported on in-memory databases, where SQLite reports "memory" instead.
	if (!db.memory) {
		db.pragma('journal_mode = WAL')
		// NORMAL is durable across process crashes (only a power loss can lose
		// the last transaction) and removes an fsync from every write.
		db.pragma('synchronous = NORMAL')
		// Shard processes share the file; wait rather than throwing SQLITE_BUSY.
		db.pragma('busy_timeout = 5000')
	}

	db.exec(readFileSync(schemaPath, 'utf8'))
}
```

- [ ] **Step 5: Write `tests/helpers/test-db.ts`**

```ts
import Database from 'better-sqlite3'
import { migrate } from '../../src/db/migrate.js'

export const createTestDb = (): Database.Database => {
	const db = new Database(':memory:')
	migrate(db)
	return db
}
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `pnpm test tests/db/migrate.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add src/db tests/db tests/helpers
git commit -m "feat: add multi-guild SQLite schema and migration"
```

---

### Task 5: Guild config repository

**Files:**

- Create: `src/db/guild-config-repository.ts`
- Test: `tests/db/guild-config-repository.test.ts`

**Interfaces:**

- Consumes: `GuildConfigRow` from `src/types.ts`.
- Produces: `createGuildConfigRepository(db): GuildConfigRepository` with
  `ensure(guildId, joinedAt)`, `get(guildId)`, `setChannel(guildId, kind, channelId, actorId, at)`,
  `setRole(guildId, kind, roleId, actorId, at)`, `setRulesText(guildId, text, actorId, at)`,
  `setRulesMessageId(guildId, messageId)`, `enable(guildId, grandfatherBefore, actorId, at)`,
  `disable(guildId)`, `clearGrandfather(guildId)`, `listEnabled()`, `remove(guildId)`.
  Plan 02's `/config` command calls these exact names.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createGuildConfigRepository } from '../../src/db/guild-config-repository.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const ACTOR = '223456789012345678'
const AT = '2026-08-10T10:00:00.000Z'

let repo: ReturnType<typeof createGuildConfigRepository>

beforeEach(() => {
	repo = createGuildConfigRepository(createTestDb())
	repo.ensure(GUILD, AT)
})

describe('ensure', () => {
	it('creates a disabled row with nothing configured', () => {
		const config = repo.get(GUILD)
		expect(config?.enabled).toBe(false)
		expect(config?.rulesChannelId).toBeNull()
		expect(config?.grandfatherBefore).toBeNull()
	})

	it('does not overwrite an existing row', () => {
		repo.setChannel(GUILD, 'rules', '999', ACTOR, AT)
		repo.ensure(GUILD, '2026-09-01T00:00:00.000Z')
		expect(repo.get(GUILD)?.rulesChannelId).toBe('999')
	})

	it('returns null for a guild it has never seen', () => {
		expect(repo.get('000000000000000000')).toBeNull()
	})
})

describe('setChannel and setRole', () => {
	it('stores each channel kind independently', () => {
		repo.setChannel(GUILD, 'rules', '111', ACTOR, AT)
		repo.setChannel(GUILD, 'introductions', '222', ACTOR, AT)
		repo.setChannel(GUILD, 'modlog', '333', ACTOR, AT)

		const config = repo.get(GUILD)
		expect(config?.rulesChannelId).toBe('111')
		expect(config?.introductionsChannelId).toBe('222')
		expect(config?.modLogChannelId).toBe('333')
	})

	it('stores each role kind independently', () => {
		repo.setRole(GUILD, 'verified', '444', ACTOR, AT)
		repo.setRole(GUILD, 'unverified', '555', ACTOR, AT)

		const config = repo.get(GUILD)
		expect(config?.verifiedRoleId).toBe('444')
		expect(config?.unverifiedRoleId).toBe('555')
	})

	it('records who last changed the configuration and when', () => {
		repo.setRole(GUILD, 'verified', '444', ACTOR, AT)
		const config = repo.get(GUILD)
		expect(config?.configuredBy).toBe(ACTOR)
		expect(config?.configuredAt).toBe(AT)
	})
})

describe('enable and disable', () => {
	it('enables and stamps the grandfather cutoff', () => {
		repo.enable(GUILD, AT, ACTOR, AT)
		const config = repo.get(GUILD)
		expect(config?.enabled).toBe(true)
		expect(config?.grandfatherBefore).toBe(AT)
	})

	it('disables without losing configuration', () => {
		repo.setChannel(GUILD, 'rules', '111', ACTOR, AT)
		repo.enable(GUILD, AT, ACTOR, AT)
		repo.disable(GUILD)

		const config = repo.get(GUILD)
		expect(config?.enabled).toBe(false)
		expect(config?.rulesChannelId).toBe('111')
	})

	it('clears the grandfather cutoff without disabling', () => {
		repo.enable(GUILD, AT, ACTOR, AT)
		repo.clearGrandfather(GUILD)

		const config = repo.get(GUILD)
		expect(config?.grandfatherBefore).toBeNull()
		expect(config?.enabled).toBe(true)
	})

	it('lists only enabled guilds', () => {
		const other = '323456789012345678'
		repo.ensure(other, AT)
		repo.enable(GUILD, AT, ACTOR, AT)

		expect(repo.listEnabled().map((config) => config.guildId)).toEqual([GUILD])
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/db/guild-config-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/guild-config-repository.ts`**

```ts
import type { Database } from 'better-sqlite3'
import type { GuildConfigRow } from '../types.js'

export type ChannelKind = 'rules' | 'introductions' | 'modlog'
export type RoleKind = 'verified' | 'unverified'

const CHANNEL_COLUMNS: Record<ChannelKind, string> = {
	rules: 'rules_channel_id',
	introductions: 'introductions_channel_id',
	modlog: 'mod_log_channel_id'
}

const ROLE_COLUMNS: Record<RoleKind, string> = {
	verified: 'verified_role_id',
	unverified: 'unverified_role_id'
}

type Row = {
	guild_id: string
	rules_channel_id: string | null
	introductions_channel_id: string | null
	mod_log_channel_id: string | null
	verified_role_id: string | null
	unverified_role_id: string | null
	rules_text: string | null
	rules_message_id: string | null
	enabled: number
	grandfather_before: string | null
	joined_at: string
	configured_at: string | null
	configured_by: string | null
}

const toConfig = (row: Row): GuildConfigRow => ({
	guildId: row.guild_id,
	rulesChannelId: row.rules_channel_id,
	introductionsChannelId: row.introductions_channel_id,
	modLogChannelId: row.mod_log_channel_id,
	verifiedRoleId: row.verified_role_id,
	unverifiedRoleId: row.unverified_role_id,
	rulesText: row.rules_text,
	rulesMessageId: row.rules_message_id,
	enabled: row.enabled === 1,
	grandfatherBefore: row.grandfather_before,
	joinedAt: row.joined_at,
	configuredAt: row.configured_at,
	configuredBy: row.configured_by
})

export const createGuildConfigRepository = (db: Database) => {
	// Every statement is compiled once here, not per call. `get` runs on
	// effectively every gateway event, so recompiling its SQL each time would
	// be pure waste at any real event rate.
	const statements = {
		ensure: db.prepare(
			'INSERT INTO guild_config (guild_id, joined_at) VALUES (?, ?) ON CONFLICT(guild_id) DO NOTHING'
		),
		get: db.prepare('SELECT * FROM guild_config WHERE guild_id = ?'),
		touch: db.prepare(
			'UPDATE guild_config SET configured_at = ?, configured_by = ? WHERE guild_id = ?'
		),
		setRulesText: db.prepare('UPDATE guild_config SET rules_text = ? WHERE guild_id = ?'),
		setRulesMessageId: db.prepare(
			'UPDATE guild_config SET rules_message_id = ? WHERE guild_id = ?'
		),
		enable: db.prepare(
			'UPDATE guild_config SET enabled = 1, grandfather_before = ? WHERE guild_id = ?'
		),
		disable: db.prepare('UPDATE guild_config SET enabled = 0 WHERE guild_id = ?'),
		clearGrandfather: db.prepare(
			'UPDATE guild_config SET grandfather_before = NULL WHERE guild_id = ?'
		),
		listEnabled: db.prepare('SELECT * FROM guild_config WHERE enabled = 1'),
		remove: db.prepare('DELETE FROM guild_config WHERE guild_id = ?')
	}

	// Column names cannot be bound as parameters, so each target column needs
	// its own compiled statement. Building them from the fixed maps keeps the
	// SQL free of any caller-supplied string.
	const channelStatements = Object.fromEntries(
		Object.entries(CHANNEL_COLUMNS).map(([kind, column]) => [
			kind,
			db.prepare(`UPDATE guild_config SET ${column} = ? WHERE guild_id = ?`)
		])
	) as Record<ChannelKind, ReturnType<Database['prepare']>>

	const roleStatements = Object.fromEntries(
		Object.entries(ROLE_COLUMNS).map(([kind, column]) => [
			kind,
			db.prepare(`UPDATE guild_config SET ${column} = ? WHERE guild_id = ?`)
		])
	) as Record<RoleKind, ReturnType<Database['prepare']>>

	const touch = (guildId: string, actorId: string, at: string): void => {
		statements.touch.run(at, actorId, guildId)
	}

	return {
		ensure: (guildId: string, joinedAt: string): void => {
			statements.ensure.run(guildId, joinedAt)
		},

		get: (guildId: string): GuildConfigRow | null => {
			const row = statements.get.get(guildId) as Row | undefined
			return row ? toConfig(row) : null
		},

		setChannel: (
			guildId: string,
			kind: ChannelKind,
			channelId: string,
			actorId: string,
			at: string
		): void => {
			channelStatements[kind].run(channelId, guildId)
			touch(guildId, actorId, at)
		},

		setRole: (
			guildId: string,
			kind: RoleKind,
			roleId: string,
			actorId: string,
			at: string
		): void => {
			roleStatements[kind].run(roleId, guildId)
			touch(guildId, actorId, at)
		},

		setRulesText: (guildId: string, text: string, actorId: string, at: string): void => {
			statements.setRulesText.run(text, guildId)
			touch(guildId, actorId, at)
		},

		setRulesMessageId: (guildId: string, messageId: string | null): void => {
			statements.setRulesMessageId.run(messageId, guildId)
		},

		enable: (guildId: string, grandfatherBefore: string, actorId: string, at: string): void => {
			statements.enable.run(grandfatherBefore, guildId)
			touch(guildId, actorId, at)
		},

		disable: (guildId: string): void => {
			statements.disable.run(guildId)
		},

		clearGrandfather: (guildId: string): void => {
			statements.clearGrandfather.run(guildId)
		},

		listEnabled: (): GuildConfigRow[] => (statements.listEnabled.all() as Row[]).map(toConfig),

		remove: (guildId: string): void => {
			statements.remove.run(guildId)
		}
	}
}

export type GuildConfigRepository = ReturnType<typeof createGuildConfigRepository>
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/db/guild-config-repository.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/guild-config-repository.ts tests/db/guild-config-repository.test.ts
git commit -m "feat: add guild config repository"
```

---

### Task 6: Onboarding repository

**Files:**

- Create: `src/db/onboarding-repository.ts`
- Test: `tests/db/onboarding-repository.test.ts`

**Interfaces:**

- Consumes: `OnboardingRecord`, `OnboardingStep`, `QuestionnaireAnswers`, `ExperienceLevel`.
- Produces: `createOnboardingRepository(db): OnboardingRepository`. **Every method takes `guildId` first.**
  `upsertOnJoin(guildId, userId, at)`, `get(guildId, userId)`, `stampStep(guildId, userId, step, at)`,
  `setIntroMessageId(guildId, userId, messageId)`, `markVerified(guildId, userId, at)`,
  `setHold(guildId, userId, at, byUserId)`, `clearHold(guildId, userId)`, `remove(guildId, userId)`,
  `saveAnswer(guildId, userId, patch, at)`, `getAnswers(guildId, userId)`,
  `listAwaitingReminder(guildId, nowMs, firstAfterMs, secondAfterMs, limit = 500)`,
  `incrementReminder(guildId, userId, at)`.
  Plans 03 and 04 call these exact names.
- `listAwaitingReminder` filters elapsed time **in SQL** and takes a `limit`, so a guild with a
  large backlog cannot deserialise every pending row into memory on one tick. Plan 04 relies on
  that bound.

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { EXPERIENCE_LEVELS } from '../../src/types.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const OTHER_GUILD = '923456789012345678'
const USER = '223456789012345678'

let repo: ReturnType<typeof createOnboardingRepository>

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
})

describe('upsertOnJoin', () => {
	it('creates a record with both join timestamps set on first join', () => {
		repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z')
		const record = repo.get(GUILD, USER)
		expect(record?.firstJoinedAt).toBe('2026-08-10T10:00:00.000Z')
		expect(record?.lastJoinedAt).toBe('2026-08-10T10:00:00.000Z')
	})

	it('updates only lastJoinedAt when the member rejoins', () => {
		repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z')
		repo.upsertOnJoin(GUILD, USER, '2026-09-01T10:00:00.000Z')
		const record = repo.get(GUILD, USER)
		expect(record?.firstJoinedAt).toBe('2026-08-10T10:00:00.000Z')
		expect(record?.lastJoinedAt).toBe('2026-09-01T10:00:00.000Z')
	})

	it('preserves completed steps across a rejoin', () => {
		repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z')
		repo.stampStep(GUILD, USER, 'rules', '2026-08-10T11:00:00.000Z')
		repo.upsertOnJoin(GUILD, USER, '2026-09-01T10:00:00.000Z')
		expect(repo.get(GUILD, USER)?.rulesAcceptedAt).toBe('2026-08-10T11:00:00.000Z')
	})
})

describe('guild isolation', () => {
	beforeEach(() => {
		repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z')
		repo.upsertOnJoin(OTHER_GUILD, USER, '2026-08-10T10:00:00.000Z')
	})

	it('keeps step progress separate for the same user in two guilds', () => {
		repo.stampStep(GUILD, USER, 'rules', '2026-08-10T11:00:00.000Z')
		expect(repo.get(GUILD, USER)?.rulesAcceptedAt).not.toBeNull()
		expect(repo.get(OTHER_GUILD, USER)?.rulesAcceptedAt).toBeNull()
	})

	it('keeps answers separate for the same user in two guilds', () => {
		repo.saveAnswer(GUILD, USER, { purpose: 'here for the code' }, '2026-08-10T11:00:00.000Z')
		expect(repo.getAnswers(GUILD, USER)?.purpose).toBe('here for the code')
		expect(repo.getAnswers(OTHER_GUILD, USER)).toBeNull()
	})

	it('removing a record in one guild leaves the other intact', () => {
		repo.remove(GUILD, USER)
		expect(repo.get(GUILD, USER)).toBeNull()
		expect(repo.get(OTHER_GUILD, USER)).not.toBeNull()
	})
})

describe('stampStep', () => {
	beforeEach(() => repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z'))

	it('records the timestamp for the given step', () => {
		repo.stampStep(GUILD, USER, 'intro', '2026-08-10T12:00:00.000Z')
		expect(repo.get(GUILD, USER)?.introPostedAt).toBe('2026-08-10T12:00:00.000Z')
	})

	it('keeps the original timestamp when the same step is stamped twice', () => {
		repo.stampStep(GUILD, USER, 'rules', '2026-08-10T11:00:00.000Z')
		repo.stampStep(GUILD, USER, 'rules', '2026-08-10T13:00:00.000Z')
		expect(repo.get(GUILD, USER)?.rulesAcceptedAt).toBe('2026-08-10T11:00:00.000Z')
	})
})

describe('saveAnswer', () => {
	beforeEach(() => repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z'))

	it('stores a partial answer without completing the questionnaire', () => {
		repo.saveAnswer(GUILD, USER, { purpose: 'learning backend' }, '2026-08-10T11:00:00.000Z')
		expect(repo.getAnswers(GUILD, USER)?.purpose).toBe('learning backend')
		expect(repo.get(GUILD, USER)?.questionnaireCompletedAt).toBeNull()
	})

	it('completes the questionnaire only once all three answers are present', () => {
		repo.saveAnswer(GUILD, USER, { purpose: 'learning' }, '2026-08-10T11:00:00.000Z')
		repo.saveAnswer(
			GUILD,
			USER,
			{ experienceLevel: EXPERIENCE_LEVELS.SOME },
			'2026-08-10T11:01:00.000Z'
		)
		expect(repo.get(GUILD, USER)?.questionnaireCompletedAt).toBeNull()

		repo.saveAnswer(GUILD, USER, { builtForDiscord: false }, '2026-08-10T11:02:00.000Z')
		expect(repo.get(GUILD, USER)?.questionnaireCompletedAt).toBe('2026-08-10T11:02:00.000Z')
	})

	it('overwrites a previously given answer', () => {
		repo.saveAnswer(GUILD, USER, { purpose: 'first' }, '2026-08-10T11:00:00.000Z')
		repo.saveAnswer(GUILD, USER, { purpose: 'second' }, '2026-08-10T11:05:00.000Z')
		expect(repo.getAnswers(GUILD, USER)?.purpose).toBe('second')
	})

	it('round-trips the boolean Discord-dev answer', () => {
		repo.saveAnswer(GUILD, USER, { builtForDiscord: true }, '2026-08-10T11:00:00.000Z')
		expect(repo.getAnswers(GUILD, USER)?.builtForDiscord).toBe(true)
	})
})

describe('holds', () => {
	beforeEach(() => repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z'))

	it('records who applied the hold and clears verification', () => {
		repo.markVerified(GUILD, USER, '2026-08-10T12:00:00.000Z')
		repo.setHold(GUILD, USER, '2026-08-10T14:00:00.000Z', '999999999999999999')

		const record = repo.get(GUILD, USER)
		expect(record?.verificationHoldAt).toBe('2026-08-10T14:00:00.000Z')
		expect(record?.verificationHoldBy).toBe('999999999999999999')
		expect(record?.verifiedAt).toBeNull()
	})

	it('clears both hold fields', () => {
		repo.setHold(GUILD, USER, '2026-08-10T14:00:00.000Z', '999999999999999999')
		repo.clearHold(GUILD, USER)

		const record = repo.get(GUILD, USER)
		expect(record?.verificationHoldAt).toBeNull()
		expect(record?.verificationHoldBy).toBeNull()
	})
})

describe('listAwaitingReminder', () => {
	const JOINED = '2026-08-10T10:00:00.000Z'
	const HOUR = 60 * 60 * 1000
	const at = (hours: number) => Date.parse(JOINED) + hours * HOUR

	beforeEach(() => repo.upsertOnJoin(GUILD, USER, JOINED))

	it('selects nobody before the first threshold', () => {
		expect(repo.listAwaitingReminder(GUILD, at(23), 24 * HOUR, 72 * HOUR)).toHaveLength(0)
	})

	it('selects a member once the first threshold passes', () => {
		expect(repo.listAwaitingReminder(GUILD, at(25), 24 * HOUR, 72 * HOUR)).toHaveLength(1)
	})

	it('excludes verified and held members', () => {
		repo.markVerified(GUILD, USER, JOINED)
		expect(repo.listAwaitingReminder(GUILD, at(25), 24 * HOUR, 72 * HOUR)).toHaveLength(0)

		repo.setHold(GUILD, USER, JOINED, 'mod')
		expect(repo.listAwaitingReminder(GUILD, at(25), 24 * HOUR, 72 * HOUR)).toHaveLength(0)
	})

	it('does not select members from a different guild', () => {
		expect(repo.listAwaitingReminder(OTHER_GUILD, at(25), 24 * HOUR, 72 * HOUR)).toHaveLength(0)
	})
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test tests/db/onboarding-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/onboarding-repository.ts`**

```ts
import type { Database } from 'better-sqlite3'
import type {
	ExperienceLevel,
	OnboardingRecord,
	OnboardingStep,
	QuestionnaireAnswers
} from '../types.js'

type OnboardingRow = {
	guild_id: string
	user_id: string
	first_joined_at: string
	last_joined_at: string
	rules_accepted_at: string | null
	questionnaire_completed_at: string | null
	intro_posted_at: string | null
	intro_message_id: string | null
	verified_at: string | null
	verification_hold_at: string | null
	verification_hold_by: string | null
	reminders_sent: number
	last_reminder_at: string | null
}

type AnswerRow = {
	guild_id: string
	user_id: string
	purpose: string | null
	experience_level: string | null
	built_for_discord: number | null
	answered_at: string | null
}

export type AnswerPatch = {
	purpose?: string
	experienceLevel?: ExperienceLevel
	builtForDiscord?: boolean
}

const STEP_COLUMNS: Record<OnboardingStep, string> = {
	rules: 'rules_accepted_at',
	questionnaire: 'questionnaire_completed_at',
	intro: 'intro_posted_at'
}

const toRecord = (row: OnboardingRow): OnboardingRecord => ({
	guildId: row.guild_id,
	userId: row.user_id,
	firstJoinedAt: row.first_joined_at,
	lastJoinedAt: row.last_joined_at,
	rulesAcceptedAt: row.rules_accepted_at,
	questionnaireCompletedAt: row.questionnaire_completed_at,
	introPostedAt: row.intro_posted_at,
	introMessageId: row.intro_message_id,
	verifiedAt: row.verified_at,
	verificationHoldAt: row.verification_hold_at,
	verificationHoldBy: row.verification_hold_by,
	remindersSent: row.reminders_sent,
	lastReminderAt: row.last_reminder_at
})

const toAnswers = (row: AnswerRow): QuestionnaireAnswers => ({
	guildId: row.guild_id,
	userId: row.user_id,
	purpose: row.purpose,
	experienceLevel: row.experience_level as ExperienceLevel | null,
	builtForDiscord: row.built_for_discord === null ? null : row.built_for_discord === 1,
	answeredAt: row.answered_at
})

export const createOnboardingRepository = (db: Database) => {
	// Compiled once at construction. These run on every gateway event in every
	// served guild, so per-call compilation would be the hottest waste in the
	// process.
	const statements = {
		get: db.prepare('SELECT * FROM onboarding WHERE guild_id = ? AND user_id = ?'),
		getAnswers: db.prepare(
			'SELECT * FROM questionnaire_answers WHERE guild_id = ? AND user_id = ?'
		),
		upsertOnJoin: db.prepare(
			`INSERT INTO onboarding (guild_id, user_id, first_joined_at, last_joined_at)
			 VALUES (?, ?, ?, ?)
			 ON CONFLICT(guild_id, user_id) DO UPDATE SET last_joined_at = excluded.last_joined_at`
		),
		setIntroMessageId: db.prepare(
			'UPDATE onboarding SET intro_message_id = COALESCE(intro_message_id, ?) WHERE guild_id = ? AND user_id = ?'
		),
		markVerified: db.prepare(
			'UPDATE onboarding SET verified_at = COALESCE(verified_at, ?) WHERE guild_id = ? AND user_id = ?'
		),
		setHold: db.prepare(
			'UPDATE onboarding SET verification_hold_at = ?, verification_hold_by = ?, verified_at = NULL WHERE guild_id = ? AND user_id = ?'
		),
		clearHold: db.prepare(
			'UPDATE onboarding SET verification_hold_at = NULL, verification_hold_by = NULL WHERE guild_id = ? AND user_id = ?'
		),
		deleteAnswers: db.prepare(
			'DELETE FROM questionnaire_answers WHERE guild_id = ? AND user_id = ?'
		),
		deleteRecord: db.prepare('DELETE FROM onboarding WHERE guild_id = ? AND user_id = ?'),
		insertAnswers: db.prepare(
			'INSERT INTO questionnaire_answers (guild_id, user_id) VALUES (?, ?) ON CONFLICT(guild_id, user_id) DO NOTHING'
		),
		setPurpose: db.prepare(
			'UPDATE questionnaire_answers SET purpose = ? WHERE guild_id = ? AND user_id = ?'
		),
		setExperience: db.prepare(
			'UPDATE questionnaire_answers SET experience_level = ? WHERE guild_id = ? AND user_id = ?'
		),
		setBuilt: db.prepare(
			'UPDATE questionnaire_answers SET built_for_discord = ? WHERE guild_id = ? AND user_id = ?'
		),
		stampAnsweredAt: db.prepare(
			'UPDATE questionnaire_answers SET answered_at = COALESCE(answered_at, ?) WHERE guild_id = ? AND user_id = ?'
		),
		stampQuestionnaireComplete: db.prepare(
			'UPDATE onboarding SET questionnaire_completed_at = COALESCE(questionnaire_completed_at, ?) WHERE guild_id = ? AND user_id = ?'
		),
		incrementReminder: db.prepare(
			'UPDATE onboarding SET reminders_sent = reminders_sent + 1, last_reminder_at = ? WHERE guild_id = ? AND user_id = ?'
		),
		// The elapsed-time comparison is pushed into SQL so a guild with a large
		// backlog does not deserialise every pending row just to discard most of
		// them in JavaScript. The idx_onboarding_pending index covers this.
		listAwaitingReminder: db.prepare(
			`SELECT * FROM onboarding
			 WHERE guild_id = ?
			   AND verified_at IS NULL
			   AND verification_hold_at IS NULL
			   AND reminders_sent < 2
			   AND (
			     (reminders_sent = 0 AND (? - CAST(strftime('%s', last_joined_at) AS INTEGER) * 1000) >= ?)
			     OR
			     (reminders_sent = 1 AND (? - CAST(strftime('%s', last_joined_at) AS INTEGER) * 1000) >= ?)
			   )
			 LIMIT ?`
		)
	}

	const stepStatements = Object.fromEntries(
		Object.entries(STEP_COLUMNS).map(([step, column]) => [
			step,
			db.prepare(
				`UPDATE onboarding SET ${column} = COALESCE(${column}, ?) WHERE guild_id = ? AND user_id = ?`
			)
		])
	) as Record<OnboardingStep, ReturnType<Database['prepare']>>

	const get = (guildId: string, userId: string): OnboardingRecord | null => {
		const row = statements.get.get(guildId, userId) as OnboardingRow | undefined
		return row ? toRecord(row) : null
	}

	const getAnswers = (guildId: string, userId: string): QuestionnaireAnswers | null => {
		const row = statements.getAnswers.get(guildId, userId) as AnswerRow | undefined
		return row ? toAnswers(row) : null
	}

	const upsertOnJoin = (guildId: string, userId: string, at: string): void => {
		statements.upsertOnJoin.run(guildId, userId, at, at)
	}

	// Transactions are built once. better-sqlite3 compiles the wrapper on
	// creation, so rebuilding it per call would defeat the point.
	const removeTx = db.transaction((guildId: string, userId: string) => {
		statements.deleteAnswers.run(guildId, userId)
		statements.deleteRecord.run(guildId, userId)
	})

	const saveAnswerTx = db.transaction(
		(guildId: string, userId: string, patch: AnswerPatch, at: string) => {
			// The member must have a record before answers can reference it.
			upsertOnJoin(guildId, userId, at)
			statements.insertAnswers.run(guildId, userId)

			if (patch.purpose !== undefined) statements.setPurpose.run(patch.purpose, guildId, userId)
			if (patch.experienceLevel !== undefined)
				statements.setExperience.run(patch.experienceLevel, guildId, userId)
			if (patch.builtForDiscord !== undefined)
				statements.setBuilt.run(patch.builtForDiscord ? 1 : 0, guildId, userId)

			const row = statements.getAnswers.get(guildId, userId) as AnswerRow

			const complete =
				row.purpose !== null && row.experience_level !== null && row.built_for_discord !== null

			if (complete) {
				statements.stampAnsweredAt.run(at, guildId, userId)
				statements.stampQuestionnaireComplete.run(at, guildId, userId)
			}
		}
	)

	return {
		get,
		getAnswers,
		upsertOnJoin,

		stampStep: (guildId: string, userId: string, step: OnboardingStep, at: string): void => {
			stepStatements[step].run(at, guildId, userId)
		},

		setIntroMessageId: (guildId: string, userId: string, messageId: string): void => {
			statements.setIntroMessageId.run(messageId, guildId, userId)
		},

		markVerified: (guildId: string, userId: string, at: string): void => {
			statements.markVerified.run(at, guildId, userId)
		},

		setHold: (guildId: string, userId: string, at: string, byUserId: string): void => {
			statements.setHold.run(at, byUserId, guildId, userId)
		},

		clearHold: (guildId: string, userId: string): void => {
			statements.clearHold.run(guildId, userId)
		},

		remove: (guildId: string, userId: string): void => {
			removeTx(guildId, userId)
		},

		saveAnswer: (guildId: string, userId: string, patch: AnswerPatch, at: string): void => {
			saveAnswerTx(guildId, userId, patch, at)
		},

		listAwaitingReminder: (
			guildId: string,
			nowMs: number,
			firstAfterMs: number,
			secondAfterMs: number,
			limit = 500
		): OnboardingRecord[] =>
			(
				statements.listAwaitingReminder.all(
					guildId,
					nowMs,
					firstAfterMs,
					nowMs,
					secondAfterMs,
					limit
				) as OnboardingRow[]
			).map(toRecord),

		incrementReminder: (guildId: string, userId: string, at: string): void => {
			statements.incrementReminder.run(at, guildId, userId)
		}
	}
}

export type OnboardingRepository = ReturnType<typeof createOnboardingRepository>
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm test tests/db/onboarding-repository.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/onboarding-repository.ts tests/db/onboarding-repository.test.ts
git commit -m "feat: add guild-scoped onboarding repository"
```

---

### Task 7: Client bootstrap

**Files:**

- Create: `src/discord/client.ts`, `src/index.ts`

**Interfaces:**

- Consumes: `Env`, `migrate`, both repositories.
- Produces: `createClient(): Client` and a running process that connects, opens the database, and registers a `guildCreate` handler that calls `guildConfig.ensure`. Plan 02 adds commands on top of this.

- [ ] **Step 1: Write `src/discord/client.ts`**

```ts
import { Client, GatewayIntentBits, Options } from 'discord.js'

export const createClient = (): Client =>
	new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildMessages
		],

		// Default caching retains messages, users, reactions and presences
		// indefinitely. Across thousands of guilds that is the dominant memory
		// cost, and this bot never re-reads any of it: the intro watcher only
		// needs the message currently in hand, and member lookups go through the
		// REST fetch in the port.
		makeCache: Options.cacheWithLimits({
			...Options.DefaultMakeCacheSettings,
			MessageManager: 0,
			ReactionManager: 0,
			GuildMessageManager: 0,
			PresenceManager: 0,
			ThreadManager: 0,
			GuildStickerManager: 0,
			GuildEmojiManager: 0
			// Members and roles are cached, since preflight and reconciliation
			// read them constantly. Members are swept below.
		}),

		sweepers: {
			...Options.DefaultSweeperSettings,
			// Drop members who have been idle for an hour. They are re-fetched on
			// demand; holding every member of every guild resident is what makes
			// large bots run out of memory.
			guildMembers: {
				interval: 600,
				filter: () => (member) => member.id !== member.client.user.id
			},
			users: {
				interval: 3600,
				filter: () => (user) => user.id !== user.client.user.id
			}
		}
	})
```

- [ ] **Step 2: Write `src/discord/safe-handler.ts`**

Every gateway listener goes through this. An unhandled rejection inside a listener terminates the Node process — which, for a bot serving many guilds, is an outage for all of them.

```ts
export const safeHandler =
	<Args extends unknown[]>(name: string, handler: (...args: Args) => Promise<void>) =>
	(...args: Args): void => {
		handler(...args).catch((error: unknown) => {
			console.error(
				JSON.stringify({
					level: 'error',
					event: 'handler-failed',
					handler: name,
					error: error instanceof Error ? error.message : String(error)
				})
			)
		})
	}
```

- [ ] **Step 3: Write `src/index.ts`**

```ts
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'
import { Events } from 'discord.js'
import 'dotenv/config'
import { createGuildConfigRepository } from './db/guild-config-repository.js'
import { migrate } from './db/migrate.js'
import { createOnboardingRepository } from './db/onboarding-repository.js'
import { createClient } from './discord/client.js'
import { safeHandler } from './discord/safe-handler.js'
import { loadEnv } from './env.js'

const env = loadEnv()

mkdirSync(dirname(env.databasePath), { recursive: true })
const db = new Database(env.databasePath)
migrate(db)

const guildConfig = createGuildConfigRepository(db)
const onboarding = createOnboardingRepository(db)

const client = createClient()

client.once(
	Events.ClientReady,
	safeHandler('ready', async (ready) => {
		const now = new Date().toISOString()

		// Any guild the bot is already in gets a config row, so /config has
		// something to write to without a separate first-run step.
		for (const [guildId] of await ready.guilds.fetch()) guildConfig.ensure(guildId, now)

		console.info(
			JSON.stringify({
				level: 'info',
				event: 'ready',
				user: ready.user.tag,
				guilds: ready.guilds.cache.size,
				enabled: guildConfig.listEnabled().length
			})
		)
	})
)

client.on(
	Events.GuildCreate,
	safeHandler('guildCreate', async (guild) => {
		guildConfig.ensure(guild.id, new Date().toISOString())
		console.info(JSON.stringify({ level: 'info', event: 'guild-joined', guildId: guild.id }))
	})
)

const shutdown = (): void => {
	void client.destroy()
	db.close()
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await client.login(env.discordToken)
```

Note `onboarding` is unused until plan 03. Keep the binding — the wiring belongs here and plan 03 consumes it.

- [ ] **Step 4: Verify it compiles**

Run: `pnpm typecheck`
Expected: no errors. (If `onboarding` trips an unused-variable rule, that rule is not enabled in this tsconfig — `noUnusedLocals` is deliberately off.)

- [ ] **Step 5: Verify it fails loudly with no token**

Run: `env -u DISCORD_TOKEN pnpm dev`
Expected: exits with `Missing required environment variable: DISCORD_TOKEN`.

- [ ] **Step 6: Verify it connects and records guilds**

Put a real token in `.env`, invite the bot to a throwaway guild, run `pnpm dev`.
Expected: a `ready` log line reporting the guild count with `enabled: 0`. Invite it to a second guild while running and confirm a `guild-joined` line appears.

- [ ] **Step 7: Commit**

```bash
git add src/discord src/index.ts
git commit -m "feat: add client bootstrap with per-guild config rows"
```

## Acceptance Criteria

- `pnpm test` passes; `pnpm typecheck` covers `src/` **and** `tests/` with no errors
- Running `migrate` twice against the same database is a no-op and preserves data
- The same user id can hold independent records in two different guilds, and removing one leaves the other intact
- `listAwaitingReminder` never returns a member from another guild
- Starting with no `DISCORD_TOKEN` exits immediately naming that variable
- Joining a new guild creates a `guild_config` row with `enabled = 0`
- The bot takes **no** action in any guild at this stage — no roles, no messages

## UI/UX Pattern

_N/A — no web UI surface._

## Open Questions

- [ ] None.

## Dependencies

- Requires: —
- Blocks: [[02-guild-configuration]]

## Decisions

- 2026-08-10 — **Every SQL statement is compiled once at repository construction**, not per call. `get` and `getAnswers` run on effectively every gateway event; recompiling their SQL each time was the hottest avoidable cost in the process. Transactions are built once for the same reason.
- 2026-08-10 — `listAwaitingReminder` filters elapsed time in SQL and takes a `LIMIT`. Filtering in JavaScript would deserialise every pending row in every guild on every sweep tick.
- 2026-08-10 — discord.js caches are bounded and swept. Defaults retain messages, presences and users indefinitely, which is the dominant memory cost for a bot in many guilds and buys this bot nothing.
- 2026-08-10 — File databases run in WAL with `synchronous = NORMAL` and a busy timeout, which is what makes one database file safe to share across shard processes. Skipped for in-memory test databases, where WAL is unsupported.
- 2026-08-10 — `module`/`moduleResolution` are `NodeNext`, not `bundler`: this code runs directly on Node, so the compiler should model real ESM resolution and require the `.js` extensions Node needs.
- 2026-08-10 — `typecheck` runs a second pass over `tsconfig.test.json` because Vitest transpiles without type checking; without it a type error in a test is invisible.
- 2026-08-10 — `test` uses `--passWithNoTests` so the very first verification step does not fail on an empty suite.
- 2026-08-10 — `saveAnswer` upserts the onboarding record first, so an answer can never violate the foreign key or be orphaned.
- 2026-08-10 — Every gateway listener is wrapped in `safeHandler`; an unhandled rejection in a listener would otherwise kill the process for every guild at once.
