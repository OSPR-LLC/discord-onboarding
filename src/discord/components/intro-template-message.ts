import { EmbedBuilder, type Guild } from 'discord.js'
import type { ResolvedGuildConfig } from '../../core/guild-config.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import { err, ok, type Result } from '../../types.js'

// See rules-message.ts's RulesMessagePayload for why this is narrower than
// discord.js's MessageCreateOptions: it must typecheck against both send()
// and Message.edit() under exactOptionalPropertyTypes.
type IntroTemplatePayload = {
	readonly embeds: EmbedBuilder[]
}

export const buildIntroTemplateMessage = (config: ResolvedGuildConfig): IntroTemplatePayload => ({
	embeds: [
		new EmbedBuilder()
			.setTitle('Introduce yourself')
			.setDescription(config.introTemplateText)
			.setFooter({ text: 'Post your answers as a message in this channel to finish onboarding.' })
	]
})

export const publishIntroTemplateMessage = async (
	guild: Guild,
	config: ResolvedGuildConfig,
	repo: GuildConfigRepository
): Promise<Result<string, string>> => {
	const channel = await guild.channels.fetch(config.introductionsChannelId).catch(() => null)
	if (!channel?.isTextBased())
		return err('The introductions channel is missing or is not a text channel.')

	const payload = buildIntroTemplateMessage(config)

	if (config.introTemplateMessageId) {
		const existing = await channel.messages.fetch(config.introTemplateMessageId).catch(() => null)
		if (existing) {
			await existing.edit(payload)
			return ok(existing.id)
		}
		// Stored id no longer resolves — the message was deleted or the channel changed.
	}

	const posted = await channel.send(payload)
	repo.setIntroTemplateMessageId(guild.id, posted.id)

	// Pinning is a nice-to-have, not a requirement: it needs Manage Messages,
	// which is not part of the bot's required permission set, and a failed pin
	// must not stop onboarding from being enabled.
	await posted.pin().catch(() => {
		console.info(
			JSON.stringify({
				level: 'info',
				event: 'intro-template-pin-skipped',
				guildId: guild.id
			})
		)
	})

	return ok(posted.id)
}
