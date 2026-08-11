import type { QuestionAnswer, QuestionDefinition } from '../types.js'

export const nextUnansweredQuestion = (
	questions: readonly QuestionDefinition[],
	answers: readonly QuestionAnswer[]
): QuestionDefinition | null => {
	const answeredIds = new Set(answers.map((answer) => answer.questionId))
	return questions.find((question) => !answeredIds.has(question.id)) ?? null
}
