import { beforeEach, describe, expect, it } from 'vitest'
import type { ResolvedGuildConfig } from '../../src/core/guild-config.js'
import { createOnboardingService } from '../../src/core/onboarding-service.js'
import { createOnboardingRepository } from '../../src/db/onboarding-repository.js'
import { reconcileMembers } from '../../src/tasks/reconcile.js'
import { createFakeDiscordPort } from '../helpers/fake-discord-port.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const VERIFIED = '423456789012345678'
const UNVERIFIED = '523456789012345678'
const AT = '2026-08-10T12:00:00.000Z'
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
	rulesText: 'rules',
	rulesMessageId: null,
	grandfatherBefore: ENABLED_AT
}

let repo: ReturnType<typeof createOnboardingRepository>
let fake: ReturnType<typeof createFakeDiscordPort>
let deps: Parameters<typeof reconcileMembers>[0]

const member = (userId: string, roleIds: string[] = [], joinedAtMs = JOINED_AFTER) => ({
	userId,
	isBot: false,
	joinedAtMs,
	roleIds
})

beforeEach(() => {
	repo = createOnboardingRepository(createTestDb())
	fake = createFakeDiscordPort()
	deps = {
		repo,
		service: createOnboardingService({ repo, port: fake.port, now: () => AT }),
		port: fake.port
	}
})

describe('reconcileMembers', () => {
	it('creates a record and applies unverified for someone who joined during downtime', async () => {
		await reconcileMembers(deps, config, [member('u1')])
		expect(repo.get(GUILD, 'u1')).not.toBeNull()
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: 'u1', roleId: UNVERIFIED })
	})

	it('never touches a member who joined before the guild was enabled', async () => {
		await reconcileMembers(deps, config, [member('u2', [], JOINED_BEFORE)])
		expect(repo.get(GUILD, 'u2')).toBeNull()
		expect(fake.addedRoles).toHaveLength(0)
	})

	it('skips bots entirely', async () => {
		await reconcileMembers(deps, config, [{ ...member('bot'), isBot: true }])
		expect(fake.addedRoles).toHaveLength(0)
	})

	it('re-applies a missing verified role', async () => {
		repo.upsertOnJoin(GUILD, 'u3', AT)
		repo.markVerified(GUILD, 'u3', AT)
		await reconcileMembers(deps, config, [member('u3')])
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: 'u3', roleId: VERIFIED })
	})

	it('strips the verified role from a held member', async () => {
		repo.upsertOnJoin(GUILD, 'u4', AT)
		repo.setHold(GUILD, 'u4', AT, 'mod')
		await reconcileMembers(deps, config, [member('u4', [VERIFIED])])
		expect(fake.removedRoles).toContainEqual({ guildId: GUILD, userId: 'u4', roleId: VERIFIED })
	})

	it('grants verified to someone who finished every step while the bot was offline', async () => {
		repo.upsertOnJoin(GUILD, 'u5', AT)
		for (const step of ['rules', 'questionnaire', 'intro'] as const)
			repo.stampStep(GUILD, 'u5', step, AT)

		await reconcileMembers(deps, config, [member('u5', [UNVERIFIED])])
		expect(fake.addedRoles).toContainEqual({ guildId: GUILD, userId: 'u5', roleId: VERIFIED })
	})

	it('reports an anomaly for someone holding verified with no record', async () => {
		await reconcileMembers(deps, config, [member('u6', [VERIFIED])])
		expect(fake.audits.some((entry) => entry.kind === 'reconcile-anomaly')).toBe(true)
	})

	it('summarises what it did', async () => {
		const summary = await reconcileMembers(deps, config, [
			member('a'),
			member('b'),
			member('c', [], JOINED_BEFORE)
		])
		expect(summary.created).toBe(2)
		expect(summary.grandfathered).toBe(1)
	})
})

describe('chunking', () => {
	it('processes every member across multiple chunks', async () => {
		const many = Array.from({ length: 25 }, (_unused, index) => member(`u${index}`))

		const summary = await reconcileMembers(deps, config, many, { chunkSize: 10 })

		expect(summary.created).toBe(25)
	})

	it('reports progress once per chunk', async () => {
		const many = Array.from({ length: 25 }, (_unused, index) => member(`u${index}`))
		const progress: number[] = []

		await reconcileMembers(deps, config, many, {
			chunkSize: 10,
			onProgress: (processed) => progress.push(processed)
		})

		expect(progress).toEqual([10, 20, 25])
	})

	it('yields to the event loop between chunks', async () => {
		const many = Array.from({ length: 20 }, (_unused, index) => member(`u${index}`))
		let interleaved = false

		const reconciling = reconcileMembers(deps, config, many, { chunkSize: 5 })
		// If the loop never yields, this timer cannot run before it finishes.
		setTimeout(() => {
			interleaved = true
		}, 0)

		await reconciling
		expect(interleaved).toBe(true)
	})
})
