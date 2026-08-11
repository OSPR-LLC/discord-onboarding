import type { OnboardingRecord } from '../types.js'

export type GateDecision = 'grant' | 'already-verified' | 'held' | 'incomplete'

export const evaluateGate = (record: OnboardingRecord): GateDecision => {
	if (record.verificationHoldAt) return 'held'
	if (record.verifiedAt) return 'already-verified'
	if (record.rulesAcceptedAt && record.questionnaireCompletedAt && record.introPostedAt)
		return 'grant'
	return 'incomplete'
}
