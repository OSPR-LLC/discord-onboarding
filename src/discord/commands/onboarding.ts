import {
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type ChatInputCommandInteraction
} from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import type { OnboardingRecord } from '../../types.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export const onboardingCommand = new SlashCommandBuilder()
	.setName('onboarding')
	.setDescription('Inspect and manage member onboarding')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
	.setDMPermission(false)
	.addSubcommand((sub) =>
		sub
			.setName('status')
			.setDescription("Show a member's onboarding progress")
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to inspect').setRequired(true)
			)
	)
	.addSubcommand((sub) =>
		sub
			.setName('verify')
			.setDescription('Force-verify a member, lifting any hold')
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to verify').setRequired(true)
			)
	)
	.addSubcommand((sub) =>
		sub
			.setName('unverify')
			.setDescription('Remove verification and place a hold')
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to unverify').setRequired(true)
			)
	)
	.addSubcommand((sub) =>
		sub
			.setName('reset')
			.setDescription('Wipe a member record so they redo onboarding')
			.addUserOption((option) =>
				option.setName('member').setDescription('The member to reset').setRequired(true)
			)
	)

export type OnboardingCommandDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly service: OnboardingService
}

const ephemeral = { flags: MessageFlags.Ephemeral } as const

const stepField = (name: string, at: string | null) => ({
	name,
	value: at ? `✅ ${at}` : '⬜ not done',
	inline: false
})

const formatAnswer = (
	question: { type: string; options: readonly { value: string; label: string }[] },
	answer: { textValue: string | null; selectedValues: readonly string[] } | undefined
): string => {
	if (!answer) return '⬜ not answered'
	if (question.type === 'text') return answer.textValue || '_(skipped)_'
	if (answer.selectedValues.length === 0) return '_(skipped)_'
	const labels = new Map(question.options.map((o) => [o.value, o.label]))
	return answer.selectedValues.map((value) => labels.get(value) ?? value).join(', ')
}

const buildStatusEmbed = (
	guildId: string,
	userId: string,
	record: OnboardingRecord,
	repo: OnboardingRepository,
	questionnaireRepo: QuestionnaireRepository
): EmbedBuilder => {
	const embed = new EmbedBuilder()
		.setTitle('Onboarding status')
		.setDescription(`<@${userId}>`)
		.addFields(
			stepField('1. Rules accepted', record.rulesAcceptedAt),
			stepField('2. Questionnaire completed', record.questionnaireCompletedAt),
			stepField('3. Posted in introductions', record.introPostedAt),
			stepField('Verified', record.verifiedAt)
		)

	if (record.verificationHoldAt)
		embed.addFields({
			name: '⛔ Hold',
			value: `Applied ${record.verificationHoldAt} by <@${record.verificationHoldBy ?? 'unknown'}>`
		})

	const questions = questionnaireRepo.listQuestions(guildId)
	if (questions.length > 0) {
		const answers = new Map(repo.getAnswers(guildId, userId).map((a) => [a.questionId, a]))
		embed.addFields(
			questions.map((question) => ({
				name: `${question.position}. ${question.prompt}`,
				value: formatAnswer(question, answers.get(question.id))
			}))
		)
	}

	return embed
}

export const handleOnboardingCommand = async (
	interaction: ChatInputCommandInteraction,
	deps: OnboardingCommandDeps
): Promise<void> => {
	if (!interaction.guildId) return

	const config = resolveActiveConfig(deps.guildConfig, interaction.guildId)
	if (!config) {
		await interaction.reply({
			content:
				'Onboarding is not set up in this server yet. An admin can configure it with `/config`.',
			...ephemeral
		})
		return
	}

	const target = interaction.options.getUser('member', true)
	const subcommand = interaction.options.getSubcommand()

	if (subcommand === 'status') {
		const record = deps.repo.get(config.guildId, target.id)

		// Built in two branches: passing `content: undefined` is a type error
		// under exactOptionalPropertyTypes.
		await interaction.reply(
			record
				? { embeds: [buildStatusEmbed(config.guildId, target.id, record, deps.repo, deps.questionnaireRepo)], ...ephemeral }
				: { content: `<@${target.id}> has no onboarding record in this server.`, ...ephemeral }
		)
		return
	}

	if (subcommand === 'verify') {
		await deps.service.liftHoldAndVerify(config, target.id, interaction.user.id)
		await interaction.reply({ content: `<@${target.id}> is now verified.`, ...ephemeral })
		return
	}

	if (subcommand === 'unverify') {
		await deps.service.applyHold(config, target.id, interaction.user.id)
		await interaction.reply({
			content: `<@${target.id}> is unverified and on hold. Their completed steps are kept — use \`/onboarding verify\` to lift the hold.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'reset') {
		await deps.service.resetMember(config, target.id)
		await interaction.reply({
			content: `<@${target.id}>'s record is wiped. They will go through onboarding from the start.`,
			...ephemeral
		})
	}
}
