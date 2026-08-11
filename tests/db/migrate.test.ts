import Database from 'better-sqlite3'
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

	it('adds intro_template columns to a database created before they existed', () => {
		// Simulates an existing deployment: a guild_config table built from an
		// older schema.sql, predating the intro-template columns entirely.
		const db = new Database(':memory:')
		db.exec(`
			CREATE TABLE guild_config (
				guild_id TEXT PRIMARY KEY,
				rules_text TEXT,
				enabled INTEGER NOT NULL DEFAULT 0,
				joined_at TEXT NOT NULL
			)
		`)
		db.prepare(
			"INSERT INTO guild_config (guild_id, joined_at) VALUES ('g1', '2026-08-10T00:00:00.000Z')"
		).run()

		expect(() => migrate(db)).not.toThrow()

		const columns = (db.pragma('table_info(guild_config)') as { name: string }[]).map(
			(row) => row.name
		)
		expect(columns).toContain('intro_template_text')
		expect(columns).toContain('intro_template_message_id')
		// The pre-existing row survives the migration untouched.
		expect(db.prepare('SELECT COUNT(*) AS n FROM guild_config').get()).toEqual({ n: 1 })
	})

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
				verified_at TEXT,
				verification_hold_at TEXT,
				reminders_sent INTEGER NOT NULL DEFAULT 0,
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
})
