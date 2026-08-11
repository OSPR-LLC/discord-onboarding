import { err, ok, type GuildConfigRow, type Result } from '../types.js'

export const DEFAULT_RULES_TEXT = [
	'Be respectful. No harassment, hate speech, or personal attacks.',
	'No spam, unsolicited advertising, or mass DMs.',
	'Keep discussion in the channel it belongs in.',
	'No piracy, malware, or requests for either.',
	'Moderator decisions are final — raise disputes privately, not in public.'
]
	.map((rule, index) => `**${index + 1}.** ${rule}`)
	.join('\n\n')

export const DEFAULT_INTRO_TEMPLATE = [
	'**Name:**',
	'**Experience:**',
	'**Interests:**',
	'**Where are you from:**',
	'**Something about you:**'
].join('\n')

export type ResolvedGuildConfig = {
	readonly guildId: string
	readonly rulesChannelId: string
	readonly introductionsChannelId: string
	readonly modLogChannelId: string
	readonly verifiedRoleId: string
	readonly unverifiedRoleId: string
	readonly rulesText: string
	readonly rulesMessageId: string | null
	readonly introTemplateText: string
	readonly introTemplateMessageId: string | null
	readonly grandfatherBefore: string | null
}

export type ConfigProblem = { readonly field: string; readonly message: string }

const REQUIRED: { field: keyof GuildConfigRow; label: string; command: string }[] = [
	{ field: 'rulesChannelId', label: 'rules channel', command: '/config channel rules' },
	{
		field: 'introductionsChannelId',
		label: 'introductions channel',
		command: '/config channel introductions'
	},
	{ field: 'modLogChannelId', label: 'mod log channel', command: '/config channel modlog' },
	{ field: 'verifiedRoleId', label: 'verified role', command: '/config role verified' },
	{ field: 'unverifiedRoleId', label: 'unverified role', command: '/config role unverified' }
]

export const resolveGuildConfig = (
	row: GuildConfigRow | null
): Result<ResolvedGuildConfig, ConfigProblem[]> => {
	if (!row)
		return err(
			REQUIRED.map(({ field, label, command }) => ({
				field,
				message: `No ${label} set. Use \`${command}\`.`
			}))
		)

	const problems = REQUIRED.filter(({ field }) => !row[field]).map(({ field, label, command }) => ({
		field,
		message: `No ${label} set. Use \`${command}\`.`
	}))

	if (problems.length > 0) return err(problems)

	return ok({
		guildId: row.guildId,
		rulesChannelId: row.rulesChannelId as string,
		introductionsChannelId: row.introductionsChannelId as string,
		modLogChannelId: row.modLogChannelId as string,
		verifiedRoleId: row.verifiedRoleId as string,
		unverifiedRoleId: row.unverifiedRoleId as string,
		rulesText: row.rulesText ?? DEFAULT_RULES_TEXT,
		rulesMessageId: row.rulesMessageId,
		introTemplateText: row.introTemplateText ?? DEFAULT_INTRO_TEMPLATE,
		introTemplateMessageId: row.introTemplateMessageId,
		grandfatherBefore: row.grandfatherBefore
	})
}
