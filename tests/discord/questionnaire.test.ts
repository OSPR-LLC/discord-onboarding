import { describe, expect, it } from 'vitest'
import {
	buildQuestionModal,
	buildQuestionSelectRows,
	buildQuestionSkipRow
} from '../../src/discord/components/questionnaire.js'
import type { QuestionDefinition } from '../../src/types.js'
import { ActionRowBuilder, TextInputBuilder } from 'discord.js'

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

const optionalSelect: QuestionDefinition = {
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

	it('defaults max length to 1000 when no character limit is configured', () => {
		const modal = buildQuestionModal(textQuestion)
		const input = (modal.components[0] as ActionRowBuilder<TextInputBuilder>)?.components[0]
		expect((input?.data as { max_length?: number })?.max_length).toBe(1000)
		expect((input?.data as { min_length?: number })?.min_length).toBeUndefined()
	})

	it('applies a configured min and max length', () => {
		const modal = buildQuestionModal({ ...textQuestion, minLength: 4, maxLength: 4 })
		const input = (modal.components[0] as ActionRowBuilder<TextInputBuilder>)?.components[0]
		expect((input?.data as { min_length?: number })?.min_length).toBe(4)
		expect((input?.data as { max_length?: number })?.max_length).toBe(4)
	})

	it('raises the default max length so it never sits below a configured min length', () => {
		const modal = buildQuestionModal({ ...textQuestion, minLength: 4000, maxLength: null })
		const input = (modal.components[0] as ActionRowBuilder<TextInputBuilder>)?.components[0]
		expect((input?.data as { max_length?: number })?.max_length).toBe(4000)
	})
})

describe('buildQuestionSelectRows', () => {
	it('caps maxValues at 1 for a single-select question', () => {
		const rows = buildQuestionSelectRows(optionalSelect)
		expect(rows).toHaveLength(1)
		const select = rows[0]?.components[0]
		expect(select?.data.custom_id).toBe('onboarding:question-select:2')
		expect(select?.data.max_values).toBe(1)
		expect(select?.data.min_values).toBe(0)
	})

	it('caps maxValues at the option count for a multi-select question', () => {
		const rows = buildQuestionSelectRows(requiredMultiSelect)
		expect(rows).toHaveLength(1)
		const select = rows[0]?.components[0]
		expect(select?.data.max_values).toBe(2)
		expect(select?.data.min_values).toBe(1)
	})

	it('uses the plain placeholder for a single row', () => {
		const rows = buildQuestionSelectRows(optionalSelect)
		expect(rows[0]?.components[0]?.data.placeholder).toBe('Pick your answer')
	})

	it('splits a single_select question with more than 25 options into multiple rows', () => {
		const manyOptions = Array.from({ length: 47 }, (_, i) => ({
			position: i + 1,
			label: String(1980 + i),
			value: String(1980 + i)
		}))
		const rangeQuestion: QuestionDefinition = { ...optionalSelect, options: manyOptions }

		const rows = buildQuestionSelectRows(rangeQuestion)
		expect(rows).toHaveLength(2)
		expect(rows[0]?.components[0]?.options).toHaveLength(25)
		expect(rows[1]?.components[0]?.options).toHaveLength(22)
	})

	it('sets minValues to 0 on every row when a question with multiple rows is required', () => {
		const manyOptions = Array.from({ length: 30 }, (_, i) => ({
			position: i + 1,
			label: String(1990 + i),
			value: String(1990 + i)
		}))
		const requiredRangeQuestion: QuestionDefinition = { ...optionalSelect, required: true, options: manyOptions }

		const rows = buildQuestionSelectRows(requiredRangeQuestion)
		expect(rows).toHaveLength(2)
		expect(rows[0]?.components[0]?.data.min_values).toBe(0)
		expect(rows[1]?.components[0]?.data.min_values).toBe(0)
	})

	it('shows the label range in each row placeholder when there is more than one row', () => {
		const manyOptions = Array.from({ length: 30 }, (_, i) => ({
			position: i + 1,
			label: String(1990 + i),
			value: String(1990 + i)
		}))
		const rangeQuestion: QuestionDefinition = { ...optionalSelect, options: manyOptions }

		const rows = buildQuestionSelectRows(rangeQuestion)
		expect(rows[0]?.components[0]?.data.placeholder).toBe('Pick your answer (1990–2014)')
		expect(rows[1]?.components[0]?.data.placeholder).toBe('Pick your answer (2015–2019)')
	})

	it('never splits a multi_select question, even with many options', () => {
		const manyOptions = Array.from({ length: 25 }, (_, i) => ({
			position: i + 1,
			label: String(i),
			value: String(i)
		}))
		const bigMultiSelect: QuestionDefinition = { ...requiredMultiSelect, options: manyOptions }

		const rows = buildQuestionSelectRows(bigMultiSelect)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.components[0]?.data.max_values).toBe(25)
	})

	it('produces exactly 4 rows for exactly 100 options, fitting a skip row within the 5-row limit', () => {
		const manyOptions = Array.from({ length: 100 }, (_, i) => ({
			position: i + 1,
			label: String(1927 + i),
			value: String(1927 + i)
		}))
		const maxRangeQuestion: QuestionDefinition = { ...optionalSelect, options: manyOptions }

		const selectRows = buildQuestionSelectRows(maxRangeQuestion)
		const skipRow = buildQuestionSkipRow(maxRangeQuestion)

		expect(selectRows).toHaveLength(4)
		expect(skipRow).not.toBeNull()
		expect(selectRows.length + 1).toBe(5)
	})

	it('gives each chunk a distinct custom id, since Discord rejects a message with duplicate component ids', () => {
		const manyOptions = Array.from({ length: 47 }, (_, i) => ({
			position: i + 1,
			label: String(1980 + i),
			value: String(1980 + i)
		}))
		const rangeQuestion: QuestionDefinition = { ...optionalSelect, options: manyOptions }

		const rows = buildQuestionSelectRows(rangeQuestion)
		const customIds = rows.map((row) => row.components[0]?.data.custom_id)
		expect(new Set(customIds).size).toBe(customIds.length)
	})

	it('keeps the original unsuffixed custom id for a single-row question', () => {
		const rows = buildQuestionSelectRows(optionalSelect)
		expect(rows[0]?.components[0]?.data.custom_id).toBe('onboarding:question-select:2')
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
