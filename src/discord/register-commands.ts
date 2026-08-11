import type { Client } from 'discord.js'
import { configCommand } from './commands/config.js'

export const registerCommands = async (
	client: Client<true>,
	devGuildId?: string
): Promise<void> => {
	const commands = [configCommand.toJSON()]

	await client.application.commands.set(commands)

	// Global commands can take up to an hour to propagate. A dev guild gets
	// them immediately, which keeps iteration tolerable.
	if (devGuildId) {
		const guild = await client.guilds.fetch(devGuildId).catch(() => null)
		if (guild) await guild.commands.set(commands)
	}

	console.info(
		JSON.stringify({ level: 'info', event: 'commands-registered', count: commands.length })
	)
}
