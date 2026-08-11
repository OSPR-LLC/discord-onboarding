import {
	ChannelType,
	EmbedBuilder,
	MessageFlags,
	ModalBuilder,
	PermissionFlagsBits,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
	ActionRowBuilder,
	type ChatInputCommandInteraction,
	type ModalSubmitInteraction
} from 'discord.js'
import {
	DEFAULT_INTRO_TEMPLATE,
	DEFAULT_RULES_TEXT,
	resolveGuildConfig
} from '../../core/guild-config.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { QuestionnaireRepository } from '../../db/questionnaire-repository.js'
import { isOk } from '../../types.js'
import { CUSTOM_IDS } from '../components/custom-ids.js'
import { publishIntroTemplateMessage } from '../components/intro-template-message.js'
import { publishRulesMessage } from '../components/rules-message.js'
import { runPreflight } from '../preflight.js'
import { handleConfigQuestionCommand } from './config-question.js'

export const configCommand = new SlashCommandBuilder()
	.setName('config')
	.setDescription('Configure member onboarding for this server')
	.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
	.setDMPermission(false)
	.addSubcommand((sub) => sub.setName('show').setDescription('Show the current configuration'))
	.addSubcommand((sub) =>
		sub
			.setName('channel')
			.setDescription('Set one of the onboarding channels')
			.addStringOption((option) =>
				option
					.setName('which')
					.setDescription('Which channel to set')
					.setRequired(true)
					.addChoices(
						{ name: 'rules', value: 'rules' },
						{ name: 'introductions', value: 'introductions' },
						{ name: 'mod log', value: 'modlog' }
					)
			)
			.addChannelOption((option) =>
				option
					.setName('channel')
					.setDescription('The channel')
					.addChannelTypes(ChannelType.GuildText)
					.setRequired(true)
			)
	)
	.addSubcommand((sub) =>
		sub
			.setName('role')
			.setDescription('Set one of the onboarding roles')
			.addStringOption((option) =>
				option
					.setName('which')
					.setDescription('Which role to set')
					.setRequired(true)
					.addChoices(
						{ name: 'verified', value: 'verified' },
						{ name: 'unverified', value: 'unverified' }
					)
			)
			.addRoleOption((option) =>
				option.setName('role').setDescription('The role').setRequired(true)
			)
	)
	.addSubcommand((sub) => sub.setName('rules-text').setDescription('Edit the rules text'))
	.addSubcommand((sub) =>
		sub.setName('intro-template').setDescription('Edit the introduction template')
	)
	.addSubcommandGroup((group) =>
		group
			.setName('question')
			.setDescription('Manage the onboarding questionnaire')
			.addSubcommand((sub) =>
				sub
					.setName('add')
					.setDescription('Add a question to the questionnaire')
					.addStringOption((option) =>
						option.setName('prompt').setDescription('The question text').setRequired(true).setMaxLength(300)
					)
					.addStringOption((option) =>
						option
							.setName('type')
							.setDescription('Answer type')
							.setRequired(true)
							.addChoices(
								{ name: 'Text response', value: 'text' },
								{ name: 'Single choice', value: 'single_select' },
								{ name: 'Multiple choice', value: 'multi_select' }
							)
					)
					.addBooleanOption((option) =>
						option.setName('required').setDescription('Must the member answer this?').setRequired(true)
					)
					.addStringOption((option) =>
						option
							.setName('options')
							.setDescription('Comma-separated choices (only for Single/Multiple choice)')
							.setRequired(false)
					)
					.addBooleanOption((option) =>
						option
							.setName('numeric')
							.setDescription('Text only: require the answer to be digits only')
							.setRequired(false)
					)
					.addIntegerOption((option) =>
						option
							.setName('min_length')
							.setDescription('Text only: minimum answer length (1-4000)')
							.setRequired(false)
							.setMinValue(1)
							.setMaxValue(4000)
					)
					.addIntegerOption((option) =>
						option
							.setName('max_length')
							.setDescription('Text only: maximum answer length (1-4000)')
							.setRequired(false)
							.setMinValue(1)
							.setMaxValue(4000)
					)
			)
			.addSubcommand((sub) =>
				sub
					.setName('edit')
					.setDescription('Edit an existing question')
					.addIntegerOption((option) =>
						option.setName('position').setDescription('Position from /config question list').setRequired(true)
					)
					.addStringOption((option) =>
						option.setName('prompt').setDescription('New question text').setRequired(false).setMaxLength(300)
					)
					.addStringOption((option) =>
						option
							.setName('type')
							.setDescription('New answer type')
							.setRequired(false)
							.addChoices(
								{ name: 'Text response', value: 'text' },
								{ name: 'Single choice', value: 'single_select' },
								{ name: 'Multiple choice', value: 'multi_select' }
							)
					)
					.addBooleanOption((option) =>
						option.setName('required').setDescription('Must the member answer this?').setRequired(false)
					)
					.addStringOption((option) =>
						option
							.setName('options')
							.setDescription('New comma-separated choices (replaces the old list)')
							.setRequired(false)
					)
					.addBooleanOption((option) =>
						option
							.setName('numeric')
							.setDescription('Text only: require the answer to be digits only')
							.setRequired(false)
					)
					.addIntegerOption((option) =>
						option
							.setName('min_length')
							.setDescription('Text only: minimum answer length (1-4000)')
							.setRequired(false)
							.setMinValue(1)
							.setMaxValue(4000)
					)
					.addIntegerOption((option) =>
						option
							.setName('max_length')
							.setDescription('Text only: maximum answer length (1-4000)')
							.setRequired(false)
							.setMinValue(1)
							.setMaxValue(4000)
					)
			)
			.addSubcommand((sub) =>
				sub
					.setName('remove')
					.setDescription('Remove a question')
					.addIntegerOption((option) =>
						option.setName('position').setDescription('Position from /config question list').setRequired(true)
					)
			)
			.addSubcommand((sub) =>
				sub
					.setName('move')
					.setDescription('Reorder a question')
					.addIntegerOption((option) =>
						option.setName('position').setDescription('Current position').setRequired(true)
					)
					.addIntegerOption((option) =>
						option.setName('to').setDescription('New position').setRequired(true)
					)
			)
			.addSubcommand((sub) => sub.setName('list').setDescription('List the configured questions'))
			.addSubcommand((sub) => sub.setName('clear').setDescription('Remove every configured question'))
	)
	.addSubcommand((sub) => sub.setName('enable').setDescription('Turn onboarding on'))
	.addSubcommand((sub) => sub.setName('disable').setDescription('Turn onboarding off'))
	.addSubcommand((sub) =>
		sub
			.setName('grandfather')
			.setDescription('Manage the cutoff that exempts existing members')
			.addStringOption((option) =>
				option
					.setName('action')
					.setDescription('What to do')
					.setRequired(true)
					.addChoices({ name: 'clear (gate existing members too)', value: 'clear' })
			)
	)

