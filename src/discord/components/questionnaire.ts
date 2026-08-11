import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	StringSelectMenuBuilder,
	TextInputBuilder,
	TextInputStyle
} from 'discord.js'
import type { QuestionDefinition, QuestionOption } from '../../types.js'
import { CUSTOM_IDS } from './custom-ids.js'

export const buildQuestionModal = (question: QuestionDefinition): ModalBuilder => {
	const maxLength = question.maxLength ?? Math.max(question.minLength ?? 0, 1000)

	const input = new TextInputBuilder()
		.setCustomId(CUSTOM_IDS.questionAnswerInput)
		.setLabel(question.prompt.slice(0, 45))
		.setStyle(TextInputStyle.Paragraph)
		.setMaxLength(maxLength)
		.setRequired(question.required)

	if (question.minLength !== null) input.setMinLength(question.minLength)

	return new ModalBuilder()
		.setCustomId(CUSTOM_IDS.questionModal(question.id))
		.setTitle(question.prompt.slice(0, 45))
		.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input))
}

const OPTIONS_PER_ROW = 25

const chunkOptions = (options: readonly QuestionOption[]): QuestionOption[][] => {
	const chunks: QuestionOption[][] = []
	for (let i = 0; i < options.length; i += OPTIONS_PER_ROW) chunks.push(options.slice(i, i + OPTIONS_PER_ROW))
	return chunks
}

export const buildQuestionSelectRows = (
	question: QuestionDefinition
): ActionRowBuilder<StringSelectMenuBuilder>[] => {
	if (question.type === 'multi_select') {
		return [
			new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
				new StringSelectMenuBuilder()
					.setCustomId(CUSTOM_IDS.questionSelect(question.id))
					.setPlaceholder('Pick your answer')
					.setMinValues(question.required ? 1 : 0)
					.setMaxValues(question.options.length)
					.addOptions(question.options.map((option) => ({ label: option.label, value: option.value })))
			)
		]
	}

	const chunks = chunkOptions(question.options)

	return chunks.map((options) => {
		const first = options[0]
		const last = options[options.length - 1]
		const placeholder =
			chunks.length > 1 && first && last
				? `Pick your answer (${first.label}–${last.label})`
				: 'Pick your answer'

		return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder()
				.setCustomId(CUSTOM_IDS.questionSelect(question.id))
				.setPlaceholder(placeholder)
				.setMinValues(chunks.length > 1 ? 0 : question.required ? 1 : 0)
				.setMaxValues(1)
				.addOptions(options.map((option) => ({ label: option.label, value: option.value })))
		)
	})
}

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
