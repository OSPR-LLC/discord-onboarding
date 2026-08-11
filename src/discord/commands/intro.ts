import {
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
	type MessageComponentInteraction,
	type ModalSubmitInteraction
} from 'discord.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import {
	buildBuiltForDiscordButtons,
	buildExperienceSelect,
	buildPurposeModal,
	nextQuestion
} from '../components/questionnaire.js'

export const introCommand = new SlashCommandBuilder()
	.setName('intro')
	.setDescription('Start or resume the introduction questionnaire')
	.setDMPermission(false)

type PromptableInteraction =
	ChatInputCommandInteraction | MessageComponentInteraction | ModalSubmitInteraction

export const promptNextQuestion = async (
	interaction: PromptableInteraction,
	repo: OnboardingRepository,
	guildId: string,
	userId: string
): Promise<void> => {
	const step = nextQuestion(repo.getAnswers(guildId, userId))

	if (step === 'purpose') {
		// showModal must be the FIRST response to an interaction — it cannot
		// follow reply() or update(). Anything already replied to can only be
		// pointed at /intro, which arrives as a fresh interaction.
		if (!interaction.replied && !interaction.deferred && !interaction.isModalSubmit()) {
			await interaction.showModal(buildPurposeModal())
			return
		}

		await interaction.followUp({
			content: 'Run `/intro` to answer the first question.',
			flags: MessageFlags.Ephemeral
		})
		return
	}

	const payload =
		step === 'experience'
			? {
					content: "**2 of 3** — What's your level of understanding in web/software development?",
					components: [buildExperienceSelect()]
				}
			: step === 'built'
				? {
						content: '**3 of 3** — Have you ever developed anything for Discord?',
						components: [buildBuiltForDiscordButtons()]
					}
				: {
						content:
							'You have answered every question. The last step is to introduce yourself in the introductions channel.',
						components: []
					}

	if (interaction.replied || interaction.deferred)
		await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
	else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral })
}
