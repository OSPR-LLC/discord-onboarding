import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'
import { Events } from 'discord.js'
import 'dotenv/config'
import { createGuildConfigRepository } from './db/guild-config-repository.js'
import { migrate } from './db/migrate.js'
import { createOnboardingRepository } from './db/onboarding-repository.js'
import { createClient } from './discord/client.js'
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
	})
)

client.on(
	Events.GuildCreate,
	safeHandler('guildCreate', async (guild) => {
		guildConfig.ensure(guild.id, new Date().toISOString())
		console.info(JSON.stringify({ level: 'info', event: 'guild-joined', guildId: guild.id }))
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
