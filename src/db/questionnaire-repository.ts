import type { Database } from 'better-sqlite3'
import { err, ok, type Result } from '../types.js'
import type { QuestionDefinition, QuestionOption, QuestionType } from '../types.js'

const MAX_QUESTIONS = 10
const MAX_OPTIONS = 25
const MAX_RANGE_OPTIONS = 100

export type NewQuestionInput = {
	prompt: string
	type: QuestionType
	required: boolean
	options: string[]
	numericOnly: boolean
	minLength: number | null
	maxLength: number | null
}

export type EditQuestionInput = Partial<NewQuestionInput>

export type AddEditError = 'too-many-questions' | 'too-many-options' | 'not-found' | 'invalid-validation'
export type MoveError = 'not-found' | 'invalid-position'

const slugifyOne = (label: string): string => {
	const slug = label
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	return slug || 'option'
}

export const slugifyOptionLabels = (labels: string[]): { label: string; value: string }[] => {
	const seen = new Map<string, number>()
	return labels.map((label) => {
		const base = slugifyOne(label)
		const count = seen.get(base) ?? 0
		seen.set(base, count + 1)
		return { label, value: count === 0 ? base : `${base}-${count + 1}` }
	})
}

export const isNumericRangeLabelSet = (labels: readonly string[]): boolean => {
	if (labels.length < 2) return false

	const values: number[] = []
	for (const label of labels) {
		if (!/^\d+$/.test(label)) return false
		values.push(Number(label))
	}

	const first = values[0]
	const second = values[1]
	if (first === undefined || second === undefined) return false
	const step = second - first
	if (step !== 1 && step !== -1) return false

	for (let i = 1; i < values.length; i += 1) {
		const prev = values[i - 1]
		const curr = values[i]
		if (prev === undefined || curr === undefined) return false
		if (curr - prev !== step) return false
	}

	return true
}

const isValidQuestionShape = (
	type: QuestionType,
	numericOnly: boolean,
	minLength: number | null,
	maxLength: number | null
): boolean => {
	if (type !== 'text' && (numericOnly || minLength !== null || maxLength !== null)) return false
	if (minLength !== null && (minLength < 1 || minLength > 4000)) return false
	if (maxLength !== null && (maxLength < 1 || maxLength > 4000)) return false
	if (minLength !== null && maxLength !== null && minLength > maxLength) return false
	return true
}

type QuestionRow = {
	id: number
	guild_id: string
	position: number
	prompt: string
	type: QuestionType
	required: number
	numeric_only: number
	min_length: number | null
	max_length: number | null
	created_at: string
}

type OptionRow = {
	question_id: number
	position: number
	label: string
	value: string
}

