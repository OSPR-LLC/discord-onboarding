import { DiscordAPIError, EmbedBuilder, type Client } from 'discord.js'
import type {
	AuditEntry,
	ChannelError,
	DiscordPort,
	DmContent,
	DmError,
	RoleError
} from '../core/discord-port.js'
import { err, ok, type Result } from '../types.js'

const CANNOT_SEND_TO_USER = 50007
const MISSING_PERMISSIONS = 50013
const UNKNOWN_MEMBER = 10007

const toRoleError = (error: unknown): RoleError => {
	if (error instanceof DiscordAPIError) {
		if (error.code === MISSING_PERMISSIONS) return 'missing-permission'
		if (error.code === UNKNOWN_MEMBER) return 'member-not-found'
	}
	return 'unknown'
}

export const createDiscordPort = (client: Client): DiscordPort => {
	const changeRole = async (
		guildId: string,
		userId: string,
		roleId: string,
		action: 'add' | 'remove'
	): Promise<Result<void, RoleError>> => {
		try {
			const guild = await client.guilds.fetch(guildId)
			const member = await guild.members.fetch(userId)

			if (action === 'add') await member.roles.add(roleId)
			else await member.roles.remove(roleId)

			return ok(undefined)
		} catch (error) {
			const mapped = toRoleError(error)
			console.error(
				JSON.stringify({
					level: 'error',
					event: 'role-change-failed',
					guildId,
					userId,
					roleId,
					action,
					error: mapped
				})
			)
			return err(mapped)
		}
	}

	return {
		addRole: (guildId, userId, roleId) => changeRole(guildId, userId, roleId, 'add'),
		removeRole: (guildId, userId, roleId) => changeRole(guildId, userId, roleId, 'remove'),

		sendDm: async (userId: string, content: DmContent): Promise<Result<void, DmError>> => {
			try {
				const user = await client.users.fetch(userId)
				await user.send({
					embeds: [new EmbedBuilder().setTitle(content.title).setDescription(content.body)]
				})
				return ok(undefined)
			} catch (error) {
				if (error instanceof DiscordAPIError && error.code === CANNOT_SEND_TO_USER) {
					console.info(JSON.stringify({ level: 'info', event: 'dm-closed', userId }))
					return err('dms-closed')
				}
				console.error(JSON.stringify({ level: 'error', event: 'dm-failed', userId }))
				return err('unknown')
			}
		},

		postAudit: async (
			guildId: string,
			channelId: string,
			entry: AuditEntry
		): Promise<Result<void, ChannelError>> => {
			try {
				const guild = await client.guilds.fetch(guildId)
				const channel = await guild.channels.fetch(channelId)
				if (!channel?.isTextBased()) return err('channel-not-found')

				const embed = new EmbedBuilder()
					.setTitle(entry.kind)
					.setDescription(entry.detail)
					.addFields({ name: 'Member', value: `<@${entry.userId}>`, inline: true })
					.setTimestamp()

				if (entry.actorId)
					embed.addFields({ name: 'Moderator', value: `<@${entry.actorId}>`, inline: true })

				await channel.send({ embeds: [embed] })
				return ok(undefined)
			} catch {
				console.error(JSON.stringify({ level: 'error', event: 'audit-failed', guildId, channelId }))
				return err('unknown')
			}
		}
	}
}
