import { describe, expect, it } from 'vitest'
import { nextUnansweredQuestion } from '../../src/core/questionnaire.js'
import type { QuestionAnswer, QuestionDefinition } from '../../src/types.js'

const textQuestion: QuestionDefinition = {
	id: 1,
	position: 1,
	prompt: 'What brings you here?',
	type: 'text',
	required: true,
	options: []
}

const selectQuestion: QuestionDefinition = {
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

const answered = (questionId: number): QuestionAnswer => ({
	questionId,
	textValue: null,
	selectedValues: []
})

describe('nextUnansweredQuestion', () => {
	it('returns null for an empty question list', () => {
		expect(nextUnansweredQuestion([], [])).toBeNull()
	})

	it('returns the first question when nothing is answered', () => {
		expect(nextUnansweredQuestion([textQuestion, selectQuestion], [])).toEqual(textQuestion)
	})

	it('returns the next question once the first is answered', () => {
		expect(nextUnansweredQuestion([textQuestion, selectQuestion], [answered(1)])).toEqual(
			selectQuestion
		)
	})

	it('returns null once every question has an answer row, including skipped optional ones', () => {
		expect(
			nextUnansweredQuestion([textQuestion, selectQuestion], [answered(1), answered(2)])
		).toBeNull()
	})

	it('respects question order, not answer order', () => {
		expect(nextUnansweredQuestion([textQuestion, selectQuestion], [answered(2)])).toEqual(
			textQuestion
		)
	})
})
