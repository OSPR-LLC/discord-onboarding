import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'
import { Events } from 'discord.js'
import 'dotenv/config'
import { createGuildConfigRepository } from './db/guild-config-repository.js'
import { migrate } from './db/migrate.js'
import { createOnboardingRepository } from './db/onboarding-repository.js'
import { handleConfigCommand, handleRulesTextModal } from './discord/commands/config.js'
import { createClient } from './discord/client.js'
import { CUSTOM_IDS } from './discord/components/custom-ids.js'
import { registerCommands } from './discord/register-commands.js'
import { safeHandler } from './discord/safe-handler.js'
import { loadEnv } from './env.js'

const env = loadEnv()

mkdirSync(dirname(env.databasePath), { recursive: true })
const db = new Database(env.databasePath)
migrate(db)

const guildConfig = createGuildConfigRepository(db)
const onboarding = createOnboardingRepository(db)

const client = createClient()

client.once(
	Events.ClientReady,
	safeHandler('ready', async (ready) => {
		const now = new Date().toISOString()

		// Any guild the bot is already in gets a config row, so /config has
		// something to write to without a separate first-run step.
		for (const [guildId] of await ready.guilds.fetch()) guildConfig.ensure(guildId, now)

		console.info(
			JSON.stringify({
				level: 'info',
				event: 'ready',
				user: ready.user.tag,
				guilds: ready.guilds.cache.size,
				enabled: guildConfig.listEnabled().length
			})
		)

		await registerCommands(ready, env.devGuildId)
	})
)

client.on(
	Events.GuildCreate,
	safeHandler('guildCreate', async (guild) => {
		guildConfig.ensure(guild.id, new Date().toISOString())
		console.info(JSON.stringify({ level: 'info', event: 'guild-joined', guildId: guild.id }))
	})
)

client.on(
	Events.GuildDelete,
	safeHandler('guildDelete', async (guild) => {
		console.info(JSON.stringify({ level: 'info', event: 'guild-left', guildId: guild.id }))
	})
)

client.on(
	Events.InteractionCreate,
	safeHandler('interactionCreate', async (interaction) => {
		const deps = { guildConfig, now: () => new Date().toISOString() }

		if (interaction.isChatInputCommand() && interaction.commandName === 'config') {
			await handleConfigCommand(interaction, deps)
			return
		}

		if (interaction.isModalSubmit() && interaction.customId === CUSTOM_IDS.rulesTextModal) {
			await handleRulesTextModal(interaction, deps)
		}
	})
)

const shutdown = (): void => {
	void client.destroy()
	db.close()
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await client.login(env.discordToken)
