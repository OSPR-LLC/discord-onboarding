import { beforeEach, describe, expect, it } from 'vitest'
import {
	createQuestionnaireRepository,
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

describe('addQuestion', () => {
	it('appends at the next position, starting at 1', () => {
		const first = repo.addQuestion(GUILD, { prompt: 'Q1', type: 'text', required: true, options: [] }, AT)
		const second = repo.addQuestion(GUILD, { prompt: 'Q2', type: 'text', required: true, options: [] }, AT)

		expect(isOk(first) && first.value.position).toBe(1)
		expect(isOk(second) && second.value.position).toBe(2)
	})

	it('stores slugified options for a select question', () => {
		const result = repo.addQuestion(
			GUILD,
			{ prompt: 'Pick', type: 'single_select', required: true, options: ['New to everything', 'Advanced'] },
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
			repo.addQuestion(GUILD, { prompt: `Q${i}`, type: 'text', required: true, options: [] }, AT)

		const result = repo.addQuestion(GUILD, { prompt: 'Q11', type: 'text', required: true, options: [] }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-questions')
	})

	it('rejects more than 25 options', () => {
		const options = Array.from({ length: 26 }, (_, i) => `Option ${i}`)
		const result = repo.addQuestion(GUILD, { prompt: 'Q', type: 'multi_select', required: true, options }, AT)
		expect(isOk(result)).toBe(false)
		expect(!isOk(result) && result.error).toBe('too-many-options')
	})

	it('keeps question counts and positions independent across guilds', () => {
		repo.addQuestion(GUILD, { prompt: 'Q1', type: 'text', required: true, options: [] }, AT)
		const otherFirst = repo.addQuestion(
			OTHER_GUILD,
			{ prompt: 'Other Q1', type: 'text', required: true, options: [] },
			AT
		)
		expect(isOk(otherFirst) && otherFirst.value.position).toBe(1)
	})
})

describe('listQuestions', () => {
	it('returns questions ordered by position', () => {
		repo.addQuestion(GUILD, { prompt: 'First', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'Second', type: 'text', required: true, options: [] }, AT)

		expect(repo.listQuestions(GUILD).map((q) => q.prompt)).toEqual(['First', 'Second'])
	})

	it('returns an empty array for a guild with no questions', () => {
		expect(repo.listQuestions(GUILD)).toEqual([])
	})
})

describe('editQuestion', () => {
	beforeEach(() => {
		repo.addQuestion(GUILD, { prompt: 'Original', type: 'text', required: true, options: [] }, AT)
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
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'C', type: 'text', required: true, options: [] }, AT)
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
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'C', type: 'text', required: true, options: [] }, AT)
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
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(GUILD, { prompt: 'B', type: 'text', required: true, options: [] }, AT)
		repo.clearQuestions(GUILD)
		expect(repo.listQuestions(GUILD)).toEqual([])
	})

	it('leaves other guilds untouched', () => {
		repo.addQuestion(GUILD, { prompt: 'A', type: 'text', required: true, options: [] }, AT)
		repo.addQuestion(OTHER_GUILD, { prompt: 'B', type: 'text', required: true, options: [] }, AT)
		repo.clearQuestions(GUILD)
		expect(repo.listQuestions(OTHER_GUILD)).toHaveLength(1)
	})
})
