import { describe, expect, it } from 'vitest'
import { evaluateGate } from '../../src/core/gate.js'
import type { OnboardingRecord } from '../../src/types.js'

const AT = '2026-08-10T11:00:00.000Z'

const baseRecord: OnboardingRecord = {
	guildId: 'g1',
	userId: 'u1',
	firstJoinedAt: AT,
	lastJoinedAt: AT,
	rulesAcceptedAt: null,
	questionnaireCompletedAt: null,
	introPostedAt: null,
	introMessageId: null,
	verifiedAt: null,
	verificationHoldAt: null,
	verificationHoldBy: null,
	remindersSent: 0,
	lastReminderAt: null
}

const allSteps = { rulesAcceptedAt: AT, questionnaireCompletedAt: AT, introPostedAt: AT }

describe('evaluateGate', () => {
	it('returns incomplete when no steps are done', () => {
		expect(evaluateGate(baseRecord)).toBe('incomplete')
	})

	it.each([
		['only rules', { rulesAcceptedAt: AT }],
		['only questionnaire', { questionnaireCompletedAt: AT }],
		['only intro', { introPostedAt: AT }],
		['rules and questionnaire', { rulesAcceptedAt: AT, questionnaireCompletedAt: AT }],
		['rules and intro', { rulesAcceptedAt: AT, introPostedAt: AT }],
		['questionnaire and intro', { questionnaireCompletedAt: AT, introPostedAt: AT }]
	])('returns incomplete with %s done', (_label, steps) => {
		expect(evaluateGate({ ...baseRecord, ...steps })).toBe('incomplete')
	})

	it('returns grant when all three steps are done', () => {
		expect(evaluateGate({ ...baseRecord, ...allSteps })).toBe('grant')
	})

	it('returns already-verified when the member is verified', () => {
		expect(evaluateGate({ ...baseRecord, ...allSteps, verifiedAt: AT })).toBe('already-verified')
	})

	it('returns held for a held member even when every step is complete', () => {
		expect(evaluateGate({ ...baseRecord, ...allSteps, verificationHoldAt: AT })).toBe('held')
	})

	it('prefers held over already-verified so unverify cannot be undone by a later event', () => {
		expect(
			evaluateGate({ ...baseRecord, ...allSteps, verifiedAt: AT, verificationHoldAt: AT })
		).toBe('held')
	})
})
