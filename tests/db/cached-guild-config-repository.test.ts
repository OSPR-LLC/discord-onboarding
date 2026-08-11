import { beforeEach, describe, expect, it } from 'vitest'
import { createCachedGuildConfigRepository } from '../../src/db/cached-guild-config-repository.js'
import { createGuildConfigRepository } from '../../src/db/guild-config-repository.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const OTHER = '223456789012345678'
const ACTOR = '323456789012345678'
const AT = '2026-08-10T10:00:00.000Z'

let inner: ReturnType<typeof createGuildConfigRepository>
let repo: ReturnType<typeof createCachedGuildConfigRepository>

beforeEach(() => {
	inner = createGuildConfigRepository(createTestDb())
	repo = createCachedGuildConfigRepository(inner)
	repo.ensure(GUILD, AT)
})

describe('caching', () => {
	it('returns the same value as the underlying repository', () => {
		repo.setChannel(GUILD, 'rules', '111', ACTOR, AT)
		expect(repo.get(GUILD)?.rulesChannelId).toBe(inner.get(GUILD)?.rulesChannelId)
	})

	it('serves repeat reads from cache', () => {
		repo.get(GUILD)
		repo.get(GUILD)
		repo.get(GUILD)
		expect(repo.stats().hits).toBe(2)
	})

	it('caches the absence of a guild without re-querying', () => {
		repo.get('999999999999999999')
		repo.get('999999999999999999')
		expect(repo.stats().hits).toBe(1)
	})
})

describe('invalidation', () => {
	it.each([
		['setChannel', () => repo.setChannel(GUILD, 'rules', '111', ACTOR, AT)],
		['setRole', () => repo.setRole(GUILD, 'verified', '222', ACTOR, AT)],
		['setRulesText', () => repo.setRulesText(GUILD, 'text', ACTOR, AT)],
		['setRulesMessageId', () => repo.setRulesMessageId(GUILD, '333')],
		['setIntroTemplateText', () => repo.setIntroTemplateText(GUILD, 'text', ACTOR, AT)],
		['setIntroTemplateMessageId', () => repo.setIntroTemplateMessageId(GUILD, '444')],
		['enable', () => repo.enable(GUILD, AT, ACTOR, AT)],
		['disable', () => repo.disable(GUILD)],
		['clearGrandfather', () => repo.clearGrandfather(GUILD)],
		['remove', () => repo.remove(GUILD)]
	])('%s invalidates the cached row', (_name, mutate) => {
		repo.get(GUILD)
		mutate()
		const before = repo.stats().hits
		repo.get(GUILD)
		expect(repo.stats().hits).toBe(before)
	})

	it('a write to one guild does not invalidate another', () => {
		repo.ensure(OTHER, AT)
		repo.get(GUILD)
		repo.get(OTHER)

		repo.setChannel(OTHER, 'rules', '111', ACTOR, AT)

		const before = repo.stats().hits
		repo.get(GUILD)
		expect(repo.stats().hits).toBe(before + 1)
	})

	it('reflects a write immediately on the next read', () => {
		repo.get(GUILD)
		repo.enable(GUILD, AT, ACTOR, AT)
		expect(repo.get(GUILD)?.enabled).toBe(true)
	})
})
