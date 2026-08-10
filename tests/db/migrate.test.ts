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
