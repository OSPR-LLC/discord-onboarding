import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { EXPERIENCE_LEVELS } from '../../src/types.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const USER = '223456789012345678'
const MOD = '323456789012345678'
const VERIFIED = '423456789012345678'
const UNVERIFIED = '523456789012345678'

const CLOCK = '2026-08-10T12:00:00.000Z'
const ENABLED_AT = '2026-08-10T00:00:00.000Z'
const JOINED_AFTER = Date.parse('2026-08-10T06:00:00.000Z')
const JOINED_BEFORE = Date.parse('2026-08-01T00:00:00.000Z')

const config: ResolvedGuildConfig = {
	guildId: GUILD,
	rulesChannelId: '1',
	introductionsChannelId: '2',
	modLogChannelId: '3',
	verifiedRoleId: VERIFIED,
	unverifiedRoleId: UNVERIFIED,
	rulesText: 'Be nice.',
	rulesMessageId: null,
	grandfatherBefore: ENABLED_AT
}

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let service: ReturnType<typeof createOnboardingService>

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	service = createOnboardingService({ repo, port: fake.port, now: () => CLOCK })
})

const completeAllSteps = async () => {
	await service.recordStep(config, USER, 'rules')
	repo.saveAnswer(GUILD, USER, { purpose: 'learning' }, CLOCK)
	repo.saveAnswer(GUILD, USER, { experienceLevel: EXPERIENCE_LEVELS.SOME }, CLOCK)
	repo.saveAnswer(GUILD, USER, { builtForDiscord: false }, CLOCK)
	await service.recordStep(config, USER, 'questionnaire')
	return service.recordStep(config, USER, 'intro')
}

describe('handleJoin', () => {
	it('applies unverified to a member who joined after the guild was enabled', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
	})

	it('completely ignores a member who joined before the guild was enabled', async () => {
		await service.handleJoin(config, USER, JOINED_BEFORE)
		expect(fake.addedRoles).toHaveLength(0)
		expect(repo.get(GUILD, USER)).toBeNull()
	})

	it('applies unverified to everyone when no grandfather cutoff is set', async () => {
		await service.handleJoin({ ...config, grandfatherBefore: null }, USER, JOINED_BEFORE)
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
	})

	it('restores verified without re-running the flow for a returning verified member', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await completeAllSteps()
		fake.addedRoles.length = 0

		await service.handleJoin(config, USER, JOINED_AFTER)

		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
		expect(fake.addedRoles).not.toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
	})

	it('does not restore verified for a returning member under a hold', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await completeAllSteps()
		await service.applyHold(config, USER, MOD)
		fake.addedRoles.length = 0

		await service.handleJoin(config, USER, JOINED_AFTER)

		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
		expect(fake.addedRoles).not.toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
	})
})

describe('recordStep', () => {
	beforeEach(() => service.handleJoin(config, USER, JOINED_AFTER))

	it('reports incomplete until all three steps are done', async () => {
		expect(await service.recordStep(config, USER, 'rules')).toBe('incomplete')
		expect(await service.recordStep(config, USER, 'intro')).toBe('incomplete')
	})

	it('grants verified and removes unverified once every step is done', async () => {
		expect(await completeAllSteps()).toBe('grant')
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
		expect(fake.removedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
		expect(repo.get(GUILD, USER)?.verifiedAt).toBe(CLOCK)
	})

	it('accepts steps in any order', async () => {
		await service.recordStep(config, USER, 'intro')
		repo.saveAnswer(GUILD, USER, { purpose: 'p' }, CLOCK)
		repo.saveAnswer(GUILD, USER, { experienceLevel: EXPERIENCE_LEVELS.NEW }, CLOCK)
		repo.saveAnswer(GUILD, USER, { builtForDiscord: true }, CLOCK)
		await service.recordStep(config, USER, 'questionnaire')
		expect(await service.recordStep(config, USER, 'rules')).toBe('grant')
	})

	it('writes an audit entry when a member is verified', async () => {
		await completeAllSteps()
		expect(fake.audits.some((entry) => entry.kind === 'verified' && entry.userId === USER)).toBe(
			true
		)
	})

	it('still grants the role when the welcome DM fails', async () => {
		fake.failDmFor(USER)
		expect(await completeAllSteps()).toBe('grant')
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
	})

	it('does not mark the member verified when the role assignment fails', async () => {
		fake.failRoleFor(USER)
		await completeAllSteps()
		expect(repo.get(GUILD, USER)?.verifiedAt).toBeNull()
	})

	it('creates a record for a member it has never seen rather than doing nothing', async () => {
		const stranger = '723456789012345678'
		expect(await service.recordStep(config, stranger, 'rules')).toBe('incomplete')
		expect(repo.get(GUILD, stranger)?.rulesAcceptedAt).toBe(CLOCK)
	})
})

describe('applyHold', () => {
	beforeEach(async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await completeAllSteps()
	})

	it('removes verified and re-applies unverified', async () => {
		await service.applyHold(config, USER, MOD)
		expect(fake.removedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: UNVERIFIED })
	})

	it('keeps the member unverified even when a further step fires', async () => {
		await service.applyHold(config, USER, MOD)
		fake.addedRoles.length = 0
		expect(await service.recordStep(config, USER, 'rules')).toBe('held')
		expect(fake.addedRoles).not.toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
	})

	it('records the acting moderator', async () => {
		await service.applyHold(config, USER, MOD)
		expect(repo.get(GUILD, USER)?.verificationHoldBy).toBe(MOD)
	})
})

describe('liftHoldAndVerify', () => {
	it('verifies a member who never completed a step', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await service.liftHoldAndVerify(config, USER, MOD)
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
		expect(repo.get(GUILD, USER)?.verifiedAt).toBe(CLOCK)
	})

	it('verifies a member the bot has no record of', async () => {
		const stranger = '823456789012345678'
		await service.liftHoldAndVerify(config, stranger, MOD)
		expect(repo.get(GUILD, stranger)?.verifiedAt).toBe(CLOCK)
	})
})

describe('resetMember', () => {
	it('deletes the record and returns the member to unverified', async () => {
		await service.handleJoin(config, USER, JOINED_AFTER)
		await completeAllSteps()
		await service.resetMember(config, USER)
		expect(repo.get(GUILD, USER)).toBeNull()
		expect(fake.removedRoles).toContainEqual({ guildId: GUILD, userId: USER, roleId: VERIFIED })
	})
})
