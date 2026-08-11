import { describe, expect, it } from 'vitest'
import { CUSTOM_IDS, parseCustomId } from '../../src/discord/components/custom-ids.js'

describe('parseCustomId', () => {
	it('parses the rules agree button', () => {
		expect(parseCustomId(CUSTOM_IDS.rulesAgree)).toEqual({
			namespace: 'onboarding',
			action: 'rules-agree'
		})
	})

	it('parses a yes/no answer with its value', () => {
		expect(parseCustomId('onboarding:q3:yes')).toEqual({
			namespace: 'onboarding',
			action: 'q3',
			value: 'yes'
		})
	})

	it('returns null for an id belonging to another bot', () => {
		expect(parseCustomId('other-bot:thing')).toBeNull()
	})

	it('returns null for a malformed id', () => {
		expect(parseCustomId('onboarding')).toBeNull()
	})
})
