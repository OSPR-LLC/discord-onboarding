import { describe, expect, it } from 'vitest'
import { parseOptionsInput, validationSuffix } from '../../src/discord/commands/config-question.js'
import type { QuestionDefinition } from '../../src/types.js'

describe('parseOptionsInput', () => {
	it('returns an empty array for null input', () => {
		expect(parseOptionsInput(null)).toEqual([])
	})

	it('splits on commas and trims whitespace', () => {
		expect(parseOptionsInput('New to everything, Some experience ,Advanced')).toEqual([
			'New to everything',
			'Some experience',
			'Advanced'
		])
	})

	it('drops empty segments from stray commas', () => {
		expect(parseOptionsInput('A,,B,')).toEqual(['A', 'B'])
	})
})

describe('validationSuffix', () => {
	const base: QuestionDefinition = {
		id: 1,
		position: 1,
		prompt: 'Q',
		type: 'text',
		required: true,
		numericOnly: false,
		minLength: null,
		maxLength: null,
		options: []
	}

	it('returns empty for a select question', () => {
		expect(validationSuffix({ ...base, type: 'single_select' })).toBe('')
	})

	it('returns empty for a text question with no validation', () => {
		expect(validationSuffix(base)).toBe('')
	})

	it('shows digits only', () => {
		expect(validationSuffix({ ...base, numericOnly: true })).toBe(' · digits only')
	})

	it('shows a min-max range', () => {
		expect(validationSuffix({ ...base, minLength: 4, maxLength: 10 })).toBe(' · 4-10 chars')
	})

	it('shows min only', () => {
		expect(validationSuffix({ ...base, minLength: 4 })).toBe(' · min 4 chars')
	})

	it('shows max only', () => {
		expect(validationSuffix({ ...base, maxLength: 10 })).toBe(' · max 10 chars')
	})

	it('combines digits only with a length range', () => {
		expect(validationSuffix({ ...base, numericOnly: true, minLength: 4, maxLength: 4 })).toBe(
			' · digits only · 4-4 chars'
		)
	})
})
