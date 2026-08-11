import {
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	type MessageComponentInteraction,
	type ModalSubmitInteraction
} from 'discord.js'
import { nextUnansweredQuestion } from '../../core/questionnaire.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import {
	buildQuestionModal,
	buildQuestionSelectRow,
	buildQuestionSkipRow
} from '../components/questionnaire.js'

export const introCommand = new SlashCommandBuilder()
	.setName('intro')
	.setDescription('Start or resume the introduction questionnaire')
	.setDMPermission(false)

export type PromptableInteraction =
	ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction

export const promptNextQuestion = async (
	interaction: PromptableInteraction,
	repo: OnboardingRepository,
	questionnaireRepo: QuestionnaireRepository,
	guildId: string,
	userId: string,
	onComplete: () => Promise<void>
): Promise<void> => {
	const questions = questionnaireRepo.listQuestions(guildId)
	const answers = repo.getAnswers(guildId, userId)
	const next = nextUnansweredQuestion(questions, answers)

	if (!next) {
		// Stamping completion lives here, not in each caller, because this is the
		// only place that knows "nothing left to answer" — including the guild
		// having zero configured questions, where no answer-saving branch ever
		// runs to trigger it otherwise. `recordStep` is idempotent (COALESCE), so
		// calling it on every re-entry (e.g. a repeat /intro) is harmless.
		await onComplete()

		const payload = {
			content:
				'All questions answered. The last step is to introduce yourself in the introductions channel.',
			components: []
		}
		if (interaction.replied || interaction.deferred)
			await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
		else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
		return
	}

	const position = `**${next.position} of ${questions.length}**`

	if (next.type === 'text') {
		// showModal must be the FIRST response to an interaction — it cannot
		// follow reply() or update(). Anything already replied to can only be
		// pointed at /intro, which arrives as a fresh interaction.
		if (!interaction.replied && !interaction.deferred && !interaction.isModalSubmit()) {
			await interaction.showModal(buildQuestionModal(next))
			return
		}

		await interaction.followUp({
			content: `Run \`/intro\` to answer ${position} — ${next.prompt}`,
			flags: MessageFlags.Ephemeral
		})
		return
	}

	const skipRow = buildQuestionSkipRow(next)
	const payload = {
		content: `${position} — ${next.prompt}`,
		components: skipRow ? [buildQuestionSelectRow(next), skipRow] : [buildQuestionSelectRow(next)]
	}

	if (interaction.replied || interaction.deferred)
		await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
	else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
}
