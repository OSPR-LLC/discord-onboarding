const NAMESPACE = 'onboarding'

export const CUSTOM_IDS = {
	rulesAgree: `${NAMESPACE}:rules-agree`,
	purposeModal: `${NAMESPACE}:q1-modal`,
	purposeInput: `${NAMESPACE}:q1-input`,
	experienceSelect: `${NAMESPACE}:q2`,
	builtYes: `${NAMESPACE}:q3:yes`,
	builtNo: `${NAMESPACE}:q3:no`,
	rulesTextModal: `${NAMESPACE}:rules-text-modal`,
	rulesTextInput: `${NAMESPACE}:rules-text-input`
} as const

export type ParsedCustomId = {
	readonly namespace: string
	readonly action: string
	readonly value?: string
}

export const parseCustomId = (raw: string): ParsedCustomId | null => {
	const [namespace, action, value] = raw.split(':')
	if (namespace !== NAMESPACE || !action) return null
	return value === undefined ? { namespace, action } : { namespace, action, value }
}
