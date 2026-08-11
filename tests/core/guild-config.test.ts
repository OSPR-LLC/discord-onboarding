import { describe, expect, it } from 'vitest'
import { resolveGuildConfig } from '../../src/core/guild-config.js'
import { isOk } from '../../src/types.js'
import type { GuildConfigRow } from '../../src/types.js'

const complete: GuildConfigRow = {
	guildId: '1',
	rulesChannelId: '2',
	introductionsChannelId: '3',
	modLogChannelId: '4',
	verifiedRoleId: '5',
	unverifiedRoleId: '6',
	rulesText: 'Be nice.',
	rulesMessageId: null,
	introTemplateText: 'Name:',
	introTemplateMessageId: null,
	enabled: true,
	grandfatherBefore: '2026-08-10T00:00:00.000Z',
	joinedAt: '2026-08-01T00:00:00.000Z',
	configuredAt: null,
	configuredBy: null
}

describe('resolveGuildConfig', () => {
	it('resolves a complete row', () => {
		const result = resolveGuildConfig(complete)
		expect(isOk(result)).toBe(true)
		if (isOk(result)) expect(result.value.rulesChannelId).toBe('2')
	})

	it('reports a null guild as entirely unconfigured', () => {
		const result = resolveGuildConfig(null)
		expect(isOk(result)).toBe(false)
		if (!isOk(result)) expect(result.error.length).toBeGreaterThan(0)
	})

	// Typed as a tuple of literal keys rather than plain strings: a computed
	// key of type `string` in the spread below would widen the object and fail
	// to typecheck against GuildConfigRow.
	const requiredFields = [
		'rulesChannelId',
		'introductionsChannelId',
		'modLogChannelId',
		'verifiedRoleId',
		'unverifiedRoleId'
	] as const satisfies readonly (keyof GuildConfigRow)[]

	it.each(requiredFields)('names %s when it is missing', (field) => {
		const result = resolveGuildConfig({ ...complete, [field]: null })
		expect(isOk(result)).toBe(false)
		if (!isOk(result)) expect(result.error.map((problem) => problem.field)).toContain(field)
	})

	it('reports every missing field at once rather than only the first', () => {
		const result = resolveGuildConfig({
			...complete,
			rulesChannelId: null,
			verifiedRoleId: null
		})
		if (!isOk(result)) expect(result.error).toHaveLength(2)
	})

	it('falls back to the default rules text when none has been set', () => {
		const result = resolveGuildConfig({ ...complete, rulesText: null })
		expect(isOk(result)).toBe(true)
		if (isOk(result)) expect(result.value.rulesText.length).toBeGreaterThan(0)
	})

	it('falls back to the default intro template when none has been set', () => {
		const result = resolveGuildConfig({ ...complete, introTemplateText: null })
		expect(isOk(result)).toBe(true)
		if (isOk(result)) expect(result.value.introTemplateText.length).toBeGreaterThan(0)
	})
})
