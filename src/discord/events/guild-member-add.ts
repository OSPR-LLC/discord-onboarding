import type { GuildMember } from 'discord.js'
import { isGrandfathered, type OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export type MemberAddDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly service: OnboardingService
}

export const handleGuildMemberAdd = async (
	member: GuildMember,
	deps: MemberAddDeps
): Promise<void> => {
	if (member.user.bot) return

	const config = resolveActiveConfig(deps.guildConfig, member.guild.id)
	if (!config) return

	const joinedAtMs = member.joinedTimestamp ?? Date.now()
	if (isGrandfathered(config, joinedAtMs)) return

	await deps.service.handleJoin(config, member.id, joinedAtMs)

	await member
		.send({
			content: `Welcome to **${member.guild.name}**. To get access: read and agree to the rules in <#${config.rulesChannelId}>, answer three quick questions, then introduce yourself in <#${config.introductionsChannelId}>.`
		})
		.catch(() => {
			console.info(
				JSON.stringify({
					level: 'info',
					event: 'join-dm-skipped',
					guildId: member.guild.id,
					userId: member.id
				})
			)
		})
}
