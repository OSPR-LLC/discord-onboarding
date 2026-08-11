import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import { isOk } from '../../types.js'

export type ConfigQuestionDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly now: () => string
}

const ephemeral = { flags: MessageFlags.Ephemeral } as const

export const parseOptionsInput = (raw: string | null): string[] =>
	raw === null
		? []
		: raw
				.split(',')
				.map((segment) => segment.trim())
				.filter((segment) => segment.length > 0)

const TYPE_LABEL: Record<string, string> = {
	text: 'Text response',
	single_select: 'Single choice',
	multi_select: 'Multiple choice'
}

export const handleConfigQuestionCommand = async (
	interaction: ChatInputCommandInteraction,
	deps: ConfigQuestionDeps
): Promise<void> => {
	const { guild } = interaction
	if (!guild) return

	const { questionnaireRepo, now } = deps
	const subcommand = interaction.options.getSubcommand()

	if (subcommand === 'add') {
		const prompt = interaction.options.getString('prompt', true)
		const type = interaction.options.getString('type', true) as
			'text' | 'single_select' | 'multi_select'
		const required = interaction.options.getBoolean('required', true)
		const options = parseOptionsInput(interaction.options.getString('options'))

		if (type === 'text' && options.length > 0) {
			await interaction.reply({
				content: 'Text questions cannot have options — leave `options` empty.',
				...ephemeral
			})
			return
		}
		if (type !== 'text' && options.length === 0) {
			await interaction.reply({
				content: 'Single/Multiple choice questions need `options` (comma-separated).',
				...ephemeral
			})
			return
		}

		const result = questionnaireRepo.addQuestion(guild.id, { prompt, type, required, options }, now())
		if (!isOk(result)) {
			await interaction.reply({
				content:
					result.error === 'too-many-questions'
						? 'This server already has the maximum of 10 questions.'
						: 'A question can have at most 25 options.',
				...ephemeral
			})
			return
		}

		await interaction.reply({
			content: `Added question **${result.value.position}**: ${prompt}`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'edit') {
		const position = interaction.options.getInteger('position', true)
		const prompt = interaction.options.getString('prompt') ?? undefined
		const type = (interaction.options.getString('type') ?? undefined) as
			'text' | 'single_select' | 'multi_select' | undefined
		const required = interaction.options.getBoolean('required') ?? undefined
		const rawOptions = interaction.options.getString('options')
		const options = rawOptions === null ? undefined : parseOptionsInput(rawOptions)

		const result = questionnaireRepo.editQuestion(
			guild.id,
			position,
			{
				...(prompt !== undefined && { prompt }),
				...(type !== undefined && { type }),
				...(required !== undefined && { required }),
				...(options !== undefined && { options })
			},
			now()
		)
		if (!isOk(result)) {
			await interaction.reply({
				content:
					result.error === 'not-found'
						? `No question at position ${position}.`
						: 'A question can have at most 25 options.',
				...ephemeral
			})
			return
		}

		await interaction.reply({ content: `Updated question **${position}**.`, ...ephemeral })
		return
	}

	if (subcommand === 'remove') {
		const position = interaction.options.getInteger('position', true)
		const result = questionnaireRepo.removeQuestion(guild.id, position)
		await interaction.reply({
			content: isOk(result)
				? `Removed question **${position}**.`
				: `No question at position ${position}.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'move') {
		const from = interaction.options.getInteger('position', true)
		const to = interaction.options.getInteger('to', true)
		const result = questionnaireRepo.moveQuestion(guild.id, from, to)
		await interaction.reply({
			content: isOk(result)
				? `Moved question **${from}** to position **${to}**.`
				: `Could not move — check both positions with \`/config question list\`.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'list') {
		const questions = questionnaireRepo.listQuestions(guild.id)
		if (questions.length === 0) {
			await interaction.reply({
				content: 'No questions configured — the questionnaire step is skipped entirely.',
				...ephemeral
			})
			return
		}

		const embed = new EmbedBuilder()
			.setTitle('Questionnaire')
			.setDescription(
				questions
					.map(
						(q) =>
							`**${q.position}.** ${q.prompt}\n_${TYPE_LABEL[q.type]}${q.required ? '' : ' · optional'}${
								q.options.length > 0 ? ` · ${q.options.map((o) => o.label).join(', ')}` : ''
							}_`
					)
					.join('\n\n')
			)

		await interaction.reply({ embeds: [embed], ...ephemeral })
		return
	}

	if (subcommand === 'clear') {
		questionnaireRepo.clearQuestions(guild.id)
		await interaction.reply({
			content: 'Every question removed. The questionnaire step is now skipped entirely.',
			...ephemeral
		})
	}
}
