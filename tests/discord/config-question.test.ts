import { describe, expect, it } from 'vitest'
import { parseOptionsInput } from '../../src/discord/commands/config-question.js'

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
