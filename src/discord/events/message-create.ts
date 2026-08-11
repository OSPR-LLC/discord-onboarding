import type { Message } from 'discord.js'
import type { OnboardingService } from '../../core/onboarding-service.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import type { OnboardingRepository } from '../../db/onboarding-repository.js'
import { resolveActiveConfig } from '../resolve-active-config.js'

export type MessageDeps = {
	readonly guildConfig: GuildConfigRepository
	readonly repo: OnboardingRepository
	readonly service: OnboardingService
}

export const handleMessageCreate = async (message: Message, deps: MessageDeps): Promise<void> => {
	if (message.author.bot || !message.guildId) return

	const config = resolveActiveConfig(deps.guildConfig, message.guildId)
	if (!config || message.channelId !== config.introductionsChannelId) return

	const existing = deps.repo.get(config.guildId, message.author.id)
	if (existing?.introPostedAt) return

	// A grandfathered member with no record posting here should not be pulled
	// into the flow; only members the bot is already tracking progress for.
	if (!existing && config.grandfatherBefore) {
		const member = await message.guild?.members.fetch(message.author.id).catch(() => null)
		const joinedAtMs = member?.joinedTimestamp ?? Date.now()
		if (joinedAtMs < Date.parse(config.grandfatherBefore)) return
	}

	await deps.service.recordStep(config, message.author.id, 'intro')
	deps.repo.setIntroMessageId(config.guildId, message.author.id, message.id)
}