export type ConfigCommandDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly questionnaireRepo: QuestionnaireRepository
	readonly now: () => string
}

const ephemeral = { flags: MessageFlags.Ephemeral } as const

export const handleConfigCommand = async (
	interaction: ChatInputCommandInteraction,
	deps: ConfigCommandDeps
): Promise<void> => {
	const { guild } = interaction
	if (!guild) return

	if (interaction.options.getSubcommandGroup(false) === 'question') {
		await handleConfigQuestionCommand(interaction, deps)
		return
	}

	const { guildConfig, now } = deps
	const actorId = interaction.user.id
	const subcommand = interaction.options.getSubcommand()

	guildConfig.ensure(guild.id, now())

	if (subcommand === 'show') {
		const row = guildConfig.get(guild.id)
		const resolved = resolveGuildConfig(row)

		const embed = new EmbedBuilder().setTitle('Onboarding configuration').addFields(
			{ name: 'Status', value: row?.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: false },
			{
				name: 'Rules channel',
				value: row?.rulesChannelId ? `<#${row.rulesChannelId}>` : '— not set',
				inline: true
			},
			{
				name: 'Introductions channel',
				value: row?.introductionsChannelId ? `<#${row.introductionsChannelId}>` : '— not set',
				inline: true
			},
			{
				name: 'Mod log channel',
				value: row?.modLogChannelId ? `<#${row.modLogChannelId}>` : '— not set',
				inline: true
			},
			{
				name: 'Verified role',
				value: row?.verifiedRoleId ? `<@&${row.verifiedRoleId}>` : '— not set',
				inline: true
			},
			{
				name: 'Unverified role',
				value: row?.unverifiedRoleId ? `<@&${row.unverifiedRoleId}>` : '— not set',
				inline: true
			},
			{
				name: 'Existing members exempt',
				value: row?.grandfatherBefore
					? `Yes — everyone who joined before <t:${Math.floor(Date.parse(row.grandfatherBefore) / 1000)}:f>`
					: 'No — every member is subject to the gate',
				inline: false
			}
		)

		if (!isOk(resolved))
			embed.addFields({
				name: '⚠️ Still needed',
				value: resolved.error.map((problem) => `• ${problem.message}`).join('\n')
			})

		await interaction.reply({ embeds: [embed], ...ephemeral })
		return
	}

	if (subcommand === 'channel') {
		const which = interaction.options.getString('which', true) as
			'rules' | 'introductions' | 'modlog'
		const channel = interaction.options.getChannel('channel', true)

		guildConfig.setChannel(guild.id, which, channel.id, actorId, now())
		await interaction.reply({
			content: `Set the **${which}** channel to <#${channel.id}>.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'role') {
		const which = interaction.options.getString('which', true) as 'verified' | 'unverified'
		const role = interaction.options.getRole('role', true)

		guildConfig.setRole(guild.id, which, role.id, actorId, now())
		await interaction.reply({
			content: `Set the **${which}** role to <@&${role.id}>.`,
			...ephemeral
		})
		return
	}

	if (subcommand === 'rules-text') {
		const current = guildConfig.get(guild.id)?.rulesText ?? DEFAULT_RULES_TEXT

		await interaction.showModal(
			new ModalBuilder()
				.setCustomId(CUSTOM_IDS.rulesTextModal)
				.setTitle('Server rules')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId(CUSTOM_IDS.rulesTextInput)
							.setLabel('Rules shown to new members')
							.setStyle(TextInputStyle.Paragraph)
							.setMaxLength(4000)
							.setRequired(true)
							.setValue(current.slice(0, 4000))
					)
				)
		)
		return
	}

	if (subcommand === 'intro-template') {
		const current = guildConfig.get(guild.id)?.introTemplateText ?? DEFAULT_INTRO_TEMPLATE

		await interaction.showModal(
			new ModalBuilder()
				.setCustomId(CUSTOM_IDS.introTemplateModal)
				.setTitle('Introduction template')
				.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId(CUSTOM_IDS.introTemplateInput)
							.setLabel('Shown in the introductions channel')
							.setStyle(TextInputStyle.Paragraph)
							.setMaxLength(4000)
							.setRequired(true)
							.setValue(current.slice(0, 4000))
					)
				)
		)
		return
	}

	if (subcommand === 'enable') {
		await interaction.deferReply(ephemeral)

		const resolved = resolveGuildConfig(guildConfig.get(guild.id))
		if (!isOk(resolved)) {
			await interaction.editReply({
				content: `I cannot enable onboarding yet:\n${resolved.error
					.map((problem) => `• ${problem.message}`)
					.join('\n')}`
			})
			return
		}

		const problems = await runPreflight(guild, resolved.value)
		if (problems.length > 0) {
			await interaction.editReply({
				content: `I cannot enable onboarding yet:\n${problems
					.map((problem) => `• ${problem.message}`)
					.join('\n')}`
			})
			return
		}

		const at = now()
		guildConfig.enable(guild.id, at, actorId, at)

		const published = await publishRulesMessage(guild, { ...resolved.value }, guildConfig)
		const templatePublished = await publishIntroTemplateMessage(
			guild,
			{ ...resolved.value },
			guildConfig
		)
		const members = await guild.members.fetch()
		const grandfathered = members.filter(
			(member) => !member.user.bot && (member.joinedTimestamp ?? 0) < Date.parse(at)
		).size

		await interaction.editReply({
			content: [
				'✅ Onboarding is **on**.',
				'',
				`**${grandfathered}** existing member${grandfathered === 1 ? '' : 's'} ${grandfathered === 1 ? 'was' : 'were'} exempted — nobody already here is affected. Only members who join from now on go through the gate.`,
				'',
				isOk(published)
					? `The rules message is posted in <#${resolved.value.rulesChannelId}>.`
					: `⚠️ I could not post the rules message: ${published.error}`,
				isOk(templatePublished)
					? `The introduction template is posted in <#${resolved.value.introductionsChannelId}>.`
					: `⚠️ I could not post the introduction template: ${templatePublished.error}`,
				'',
				'To also require existing members to onboard, run `/config grandfather action:clear`.'
			].join('\n')
		})
		return
	}

	if (subcommand === 'disable') {
		guildConfig.disable(guild.id)
		await interaction.reply({
			content:
				'Onboarding is **off**. I will take no further action in this server. Your configuration and all member records are kept.',
			...ephemeral
		})
		return
	}

	if (subcommand === 'grandfather') {
		await interaction.deferReply(ephemeral)

		const row = guildConfig.get(guild.id)
		if (!row?.grandfatherBefore) {
			await interaction.editReply({
				content: 'No exemption is set — every member is already subject to the gate.'
			})
			return
		}

		const members = await guild.members.fetch()
		const affected = members.filter(
			(member) =>
				!member.user.bot &&
				(member.joinedTimestamp ?? 0) < Date.parse(row.grandfatherBefore as string)
		).size

		guildConfig.clearGrandfather(guild.id)

		await interaction.editReply({
			content: `Exemption cleared. **${affected}** existing member${affected === 1 ? '' : 's'} will now be asked to complete onboarding, and will receive the unverified role on the next restart or when they next trigger the bot.`
		})
	}
}

