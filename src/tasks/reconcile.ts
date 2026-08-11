import type { Guild } from 'discord.js'
import type { DiscordPort } from '../core/discord-port.js'
import type { ResolvedGuildConfig } from '../core/guild-config.js'
import { isGrandfathered, type OnboardingService } from '../core/onboarding-service.js'
import type { GuildConfigRepository } from '../db/guild-config-repository.js'
import type { OnboardingRepository } from '../db/onboarding-repository.js'
import { resolveActiveConfig } from '../discord/resolve-active-config.js'

export type ReconcileMember = {
	readonly userId: string
	readonly isBot: boolean
	readonly joinedAtMs: number
	readonly roleIds: readonly string[]
}

export type ReconcileDeps = {
	readonly repo: OnboardingRepository
	readonly service: OnboardingService
	readonly port: DiscordPort
}

export type ReconcileSummary = {
	created: number
	grandfathered: number
	rolesRestored: number
	holdsEnforced: number
	granted: number
	anomalies: number
}

export const reconcileMembers = async (
	deps: ReconcileDeps,
	config: ResolvedGuildConfig,
	members: readonly ReconcileMember[]
): Promise<ReconcileSummary> => {
	const summary: ReconcileSummary = {
		created: 0,
		grandfathered: 0,
		rolesRestored: 0,
		holdsEnforced: 0,
		granted: 0,
		anomalies: 0
	}

	for (const member of members) {
		if (member.isBot) continue

		// Checked before anything else: an existing member from before the guild
		// was enabled must never be restricted by a bot restart.
		if (isGrandfathered(config, member.joinedAtMs)) {
			summary.grandfathered += 1
			continue
		}

		const record = deps.repo.get(config.guildId, member.userId)
		const hasVerifiedRole = member.roleIds.includes(config.verifiedRoleId)

		if (!record) {
			if (hasVerifiedRole) {
				summary.anomalies += 1
				await deps.port.postAudit(config.guildId, config.modLogChannelId, {
					kind: 'reconcile-anomaly',
					userId: member.userId,
					detail: 'Holds the verified role but has no onboarding record. Left unchanged for review.'
				})
				continue
			}
			await deps.service.handleJoin(config, member.userId, member.joinedAtMs)
			summary.created += 1
			continue
		}

		if (record.verificationHoldAt) {
			if (hasVerifiedRole) {
				await deps.port.removeRole(config.guildId, member.userId, config.verifiedRoleId)
				await deps.port.addRole(config.guildId, member.userId, config.unverifiedRoleId)
				summary.holdsEnforced += 1
			}
			continue
		}

		if (record.verifiedAt) {
			if (!hasVerifiedRole) {
				await deps.port.addRole(config.guildId, member.userId, config.verifiedRoleId)
				await deps.port.removeRole(config.guildId, member.userId, config.unverifiedRoleId)
				summary.rolesRestored += 1
			}
			continue
		}

		if (record.rulesAcceptedAt && record.questionnaireCompletedAt && record.introPostedAt) {
			await deps.service.grantVerified(config, record)
			summary.granted += 1
			continue
		}

		if (hasVerifiedRole) {
			summary.anomalies += 1
			await deps.port.postAudit(config.guildId, config.modLogChannelId, {
				kind: 'reconcile-anomaly',
				userId: member.userId,
				detail: 'Holds the verified role without completing onboarding. Left unchanged for review.'
			})
		}
	}

	return summary
}

export const reconcile = async (deps: {
	guild: Guild
	guildConfig: GuildConfigRepository
	repo: OnboardingRepository
	service: OnboardingService
	port: DiscordPort
}): Promise<ReconcileSummary | null> => {
	const config = resolveActiveConfig(deps.guildConfig, deps.guild.id)
	if (!config) return null

	const members = await deps.guild.members.fetch()

	const summary = await reconcileMembers(
		{ repo: deps.repo, service: deps.service, port: deps.port },
		config,
		members.map((member) => ({
			userId: member.id,
			isBot: member.user.bot,
			joinedAtMs: member.joinedTimestamp ?? Date.now(),
			roleIds: [...member.roles.cache.keys()]
		}))
	)

	console.info(
		JSON.stringify({
			level: 'info',
			event: 'reconcile-complete',
			guildId: deps.guild.id,
			...summary
		})
	)

	return summary
}
