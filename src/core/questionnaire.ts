import type { QuestionAnswer, QuestionDefinition } from '../types.js'

export const nextUnansweredQuestion = (
	questions: readonly QuestionDefinition[],
	answers: readonly QuestionAnswer[]
): QuestionDefinition | null => {
	const answeredIds = new Set(answers.map((answer) => answer.questionId))
	return questions.find((question) => !answeredIds.has(question.id)) ?? null
}

export const isValidNumericAnswer = (value: string): boolean => /^\d+$/.test(value.trim())

export const numericAnswerIsInvalid = (question: QuestionDefinition, rawValue: string): boolean => {
	const trimmed = rawValue.trim()
	return question.numericOnly && (question.required || trimmed.length > 0) && !isValidNumericAnswer(trimmed)
}
