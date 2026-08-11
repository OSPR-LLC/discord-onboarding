import type { AuditEntry, DiscordPort, DmContent } from '../../src/core/discord-port.js'
import { err, ok } from '../../src/types.js'

type RoleCall = { guildId: string; userId: string; roleId: string }

export const createFakeDiscordPort = () => {
	const addedRoles: RoleCall[] = []
	const removedRoles: RoleCall[] = []
	const dms: { userId: string; content: DmContent }[] = []
	const audits: AuditEntry[] = []
	const dmFailures = new Set<string>()
	const roleFailures = new Set<string>()

	const port: DiscordPort = {
		addRole: async (guildId, userId, roleId) => {
			if (roleFailures.has(userId)) return err('missing-permission')
			addedRoles.push({ guildId, userId, roleId })
			return ok(undefined)
		},
		removeRole: async (guildId, userId, roleId) => {
			removedRoles.push({ guildId, userId, roleId })
			return ok(undefined)
		},
		sendDm: async (userId, content) => {
			if (dmFailures.has(userId)) return err('dms-closed')
			dms.push({ userId, content })
			return ok(undefined)
		},
		postAudit: async (_guildId, _channelId, entry) => {
			audits.push(entry)
			return ok(undefined)
		}
	}

	return {
		port,
		addedRoles,
		removedRoles,
		dms,
		audits,
		failDmFor: (userId: string) => dmFailures.add(userId),
		failRoleFor: (userId: string) => roleFailures.add(userId)
	}
}
