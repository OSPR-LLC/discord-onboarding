import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ShardingManager } from 'discord.js'
import 'dotenv/config'
import { loadEnv } from './env.js'

const env = loadEnv()

// Processes, not threads. Each shard owns a disjoint subset of guilds, gets its
// own gateway connection and its own event loop, so shards genuinely run in
// parallel across cores. Discord requires this past 2,500 guilds.
const manager = new ShardingManager(fileURLToPath(new URL('./index.js', import.meta.url)), {
	token: env.discordToken,
	totalShards: env.shardCount,
	// Serial respawn avoids every shard reconnecting at once after a crash,
	// which would hit the identify rate limit.
	respawn: true,
	mode: 'process'
})

manager.on('shardCreate', (shard) => {
	console.info(JSON.stringify({ level: 'info', event: 'shard-spawned', shardId: shard.id }))

	shard.on('death', () =>
		console.error(JSON.stringify({ level: 'error', event: 'shard-died', shardId: shard.id }))
	)
	shard.on('error', (error) =>
		console.error(
			JSON.stringify({
				level: 'error',
				event: 'shard-error',
				shardId: shard.id,
				error: error.message
			})
		)
	)
})

const shutdown = (): void => {
	for (const shard of manager.shards.values()) shard.kill()
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await manager.spawn()
