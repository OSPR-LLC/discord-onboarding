import { MessageFlags, type Interaction } from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { ExperienceLevel } from '../../types.js'
import { promptNextQuestion } from '../commands/intro.js'
import { handleOnboardingCommand } from '../commands/onboarding.js'
import { CUSTOM_IDS, parseCustomId } from '../components/custom-ids.js'
import { nextQuestion } from '../components/questionnaire.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export type OnboardingInteractionDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly service: OnboardingService
	readonly now: () => string
}

const NOT_ACTIVE = 'Onboarding is not set up in this server yet.'

export const handleOnboardingInteraction = async (
	interaction: Interaction,
	deps: OnboardingInteractionDeps
): Promise<void> => {
	if (!interaction.guildId) return

	const { guildConfig, repo, service, now } = deps
	const userId = interaction.user.id

	if (interaction.isChatInputCommand() && interaction.commandName === 'intro') {
		const config = resolveActiveConfig(guildConfig, interaction.guildId)
		if (!config) {
			await interaction.reply({ content: NOT_ACTIVE, flags: MessageFlags.Ephemeral })
			return
		}
		await promptNextQuestion(interaction, repo, config.guildId, userId)
		return
	}

	if (interaction.isChatInputCommand() && interaction.commandName === 'onboarding') {
		await handleOnboardingCommand(interaction, { guildConfig, repo, service })
		return
	}

	if (interaction.isModalSubmit() && interaction.customId === CUSTOM_IDS.purposeModal) {
		const config = resolveActiveConfig(guildConfig, interaction.guildId)
		if (!config) return

		repo.saveAnswer(
			config.guildId,
			userId,
			{ purpose: interaction.fields.getTextInputValue(CUSTOM_IDS.purposeInput) },
			now()
		)
		await interaction.reply({ content: '**1 of 3** answered.', flags: MessageFlags.Ephemeral })
		await promptNextQuestion(interaction, repo, config.guildId, userId)
		return
	}

	if (interaction.isStringSelectMenu() && interaction.customId === CUSTOM_IDS.experienceSelect) {
		const config = resolveActiveConfig(guildConfig, interaction.guildId)
		if (!config) return

		const value = interaction.values[0]
		if (!value) return

		repo.saveAnswer(config.guildId, userId, { experienceLevel: value as ExperienceLevel }, now())
		await interaction.update({ content: '**2 of 3** answered.', components: [] })
		await promptNextQuestion(interaction, repo, config.guildId, userId)
		return
	}

	if (!interaction.isButton()) return

	const parsed = parseCustomId(interaction.customId)
	if (!parsed) return

	const config = resolveActiveConfig(guildConfig, interaction.guildId)
	if (!config) {
		await interaction.reply({ content: NOT_ACTIVE, flags: MessageFlags.Ephemeral })
		return
	}

	if (parsed.action === 'rules-agree') {
		await service.recordStep(config, userId, 'rules')
		// No reply() here on purpose. The next question is a modal, and showModal
		// must be the first response to this interaction.
		await promptNextQuestion(interaction, repo, config.guildId, userId)
		return
	}

	if (parsed.action === 'q3') {
		repo.saveAnswer(config.guildId, userId, { builtForDiscord: parsed.value === 'yes' }, now())

		// Completion is derived from the stored answers, never asserted by this
		// handler — a stale button must not mark an unfinished questionnaire done.
		const complete = nextQuestion(repo.getAnswers(config.guildId, userId)) === 'done'

		if (complete) {
			await service.recordStep(config, userId, 'questionnaire')
			await interaction.update({
				content: `**3 of 3** answered. Last step: introduce yourself in <#${config.introductionsChannelId}>.`,
				components: []
			})
			return
		}

		await interaction.update({ content: 'Answer saved.', components: [] })
		await promptNextQuestion(interaction, repo, config.guildId, userId)
	}
}
