import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle
} from 'discord.js'
import { EXPERIENCE_LEVELS, type QuestionnaireAnswers } from '../../types.js'
import { CUSTOM_IDS } from './custom-ids.js'

export const buildPurposeModal = (): ModalBuilder =>
	new ModalBuilder()
		.setCustomId(CUSTOM_IDS.purposeModal)
		.setTitle('What brings you here?')
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId(CUSTOM_IDS.purposeInput)
					.setLabel("What's your purpose here?")
					.setStyle(TextInputStyle.Paragraph)
					.setMinLength(10)
					.setMaxLength(1000)
					.setRequired(true)
			)
		)

export const buildExperienceSelect = (): ActionRowBuilder<StringSelectMenuBuilder> =>
	new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId(CUSTOM_IDS.experienceSelect)
			.setPlaceholder('Pick the closest match')
			.setMinValues(1)
			.setMaxValues(1)
			.addOptions(
				{ label: 'New to everything', value: EXPERIENCE_LEVELS.NEW },
				{ label: 'I have a little bit of experience', value: EXPERIENCE_LEVELS.SOME },
				{ label: 'I write web and/or software', value: EXPERIENCE_LEVELS.WRITES },
				{ label: 'Advanced/guru status', value: EXPERIENCE_LEVELS.ADVANCED }
			)
	)

export const buildBuiltForDiscordButtons = (): ActionRowBuilder<ButtonBuilder> =>
	new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(CUSTOM_IDS.builtYes)
			.setLabel('Yes')
			.setStyle(ButtonStyle.Primary),
		new ButtonBuilder()
			.setCustomId(CUSTOM_IDS.builtNo)
			.setLabel('No')
			.setStyle(ButtonStyle.Secondary)
	)

export const nextQuestion = (
	answers: QuestionnaireAnswers | null
): 'purpose' | 'experience' | 'built' | 'done' => {
	if (!answers?.purpose) return 'purpose'
	if (!answers.experienceLevel) return 'experience'
	// Explicit null check: `false` is a valid answer.
	if (answers.builtForDiscord === null) return 'built'
	return 'done'
}
