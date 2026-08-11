import type { Client } from 'discord.js'
import { configCommand } from './commands/config.js'
import { introCommand } from './commands/intro.js'
import { onboardingCommand } from './commands/onboarding.js'

export const registerCommands = async (
	client: Client<true>,
	devGuildId?: string
): Promise<void> => {
	const commands = [configCommand.toJSON(), introCommand.toJSON(), onboardingCommand.toJSON()]

	// Registering both scopes at once shows every command twice in the dev
	// guild — Discord's command picker does not dedupe a global command
	// against a guild command of the same name. A dev guild gets commands
	// immediately and exclusively; global registration (up to an hour to
	// propagate, but reaches every other guild) only runs without one.
	if (devGuildId) {
		const guild = await client.guilds.fetch(devGuildId).catch(() => null)
		if (guild) await guild.commands.set(commands)
	} else {
		await client.application.commands.set(commands)
	}

	console.info(
		JSON.stringify({ level: 'info', event: 'commands-registered', count: commands.length })
	)
}