export const handleRulesTextModal = async (
	interaction: ModalSubmitInteraction,
	deps: ConfigCommandDeps
): Promise<void> => {
	if (!interaction.guild) return

	const text = interaction.fields.getTextInputValue(CUSTOM_IDS.rulesTextInput)
	deps.guildConfig.setRulesText(interaction.guild.id, text, interaction.user.id, deps.now())

	const resolved = resolveGuildConfig(deps.guildConfig.get(interaction.guild.id))
	const republished =
		isOk(resolved) && resolved.value.rulesMessageId
			? await publishRulesMessage(interaction.guild, resolved.value, deps.guildConfig)
			: null

	await interaction.reply({
		content: republished
			? 'Rules updated and the posted rules message has been refreshed.'
			: 'Rules updated. They will be posted when you run `/config enable`.',
		...ephemeral
	})
}

export const handleIntroTemplateModal = async (
	interaction: ModalSubmitInteraction,
	deps: ConfigCommandDeps
): Promise<void> => {
	if (!interaction.guild) return

	const text = interaction.fields.getTextInputValue(CUSTOM_IDS.introTemplateInput)
	deps.guildConfig.setIntroTemplateText(interaction.guild.id, text, interaction.user.id, deps.now())

	const resolved = resolveGuildConfig(deps.guildConfig.get(interaction.guild.id))
	const republished =
		isOk(resolved) && resolved.value.introTemplateMessageId
			? await publishIntroTemplateMessage(interaction.guild, resolved.value, deps.guildConfig)
			: null

	await interaction.reply({
		content: republished
			? 'Introduction template updated and the posted message has been refreshed.'
			: 'Introduction template updated. It will be posted when you run `/config enable`.',
		...ephemeral
	})
}
