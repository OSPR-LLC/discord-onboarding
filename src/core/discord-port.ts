import type { Result } from '../types.js'

export type RoleError = 'member-not-found' | 'role-not-found' | 'missing-permission' | 'unknown'
export type DmError = 'dms-closed' | 'member-not-found' | 'unknown'
export type ChannelError = 'channel-not-found' | 'missing-permission' | 'unknown'

export type DmContent = { readonly title: string; readonly body: string }

export type AuditEntry = {
	readonly kind: 'verified' | 'mod-action' | 'reconcile-anomaly'
	readonly userId: string
	readonly detail: string
	readonly actorId?: string
}

export type DiscordPort = {
	addRole: (guildId: string, userId: string, roleId: string) => Promise<Result<void, RoleError>>
	removeRole: (guildId: string, userId: string, roleId: string) => Promise<Result<void, RoleError>>
	sendDm: (userId: string, content: DmContent) => Promise<Result<void, DmError>>
	postAudit: (
		guildId: string,
		channelId: string,
		entry: AuditEntry
	) => Promise<Result<void, ChannelError>>
}
