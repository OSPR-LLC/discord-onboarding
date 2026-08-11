import { MessageFlags, type Interaction } from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import { promptNextQuestion, type PromptableInteraction } from '../commands/intro.js'
import { handleOnboardingCommand } from '../commands/onboarding.js'
import { CUSTOM_IDS, parseCustomId } from '../components/custom-ids.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export type OnboardingInteractionDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly service: OnboardingService
	readonly now: () => string
}

const NOT_ACTIVE = 'Onboarding is not set up in this server yet.'

export const handleOnboardingInteraction = async (
	interaction: Interaction,
	deps: OnboardingInteractionDeps
): Promise<void> => {
	if (!interaction.guildId) return

	const { guildConfig, repo, questionnaireRepo, service, now } = deps
	const userId = interaction.user.id

	// Shared by every branch that ends by walking to the next (or completing)
	// question. `onComplete` stamps the questionnaire step — passed in here
	// rather than baked into promptNextQuestion, since only this file has
	// `service`/`config` in scope. Completion is derived from live config
	// every time this fires, never asserted ahead of time, so a stale
	// interaction can't mark an unfinished (or since-reconfigured)
	// questionnaire done — see promptNextQuestion's own comment on this.
	const advance = (
		responder: PromptableInteraction,
		config: NonNullable<ReturnType<typeof resolveActiveConfig>>
	): Promise<void> =>
		promptNextQuestion(responder, repo, questionnaireRepo, config.guildId, userId, async () => {
			await service.recordStep(config, userId, 'questionnaire')
		})

	if (interaction.isChatInputCommand() && interaction.commandName === 'intro') {
		const config = resolveActiveConfig(guildConfig, interaction.guildId)
		if (!config) {
			await interaction.reply({ content: NOT_ACTIVE, flags: MessageFlags.Ephemeral })
			return
		}
		await advance(interaction, config)
		return
	}

	if (interaction.isChatInputCommand() && interaction.commandName === 'onboarding') {
		// Not an inline literal: `OnboardingCommandDeps` (onboarding.ts, Task 10)
		// doesn't declare `questionnaireRepo` yet, and TS's excess-property check
		// only fires on object literals passed directly at a call site — binding
		// first passes it through structurally without waiting on that task.
		const commandDeps = { guildConfig, repo, questionnaireRepo, service }
		await handleOnboardingCommand(interaction, commandDeps)
		return
	}

	if (interaction.isModalSubmit()) {
		const parsed = parseCustomId(interaction.customId)
		if (parsed?.action === 'question-modal' && parsed.value) {
			const config = resolveActiveConfig(guildConfig, interaction.guildId)
			if (!config) return

			const questionId = Number(parsed.value)
			const textValue = interaction.fields.getTextInputValue(CUSTOM_IDS.questionAnswerInput)
			repo.saveAnswer(
				config.guildId,
				userId,
				questionId,
				{ textValue: textValue || null, selectedValues: [] },
				now()
			)
			await interaction.reply({ content: 'Answer saved.', flags: MessageFlags.Ephemeral })
			await advance(interaction, config)
			return
		}
	}

	if (interaction.isStringSelectMenu()) {
		const parsed = parseCustomId(interaction.customId)
		if (parsed?.action === 'question-select' && parsed.value) {
			const config = resolveActiveConfig(guildConfig, interaction.guildId)
			if (!config) return

			const questionId = Number(parsed.value)
			repo.saveAnswer(
				config.guildId,
				userId,
				questionId,
				{ textValue: null, selectedValues: [...interaction.values] },
				now()
			)
			await interaction.update({ content: 'Answer saved.', components: [] })
			await advance(interaction, config)
			return
		}
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
		// No reply() here on purpose. The next question may be a modal, and
		// showModal must be the first response to this interaction.
		await advance(interaction, config)
		return
	}

	if (parsed.action === 'question-skip' && parsed.value) {
		const questionId = Number(parsed.value)
		repo.saveAnswer(config.guildId, userId, questionId, { textValue: null, selectedValues: [] }, now())
		await interaction.update({ content: 'Skipped.', components: [] })
		await advance(interaction, config)
	}
}
