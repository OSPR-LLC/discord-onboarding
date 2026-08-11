import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'
import { Events } from 'discord.js'
import 'dotenv/config'
import { createOnboardingService } from './core/onboarding-service.js'
import { createTaskQueue } from './core/task-queue.js'
import { createGuildConfigRepository } from './db/guild-config-repository.js'
import { migrate } from './db/migrate.js'
import { createOnboardingRepository } from './db/onboarding-repository.js'
import { createClient } from './discord/client.js'
import { handleConfigCommand, handleRulesTextModal } from './discord/commands/config.js'
import { CUSTOM_IDS } from './discord/components/custom-ids.js'
import { handleGuildMemberAdd } from './discord/events/guild-member-add.js'
import { handleOnboardingInteraction } from './discord/events/interaction-create.js'
import { handleMessageCreate } from './discord/events/message-create.js'
import { createDiscordPort } from './discord/port.js'
import { createQueuedPort } from './discord/queued-port.js'
import { registerCommands } from './discord/register-commands.js'
import { safeHandler } from './discord/safe-handler.js'
import { loadEnv } from './env.js'
import { reconcile } from './tasks/reconcile.js'
import { runReminderSweep } from './tasks/reminder-sweep.js'

const env = loadEnv()

mkdirSync(dirname(env.databasePath), { recursive: true })
const db = new Database(env.databasePath)
migrate(db)

const guildConfig = createGuildConfigRepository(db)
const onboarding = createOnboardingRepository(db)

const client = createClient()

const discordQueue = createTaskQueue({ concurrency: 8, maxQueued: 5000 })
const rawPort = createDiscordPort(client)
const port = createQueuedPort(rawPort, discordQueue, 'interactive')
const bulkPort = createQueuedPort(rawPort, discordQueue, 'bulk')

const service = createOnboardingService({
	repo: onboarding,
	port,
	now: () => new Date().toISOString()
})
const onboardingDeps = {
	guildConfig,
	repo: onboarding,
	service,
	now: () => new Date().toISOString()
}

let sweepTimer: NodeJS.Timeout | undefined

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

		for (const config of guildConfig.listEnabled()) {
			const guild = await ready.guilds.fetch(config.guildId).catch(() => null)
			if (guild) await reconcile({ guild, guildConfig, repo: onboarding, service, port: bulkPort })
		}

		const HOUR_MS = 60 * 60 * 1000

		const sweep = (): void => {
			void runReminderSweep({
				guildConfig,
				repo: onboarding,
				port: bulkPort,
				now: () => new Date()
			}).catch((error: unknown) => {
				console.error(
					JSON.stringify({
						level: 'error',
						event: 'reminder-sweep-failed',
						error: error instanceof Error ? error.message : String(error)
					})
				)
			})
		}

		sweep()
		sweepTimer = setInterval(sweep, HOUR_MS)
		sweepTimer.unref()
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
	Events.GuildMemberAdd,
	safeHandler('guildMemberAdd', (member) => handleGuildMemberAdd(member, { guildConfig, service }))
)

client.on(
	Events.MessageCreate,
	safeHandler('messageCreate', (message) => handleMessageCreate(message, onboardingDeps))
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
			return
		}

		await handleOnboardingInteraction(interaction, onboardingDeps)
	})
)

const shutdown = (): void => {
	if (sweepTimer) clearInterval(sweepTimer)
	void client.destroy()
	db.close()
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await client.login(env.discordToken)
