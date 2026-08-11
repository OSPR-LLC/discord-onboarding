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

describe('dynamic question custom ids', () => {
	it('builds a parseable modal id for a question', () => {
		expect(parseCustomId(CUSTOM_IDS.questionModal(42))).toEqual({
			namespace: 'onboarding',
			action: 'question-modal',
			value: '42'
		})
	})

	it('builds a parseable select id for a question', () => {
		expect(parseCustomId(CUSTOM_IDS.questionSelect(7))).toEqual({
			namespace: 'onboarding',
			action: 'question-select',
			value: '7'
		})
	})

	it('builds a parseable skip id for a question', () => {
		expect(parseCustomId(CUSTOM_IDS.questionSkip(7))).toEqual({
			namespace: 'onboarding',
			action: 'question-skip',
			value: '7'
		})
	})

	it('builds a parseable retry id for a question', () => {
		expect(parseCustomId(CUSTOM_IDS.questionRetry(7))).toEqual({
			namespace: 'onboarding',
			action: 'question-retry',
			value: '7'
		})
	})
})
