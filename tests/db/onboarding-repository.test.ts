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
