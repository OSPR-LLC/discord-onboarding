import { beforeEach, describe, expect, it } from 'vitest'
import {
	createQuestionnaireRepository,
	isNumericRangeLabelSet,
	slugifyOptionLabels
} from '../../src/db/questionnaire-repository.js'
import { isOk } from '../../src/types.js'
import { createTestDb } from '../helpers/test-db.js'

const GUILD = '123456789012345678'
const OTHER_GUILD = '923456789012345678'
const AT = '2026-08-11T10:00:00.000Z'

let repo: ReturnType<typeof createQuestionnaireRepository>

beforeEach(() => {
	repo = createQuestionnaireRepository(createTestDb())
})

describe('slugifyOptionLabels', () => {
	it('lowercases and hyphenates', () => {
		expect(slugifyOptionLabels(['New to everything'])).toEqual([
			{ label: 'New to everything', value: 'new-to-everything' }
		])
	})

	it('deduplicates identical labels with a numeric suffix', () => {
		expect(slugifyOptionLabels(['Yes', 'Yes'])).toEqual([
			{ label: 'Yes', value: 'yes' },
			{ label: 'Yes', value: 'yes-2' }
		])
	})
})

describe('isNumericRangeLabelSet', () => {
	it('accepts an ascending sequence', () => {
		expect(isNumericRangeLabelSet(['2023', '2024', '2025', '2026'])).toBe(true)
	})

	it('accepts a descending sequence', () => {
		expect(isNumericRangeLabelSet(['10', '9', '8'])).toBe(true)
	})

	it('rejects a sequence with a gap', () => {
		expect(isNumericRangeLabelSet(['1', '2', '4'])).toBe(false)
	})

	it('rejects when any label is not purely digits', () => {
		expect(isNumericRangeLabelSet(['1', 'two', '3'])).toBe(false)
	})

	it('rejects a single label', () => {
		expect(isNumericRangeLabelSet(['5'])).toBe(false)
	})

	it('rejects an empty list', () => {
		expect(isNumericRangeLabelSet([])).toBe(false)
	})

	it('rejects non-numeric literal labels', () => {
		expect(isNumericRangeLabelSet(['New to everything', 'Advanced'])).toBe(false)
	})
})

