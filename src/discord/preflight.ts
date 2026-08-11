import { PermissionFlagsBits, type Guild } from 'discord.js'
import type { ConfigProblem, ResolvedGuildConfig } from '../core/guild-config.js'

export const runPreflight = async (
	guild: Guild,
	config: ResolvedGuildConfig
): Promise<ConfigProblem[]> => {
	const problems: ConfigProblem[] = []
	const me = await guild.members.fetchMe()

	if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
		problems.push({
			field: 'permissions',
			message: 'I need the **Manage Roles** permission in this server.'
		})

	for (const [field, label, roleId] of [
		['verifiedRoleId', 'verified', config.verifiedRoleId],
		['unverifiedRoleId', 'unverified', config.unverifiedRoleId]
	] as const) {
		const role = await guild.roles.fetch(roleId).catch(() => null)

		if (!role) {
			problems.push({ field, message: `The ${label} role no longer exists. Set it again.` })
			continue
		}

		if (role.managed)
			problems.push({
				field,
				message: `The ${label} role is managed by an integration and cannot be assigned by me.`
			})
		else if (role.comparePositionTo(me.roles.highest) >= 0)
			problems.push({
				field,
				message: `The ${label} role (**${role.name}**) sits at or above my highest role, so I cannot assign it. Drag my role above it in Server Settings → Roles.`
			})
	}

	if (config.verifiedRoleId === config.unverifiedRoleId)
		problems.push({
			field: 'roles',
			message: 'The verified and unverified roles must be different roles.'
		})

	for (const [field, label, channelId, needsSend] of [
		['rulesChannelId', 'rules', config.rulesChannelId, true],
		// The bot now posts the introduction template message on enable, so it
		// needs Send Messages here too — no longer read-only.
		['introductionsChannelId', 'introductions', config.introductionsChannelId, true],
		['modLogChannelId', 'mod log', config.modLogChannelId, true]
	] as const) {
		const channel = await guild.channels.fetch(channelId).catch(() => null)

		if (!channel?.isTextBased()) {
			problems.push({ field, message: `The ${label} channel is missing or is not a text channel.` })
			continue
		}

		const permissions = channel.permissionsFor(me)

		if (!permissions?.has(PermissionFlagsBits.ViewChannel))
			problems.push({ field, message: `I cannot see the ${label} channel.` })
		else if (needsSend && !permissions.has(PermissionFlagsBits.SendMessages))
			problems.push({ field, message: `I cannot send messages in the ${label} channel.` })
	}

	return problems
}
