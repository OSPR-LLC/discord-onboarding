import { describe, expect, it } from 'vitest'
import {
	isValidNumericAnswer,
	nextUnansweredQuestion,
	numericAnswerIsInvalid
} from '../../src/core/questionnaire.js'
import type { QuestionAnswer, QuestionDefinition } from '../../src/types.js'

const textQuestion: QuestionDefinition = {
	id: 1,
	position: 1,
	prompt: 'What brings you here?',
	type: 'text',
	required: true,
	numericOnly: false,
	minLength: null,
	maxLength: null,
	options: []
}

const selectQuestion: QuestionDefinition = {
	id: 2,
	position: 2,
	prompt: 'Pick one',
	type: 'single_select',
	required: false,
	numericOnly: false,
	minLength: null,
	maxLength: null,
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

describe('isValidNumericAnswer', () => {
	it('accepts digits only', () => {
		expect(isValidNumericAnswer('1990')).toBe(true)
	})

	it('rejects letters', () => {
		expect(isValidNumericAnswer('nineteen ninety')).toBe(false)
	})

	it('rejects a decimal point', () => {
		expect(isValidNumericAnswer('19.90')).toBe(false)
	})

	it('rejects an empty string', () => {
		expect(isValidNumericAnswer('')).toBe(false)
	})

	it('trims surrounding whitespace before checking', () => {
		expect(isValidNumericAnswer('  1990  ')).toBe(true)
	})

	it('rejects a leading minus sign', () => {
		expect(isValidNumericAnswer('-5')).toBe(false)
	})
})

describe('numericAnswerIsInvalid', () => {
	const numericRequired: QuestionDefinition = { ...textQuestion, numericOnly: true, required: true }
	const numericOptional: QuestionDefinition = { ...textQuestion, numericOnly: true, required: false }

	it('rejects a whitespace-only answer to a required numeric question', () => {
		expect(numericAnswerIsInvalid(numericRequired, '   ')).toBe(true)
	})

	it('accepts a valid numeric answer', () => {
		expect(numericAnswerIsInvalid(numericRequired, '1990')).toBe(false)
	})

	it('allows a blank answer to an optional numeric question', () => {
		expect(numericAnswerIsInvalid(numericOptional, '')).toBe(false)
	})

	it('does not apply to a non-numeric question', () => {
		expect(numericAnswerIsInvalid({ ...numericRequired, numericOnly: false }, 'not a number')).toBe(false)
	})
})
