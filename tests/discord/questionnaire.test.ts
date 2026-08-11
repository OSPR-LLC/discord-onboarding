import { describe, expect, it } from 'vitest'
import {
	buildQuestionModal,
	buildQuestionSelectRow,
	buildQuestionSkipRow
} from '../../src/discord/components/questionnaire.js'
import type { QuestionDefinition } from '../../src/types.js'

const textQuestion: QuestionDefinition = {
	id: 1,
	position: 1,
	prompt: 'What brings you here?',
	type: 'text',
	required: true,
	options: []
}

const optionalSelect: QuestionDefinition = {
	id: 2,
	position: 2,
	prompt: 'Pick one',
	type: 'single_select',
	required: false,
	options: [
		{ position: 1, label: 'A', value: 'a' },
		{ position: 2, label: 'B', value: 'b' }
	]
}

const requiredMultiSelect: QuestionDefinition = {
	...optionalSelect,
	id: 3,
	type: 'multi_select',
	required: true
}

describe('buildQuestionModal', () => {
	it('builds a modal whose custom id encodes the question id', () => {
		const modal = buildQuestionModal(textQuestion)
		expect(modal.data.custom_id).toBe('onboarding:question-modal:1')
	})
})

describe('buildQuestionSelectRow', () => {
	it('caps maxValues at 1 for a single-select question', () => {
		const row = buildQuestionSelectRow(optionalSelect)
		const select = row.components[0]
		expect(select?.data.custom_id).toBe('onboarding:question-select:2')
		expect(select?.data.max_values).toBe(1)
		expect(select?.data.min_values).toBe(0)
	})

	it('caps maxValues at the option count for a multi-select question', () => {
		const row = buildQuestionSelectRow(requiredMultiSelect)
		const select = row.components[0]
		expect(select?.data.max_values).toBe(2)
		expect(select?.data.min_values).toBe(1)
	})
})

describe('buildQuestionSkipRow', () => {
	it('returns null for a required question', () => {
		expect(buildQuestionSkipRow(requiredMultiSelect)).toBeNull()
	})

	it('returns a skip button row for an optional question', () => {
		const row = buildQuestionSkipRow(optionalSelect)
		expect((row?.components[0]?.data as { custom_id?: string })?.custom_id).toBe('onboarding:question-skip:2')
	})
})