export const createQuestionnaireRepository = (db: Database) => {
	// Compiled once at construction, matching every other repository in src/db/.
	const statements = {
		listQuestions: db.prepare(
			'SELECT * FROM questionnaire_questions WHERE guild_id = ? ORDER BY position'
		),
		countQuestions: db.prepare(
			'SELECT COUNT(*) AS n FROM questionnaire_questions WHERE guild_id = ?'
		),
		insertQuestion: db.prepare(
			`INSERT INTO questionnaire_questions
			 (guild_id, position, prompt, type, required, numeric_only, min_length, max_length, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		),
		getQuestionAtPosition: db.prepare(
			'SELECT * FROM questionnaire_questions WHERE guild_id = ? AND position = ?'
		),
		getQuestionById: db.prepare(
			'SELECT * FROM questionnaire_questions WHERE guild_id = ? AND id = ?'
		),
		updateQuestion: db.prepare(
			`UPDATE questionnaire_questions
			 SET prompt = ?, type = ?, required = ?, numeric_only = ?, min_length = ?, max_length = ?
			 WHERE id = ?`
		),
		deleteQuestion: db.prepare('DELETE FROM questionnaire_questions WHERE id = ?'),
		shiftPositionsDown: db.prepare(
			'UPDATE questionnaire_questions SET position = position - 1 WHERE guild_id = ? AND position > ?'
		),
		setPosition: db.prepare('UPDATE questionnaire_questions SET position = ? WHERE id = ?'),
		clearQuestions: db.prepare('DELETE FROM questionnaire_questions WHERE guild_id = ?'),
		listOptions: db.prepare(
			'SELECT * FROM questionnaire_question_options WHERE question_id = ? ORDER BY position'
		),
		insertOption: db.prepare(
			'INSERT INTO questionnaire_question_options (question_id, position, label, value) VALUES (?, ?, ?, ?)'
		),
		deleteOptions: db.prepare('DELETE FROM questionnaire_question_options WHERE question_id = ?')
	}

	const toDefinition = (row: QuestionRow): QuestionDefinition => ({
		id: row.id,
		position: row.position,
		prompt: row.prompt,
		type: row.type,
		required: row.required === 1,
		numericOnly: row.numeric_only === 1,
		minLength: row.min_length,
		maxLength: row.max_length,
		options: (statements.listOptions.all(row.id) as OptionRow[]).map(
			(option): QuestionOption => ({
				position: option.position,
				label: option.label,
				value: option.value
			})
		)
	})

	const insertOptions = (questionId: number, labels: string[]): void => {
		slugifyOptionLabels(labels).forEach((option, index) => {
			statements.insertOption.run(questionId, index + 1, option.label, option.value)
		})
	}

	const listQuestions = (guildId: string): QuestionDefinition[] =>
		(statements.listQuestions.all(guildId) as QuestionRow[]).map(toDefinition)

	const addQuestion = (
		guildId: string,
		input: NewQuestionInput,
		createdAt: string
	): Result<QuestionDefinition, AddEditError> => {
		const count = (statements.countQuestions.get(guildId) as { n: number }).n
		if (count >= MAX_QUESTIONS) return err('too-many-questions')

		const cap =
			input.type === 'single_select' && isNumericRangeLabelSet(input.options) ? MAX_RANGE_OPTIONS : MAX_OPTIONS
		if (input.options.length > cap) return err('too-many-options')

		if (!isValidQuestionShape(input.type, input.numericOnly, input.minLength, input.maxLength))
			return err('invalid-validation')

		const position = count + 1
		const info = statements.insertQuestion.run(
			guildId,
			position,
			input.prompt,
			input.type,
			input.required ? 1 : 0,
			input.numericOnly ? 1 : 0,
			input.minLength,
			input.maxLength,
			createdAt
		)
		const questionId = Number(info.lastInsertRowid)
		if (input.options.length > 0) insertOptions(questionId, input.options)

		return ok(toDefinition(statements.getQuestionAtPosition.get(guildId, position) as QuestionRow))
	}

	const editQuestion = (
		guildId: string,
		position: number,
		patch: EditQuestionInput,
		_editedAt: string
	): Result<QuestionDefinition, AddEditError> => {
		const row = statements.getQuestionAtPosition.get(guildId, position) as QuestionRow | undefined
		if (!row) return err('not-found')

		const effectiveType = patch.type ?? row.type

		if (patch.options) {
			const cap =
				effectiveType === 'single_select' && isNumericRangeLabelSet(patch.options) ? MAX_RANGE_OPTIONS : MAX_OPTIONS
			if (patch.options.length > cap) return err('too-many-options')
		}

		// A type change away from text implicitly clears the three validation
		// fields rather than being rejected — the command surface has no way to
		// explicitly pass "clear" for min_length/max_length (Discord integer
		// options can't distinguish "not supplied" from "clear"), so requiring the
		// admin to clear them first would be a permanent dead end. Explicitly
		// trying to *set* validation in the same call as a non-text type change is
		// still rejected below via isValidQuestionShape.
		const clearValidation = effectiveType !== 'text'
		const effectiveNumericOnly = clearValidation
			? (patch.numericOnly ?? false)
			: (patch.numericOnly ?? row.numeric_only === 1)
		const effectiveMinLength = clearValidation
			? (patch.minLength ?? null)
			: patch.minLength !== undefined
				? patch.minLength
				: row.min_length
		const effectiveMaxLength = clearValidation
			? (patch.maxLength ?? null)
			: patch.maxLength !== undefined
				? patch.maxLength
				: row.max_length

		if (!isValidQuestionShape(effectiveType, effectiveNumericOnly, effectiveMinLength, effectiveMaxLength))
			return err('invalid-validation')

		statements.updateQuestion.run(
			patch.prompt ?? row.prompt,
			effectiveType,
			(patch.required ?? row.required === 1) ? 1 : 0,
			effectiveNumericOnly ? 1 : 0,
			effectiveMinLength,
			effectiveMaxLength,
			row.id
		)

		if (patch.options) {
			statements.deleteOptions.run(row.id)
			insertOptions(row.id, patch.options)
		}

		return ok(toDefinition(statements.getQuestionAtPosition.get(guildId, position) as QuestionRow))
	}

	const removeQuestion = (guildId: string, position: number): Result<void, AddEditError> => {
		const row = statements.getQuestionAtPosition.get(guildId, position) as QuestionRow | undefined
		if (!row) return err('not-found')

		statements.deleteQuestion.run(row.id)
		statements.shiftPositionsDown.run(guildId, position)
		return ok(undefined)
	}

	const moveQuestion = (
		guildId: string,
		fromPosition: number,
		toPosition: number
	): Result<void, MoveError> => {
		const questions = listQuestions(guildId)
		const fromIndex = fromPosition - 1
		const toIndex = toPosition - 1
		if (fromIndex < 0 || fromIndex >= questions.length) return err('not-found')
		if (toIndex < 0 || toIndex >= questions.length) return err('invalid-position')

		const reordered = [...questions]
		const [moved] = reordered.splice(fromIndex, 1)
		if (!moved) return err('not-found')
		reordered.splice(toIndex, 0, moved)

		reordered.forEach((question, index) => {
			statements.setPosition.run(index + 1, question.id)
		})

		return ok(undefined)
	}

	const clearQuestions = (guildId: string): void => {
		statements.clearQuestions.run(guildId)
	}

	const getQuestionById = (guildId: string, questionId: number): QuestionDefinition | undefined => {
		const row = statements.getQuestionById.get(guildId, questionId) as QuestionRow | undefined
		return row ? toDefinition(row) : undefined
	}

	return { listQuestions, addQuestion, editQuestion, removeQuestion, moveQuestion, clearQuestions, getQuestionById }
}

export type QuestionnaireRepository = ReturnType<typeof createQuestionnaireRepository>
