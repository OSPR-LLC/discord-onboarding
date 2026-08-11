import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Guild } from 'discord.js'
import type { ResolvedGuildConfig } from '../../core/guild-config.js'
import type { GuildConfigRepository } from '../../db/guild-config-repository.js'
import { err, ok, type Result } from '../../types.js'
import { CUSTOM_IDS } from './custom-ids.js'

// Deliberately narrower than discord.js's MessageCreateOptions: that type's
// `flags` field allows values (e.g. IsVoiceMessage) that MessageEditOptions
// rejects, so passing a MessageCreateOptions-typed payload to Message.edit()
// fails to typecheck under exactOptionalPropertyTypes even when `flags` is
// never actually set. This payload only ever carries embeds and components,
// which both send() and edit() accept identically.
type RulesMessagePayload = {
	readonly embeds: EmbedBuilder[]
	readonly components: ActionRowBuilder<ButtonBuilder>[]
}

export const buildRulesMessage = (config: ResolvedGuildConfig): RulesMessagePayload => ({
	embeds: [
		new EmbedBuilder()
			.setTitle('Server rules')
			.setDescription(config.rulesText)
			.setFooter({ text: 'Agreeing is the first of three steps to get access.' })
	],
	components: [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(CUSTOM_IDS.rulesAgree)
				.setLabel('I agree')
				.setStyle(ButtonStyle.Success)
		)
	]
})

export const publishRulesMessage = async (
	guild: Guild,
	config: ResolvedGuildConfig,
	repo: GuildConfigRepository
): Promise<Result<string, string>> => {
	const channel = await guild.channels.fetch(config.rulesChannelId).catch(() => null)
	if (!channel?.isTextBased()) return err('The rules channel is missing or is not a text channel.')

	const payload = buildRulesMessage(config)

	if (config.rulesMessageId) {
		const existing = await channel.messages.fetch(config.rulesMessageId).catch(() => null)
		if (existing) {
			await existing.edit(payload)
			return ok(existing.id)
		}
		// Stored id no longer resolves — the message was deleted or the channel changed.
	}

	const posted = await channel.send(payload)
	repo.setRulesMessageId(guild.id, posted.id)
	return ok(posted.id)
}
