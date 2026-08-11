const NAMESPACE = 'onboarding'

export const CUSTOM_IDS = {
	rulesAgree: `${NAMESPACE}:rules-agree`,
	questionAnswerInput: `${NAMESPACE}:question-answer`,
	questionModal: (questionId: number) => `${NAMESPACE}:question-modal:${questionId}`,
	questionSelect: (questionId: number) => `${NAMESPACE}:question-select:${questionId}`,
	questionSkip: (questionId: number) => `${NAMESPACE}:question-skip:${questionId}`,
	questionRetry: (questionId: number) => `${NAMESPACE}:question-retry:${questionId}`,
	rulesTextModal: `${NAMESPACE}:rules-text-modal`,
	rulesTextInput: `${NAMESPACE}:rules-text-input`,
	introTemplateModal: `${NAMESPACE}:intro-template-modal`,
	introTemplateInput: `${NAMESPACE}:intro-template-input`
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