describe('addQuestion', () => {
	it('appends at the next position, starting at 1', () => {
		const first = repo.addQuestion(GUILD, { prompt: 'Q1', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		const second = repo.addQuestion(GUILD, { prompt: 'Q2', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)

		expect(isOk(first) && first.value.position).toBe(1)
		expect(isOk(second) && second.value.position).toBe(2)
	})

	it('stores slugified options for a select question', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Pick', type: 'single_select', required: true, options: ['New to everything', 'Advanced'], numericOnly: false, minLength: null, maxLength: null },
			AT
		)

		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.options).toEqual([
			{ position: 1, label: 'New to everything', value: 'new-to-everything' },
			{ position: 2, label: 'Advanced', value: 'advanced' }
		])
	})

	it('rejects a guild that already has 10 questions', () => {
		for (let i = 0; i < 10; i += 1)
			repo.addQuestion(GUILD, { prompt: `Q${i}`, type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)

		const result = repo.addQuestion(GUILD, { prompt: 'Q11', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-questions')
	})

	it('rejects more than 25 options', () => {
		const options = Array.from({ length: 26 }, (_, i) => `Option ${i}`)
		const result = repo.addQuestion(GUILD, { prompt: 'Q', type: 'multi_select', required: true, options, numericOnly: false, minLength: null, maxLength: null }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('keeps question counts and positions independent across guilds', () => {
		repo.addQuestion(GUILD, { prompt: 'Q1', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		const otherFirst = repo.addQuestion(
			OTHER_GUILD,
			{ prompt: 'Other Q1', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
			AT
		)
		expect(isOk(otherFirst) && otherFirst.value.position).toBe(1)
	})
})

describe('listQuestions', () => {
	it('returns questions ordered by position', () => {
		repo.addQuestion(GUILD, { prompt: 'First', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.addQuestion(GUILD, { prompt: 'Second', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)

		expect(repo.listQuestions(GUILD).map((q) => q.prompt)).toEqual(['First', 'Second'])
	})

	it('returns an empty array for a guild with no questions', () => {
		expect(repo.listQuestions(GUILD)).toEqual([])
	})
})

describe('editQuestion', () => {
	beforeEach(() => {
		repo.addQuestion(GUILD, { prompt: 'Original', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
	})

	it('updates only the supplied fields', () => {
		const result = repo.editQuestion(GUILD, 1, { required: false }, AT)
		expect(isOk(result) && result.value.required).toBe(false)
		expect(isOk(result) && result.value.prompt).toBe('Original')
	})

	it('replaces options when a new options list is supplied', () => {
		repo.editQuestion(GUILD, 1, { type: 'single_select', options: ['X', 'Y'] }, AT)
		const [question] = repo.listQuestions(GUILD)
		expect(question?.options.map((o) => o.label)).toEqual(['X', 'Y'])
	})

	it('reports not-found for an out-of-range position', () => {
		const result = repo.editQuestion(GUILD, 5, { required: false }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('not-found')
	})
})

describe('removeQuestion', () => {
	beforeEach(() => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.addQuestion(GUILD, { prompt: 'C', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
	})

	it('removes the question and renumbers the rest contiguously', () => {
		repo.removeQuestion(GUILD, 2)
		expect(repo.listQuestions(GUILD).map((q) => [q.position, q.prompt])).toEqual([
			[1, 'A'],
			[2, 'C']
		])
	})

	it('reports not-found for an out-of-range position', () => {
		const result = repo.removeQuestion(GUILD, 99)
		expect(isOk(result)).toBe(false)
	})
})

describe('moveQuestion', () => {
	beforeEach(() => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.addQuestion(GUILD, { prompt: 'C', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
	})

	it('moves a question to a new position, shifting the others', () => {
		repo.moveQuestion(GUILD, 1, 3)
		expect(repo.listQuestions(GUILD).map((q) => q.prompt)).toEqual(['B', 'C', 'A'])
	})

	it('reports invalid-position when the target is out of range', () => {
		const result = repo.moveQuestion(GUILD, 1, 99)
		expect(isOk(result)).toBe(false)
	})
})

describe('clearQuestions', () => {
	it('removes every question for the guild', () => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.clearQuestions(GUILD)
		expect(repo.listQuestions(GUILD)).toEqual([])
	})

	it('leaves other guilds untouched', () => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.addQuestion(OTHER_GUILD, { prompt: 'B', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null }, AT)
		repo.clearQuestions(GUILD)
		expect(repo.listQuestions(OTHER_GUILD)).toHaveLength(1)
	})
})

describe('answer validation fields', () => {
	it('stores numericOnly/minLength/maxLength on a text question', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Birth year?',
				type: 'text',
				required: true,
				options: [],
				numericOnly: true,
				minLength: 4,
				maxLength: 4
			},
			AT
		)

		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.numericOnly).toBe(true)
		expect(result.value.minLength).toBe(4)
		expect(result.value.maxLength).toBe(4)
	})

	it('defaults to no validation when not supplied', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
			AT
		)

		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.numericOnly).toBe(false)
		expect(result.value.minLength).toBeNull()
		expect(result.value.maxLength).toBeNull()
	})

	it('rejects numeric/length validation on a select question', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Pick',
				type: 'single_select',
				required: true,
				options: ['A', 'B'],
				numericOnly: true,
				minLength: null,
				maxLength: null
			},
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('invalid-validation')
	})

	it('rejects a length outside 1-4000', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: 0, maxLength: null },
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('invalid-validation')
	})

	it('rejects min_length greater than max_length', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: 10, maxLength: 5 },
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('invalid-validation')
	})

	it('editQuestion implicitly clears numeric validation when changing type away from text', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Year', type: 'text', required: true, options: [], numericOnly: true, minLength: 4, maxLength: 4 },
			AT
		)

		const result = repo.editQuestion(GUILD, 1, { type: 'single_select', options: ['A', 'B'] }, AT)
		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.numericOnly).toBe(false)
		expect(result.value.minLength).toBeNull()
		expect(result.value.maxLength).toBeNull()
	})

	it('editQuestion allows the type change once numeric validation is explicitly cleared in the same edit', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Year', type: 'text', required: true, options: [], numericOnly: true, minLength: null, maxLength: null },
			AT
		)

		const result = repo.editQuestion(
			GUILD,
			1,
			{ type: 'single_select', options: ['A', 'B'], numericOnly: false },
			AT
		)
		expect(isOk(result)).toBe(true)
	})

	it('editQuestion still rejects explicitly enabling numeric validation in the same call as a non-text type change', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
			AT
		)

		const result = repo.editQuestion(GUILD, 1, { type: 'single_select', options: ['A', 'B'], numericOnly: true }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('invalid-validation')
	})

	it('editQuestion updates only the supplied validation fields, leaving the rest untouched', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Year', type: 'text', required: true, options: [], numericOnly: true, minLength: 4, maxLength: 4 },
			AT
		)

		const result = repo.editQuestion(GUILD, 1, { maxLength: 10 }, AT)
		expect(isOk(result) && result.value.numericOnly).toBe(true)
		expect(isOk(result) && result.value.minLength).toBe(4)
		expect(isOk(result) && result.value.maxLength).toBe(10)
	})
})

