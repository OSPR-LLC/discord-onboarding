import { describe, expect, it } from 'vitest'
import { nextQuestion } from '../../src/discord/components/questionnaire.js'
import { EXPERIENCE_LEVELS, type QuestionnaireAnswers } from '../../src/types.js'

const empty: QuestionnaireAnswers = {
	guildId: 'g',
	userId: 'u',
	purpose: null,
	experienceLevel: null,
	builtForDiscord: null,
	answeredAt: null
}

describe('nextQuestion', () => {
	it('starts at purpose when nothing is answered', () => {
		expect(nextQuestion(null)).toBe('purpose')
		expect(nextQuestion(empty)).toBe('purpose')
	})

	it('moves to experience once purpose is answered', () => {
		expect(nextQuestion({ ...empty, purpose: 'learning' })).toBe('experience')
	})

	it('moves to built once experience is answered', () => {
		expect(
			nextQuestion({ ...empty, purpose: 'learning', experienceLevel: EXPERIENCE_LEVELS.NEW })
		).toBe('built')
	})

	it('reports done once all three are answered', () => {
		expect(
			nextQuestion({
				...empty,
				purpose: 'learning',
				experienceLevel: EXPERIENCE_LEVELS.NEW,
				builtForDiscord: false
			})
		).toBe('done')
	})

	it('treats a false Discord-dev answer as answered, not missing', () => {
		expect(
			nextQuestion({
				...empty,
				purpose: 'learning',
				experienceLevel: EXPERIENCE_LEVELS.NEW,
				builtForDiscord: false
			})
		).not.toBe('built')
	})
})
