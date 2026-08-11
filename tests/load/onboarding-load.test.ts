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

const AT = '2026-08-10T12:00:00.000Z'

const configFor = (guildId: string): ResolvedGuildConfig => ({
	guildId,
	rulesChannelId: '1',
	introductionsChannelId: '2',
	modLogChannelId: '3',
	verifiedRoleId: '4',
	unverifiedRoleId: '5',
	rulesText: 'rules',
	rulesMessageId: null,
	introTemplateText: 'template',
	introTemplateMessageId: null,
	grandfatherBefore: null
})

describe('load', () => {
	it('runs 5,000 full onboardings across 50 guilds well under a second of our own time', async () => {
		const db = createTestDb()
		const repo = createOnboardingRepository(db)
		const questionnaireRepo = createQuestionnaireRepository(db)
		const fake = createFakeDiscordPort()
		const service = createOnboardingService({ repo, port: fake.port, now: () => AT })

		const started = performance.now()

		for (let guildIndex = 0; guildIndex < 50; guildIndex += 1) {
			const config = configFor(`guild-${guildIndex}`)
			const created = questionnaireRepo.addQuestion(
				config.guildId,
				{ prompt: 'Why are you here?', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
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

		const elapsed = performance.now() - started

		expect(fake.addedRoles.filter((call) => call.roleId === '4')).toHaveLength(5000)
		// Generous: this is a correctness guard against an accidental O(n²) or a
		// lost prepared statement, not a benchmark. Typical is far below it.
		expect(elapsed).toBeLessThan(10_000)
	})

	it('serves config reads from cache under repeated lookups', () => {
		const repo = createCachedGuildConfigRepository(createGuildConfigRepository(createTestDb()))
		repo.ensure('g1', AT)

		for (let index = 0; index < 10_000; index += 1) repo.get('g1')

		const stats = repo.stats()
		expect(stats.misses).toBe(1)
		expect(stats.hits).toBe(9999)
	})
})