describe('the raised cap for single_select numeric ranges', () => {
	const numericLabels = (count: number): string[] => Array.from({ length: count }, (_, i) => String(i + 1))

	it('allows up to 100 options for a single_select numeric range', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Pick a number',
				type: 'single_select',
				required: true,
				options: numericLabels(100),
				numericOnly: false,
				minLength: null,
				maxLength: null
			},
			AT
		)

		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.options).toHaveLength(100)
	})

	it('still rejects more than 100 options even for a numeric range', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Pick a number',
				type: 'single_select',
				required: true,
				options: numericLabels(101),
				numericOnly: false,
				minLength: null,
				maxLength: null
			},
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('does not raise the cap for a non-range single_select option list', () => {
		const labels = Array.from({ length: 26 }, (_, i) => `Choice ${i}`)
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Pick', type: 'single_select', required: true, options: labels, numericOnly: false, minLength: null, maxLength: null },
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('does not raise the cap for multi_select even with numeric sequential labels', () => {
		const result = repo.addQuestion(
			GUILD,
			{
				prompt: 'Pick several',
				type: 'multi_select',
				required: true,
				options: numericLabels(26),
				numericOnly: false,
				minLength: null,
				maxLength: null
			},
			AT
		)

		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('editQuestion also allows up to 100 options for a single_select numeric range', () => {
		repo.addQuestion(
			GUILD,
			{ prompt: 'Pick', type: 'single_select', required: true, options: ['A', 'B'], numericOnly: false, minLength: null, maxLength: null },
			AT
		)

		const result = repo.editQuestion(GUILD, 1, { options: numericLabels(100) }, AT)
		expect(isOk(result)).toBe(true)
		if (!isOk(result)) return
		expect(result.value.options).toHaveLength(100)
	})
})

describe('getQuestionById', () => {
	it('returns the question when it exists for the guild', () => {
		const added = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
			AT
		)
		if (!isOk(added)) throw new Error('setup failed')

		expect(repo.getQuestionById(GUILD, added.value.id)?.prompt).toBe('Q')
	})

	it('returns undefined for an id that does not exist', () => {
		expect(repo.getQuestionById(GUILD, 999)).toBeUndefined()
	})

	it('returns undefined when the id belongs to a different guild', () => {
		const added = repo.addQuestion(
			GUILD,
			{ prompt: 'Q', type: 'text', required: true, options: [], numericOnly: false, minLength: null, maxLength: null },
			AT
		)
		if (!isOk(added)) throw new Error('setup failed')

		expect(repo.getQuestionById(OTHER_GUILD, added.value.id)).toBeUndefined()
	})
})
