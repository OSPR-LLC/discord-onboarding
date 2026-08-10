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
