import { Client, GatewayIntentBits, Options } from 'discord.js'

export const createClient = (): Client =>
	new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.GuildMessages
		],

		// Default caching retains messages, users, reactions and presences
		// indefinitely. Across thousands of guilds that is the dominant memory
		// cost, and this bot never re-reads any of it: the intro watcher only
		// needs the message currently in hand, and member lookups go through the
		// REST fetch in the port.
		makeCache: Options.cacheWithLimits({
			...Options.DefaultMakeCacheSettings,
			MessageManager: 0,
			ReactionManager: 0,
			GuildMessageManager: 0,
			PresenceManager: 0,
			ThreadManager: 0,
			GuildStickerManager: 0,
			GuildEmojiManager: 0
			// Members and roles are cached, since preflight and reconciliation
			// read them constantly. Members are swept below.
		}),

		sweepers: {
			...Options.DefaultSweeperSettings,
			// Drop members who have been idle for an hour. They are re-fetched on
			// demand; holding every member of every guild resident is what makes
			// large bots run out of memory.
			guildMembers: {
				interval: 600,
				filter: () => (member) => member.id !== member.client.user.id
			},
			users: {
				interval: 3600,
				filter: () => (user) => user.id !== user.client.user.id
			}
		}
	})
