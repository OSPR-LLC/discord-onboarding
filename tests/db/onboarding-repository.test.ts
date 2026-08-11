import { beforeEach, describe, expect, it } from 'vitest'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const OTHER_GUILD = '923456789012345678'
const USER = '223456789012345678'

let db: ReturnType<typeof createTestDb>
let repo: ReturnType<typeof createOnboardingRepository>

beforeEach(() => {
	db = createTestDb()
	repo = createOnboardingRepository(db)
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
		db.prepare(
			`INSERT INTO questionnaire_questions (id, guild_id, position, prompt, type, required, created_at)
			 VALUES (1, ?, 1, 'Q1', 'text', 1, '2026-08-10T00:00:00.000Z'),
			        (2, ?, 1, 'Q1', 'text', 1, '2026-08-10T00:00:00.000Z')`
		).run(GUILD, OTHER_GUILD)
	})

	it('keeps step progress separate for the same user in two guilds', () => {
		repo.stampStep(GUILD, USER, 'rules', '2026-08-10T11:00:00.000Z')
		expect(repo.get(GUILD, USER)?.rulesAcceptedAt).not.toBeNull()
		expect(repo.get(OTHER_GUILD, USER)?.rulesAcceptedAt).toBeNull()
	})

	it('keeps answers separate for the same user in two guilds', () => {
		repo.saveAnswer(GUILD, USER, 1, { textValue: 'here for the code', selectedValues: [] }, '2026-08-10T11:00:00.000Z')
		expect(repo.getAnswers(GUILD, USER)).toEqual([
			{ questionId: 1, textValue: 'here for the code', selectedValues: [] }
		])
		expect(repo.getAnswers(OTHER_GUILD, USER)).toEqual([])
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
	beforeEach(() => {
		repo.upsertOnJoin(GUILD, USER, '2026-08-10T10:00:00.000Z')
		db.prepare(
			`INSERT INTO questionnaire_questions (id, guild_id, position, prompt, type, required, created_at)
			 VALUES (1, ?, 1, 'Q1', 'text', 1, '2026-08-10T00:00:00.000Z'),
			        (2, ?, 2, 'Q2', 'text', 1, '2026-08-10T00:00:00.000Z')`
		).run(GUILD, GUILD)
	})

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
