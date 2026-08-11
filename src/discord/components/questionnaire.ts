import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle
} from 'discord.js'
import type { QuestionDefinition } from '../../types.js'
import { CUSTOM_IDS } from './custom-ids.js'

export const buildQuestionModal = (question: QuestionDefinition): ModalBuilder =>
	new ModalBuilder()
		.setCustomId(CUSTOM_IDS.questionModal(question.id))
		.setTitle(question.prompt.slice(0, 45))
		.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId(CUSTOM_IDS.questionAnswerInput)
					.setLabel(question.prompt.slice(0, 45))
					.setStyle(TextInputStyle.Paragraph)
					.setMaxLength(1000)
					.setRequired(question.required)
			)
		)

export const buildQuestionSelectRow = (
	question: QuestionDefinition
): ActionRowBuilder<StringSelectMenuBuilder> =>
	new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
		new StringSelectMenuBuilder()
			.setCustomId(CUSTOM_IDS.questionSelect(question.id))
			.setPlaceholder('Pick your answer')
			.setMinValues(question.required ? 1 : 0)
			.setMaxValues(question.type === 'multi_select' ? question.options.length : 1)
			.addOptions(question.options.map((option) => ({ label: option.label, value: option.value })))
	)

export const buildQuestionSkipRow = (
	question: QuestionDefinition
): ActionRowBuilder<ButtonBuilder> | null => {
	if (question.required) return null

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(CUSTOM_IDS.questionSkip(question.id))
			.setLabel('Skip')
			.setStyle(ButtonStyle.Secondary)
	)
}
