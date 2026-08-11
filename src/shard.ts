import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ShardingManager } from 'discord.js'
import 'dotenv/config'
import { loadEnv } from './env.js'

const env = loadEnv()

// This file itself is run two different ways: `tsx src/shard.ts` in dev (no
// compiled output on disk, so the entrypoint is the .ts source and the child
// needs tsx's loader to run it) or `node dist/shard.js` in prod (dist/index.js
// sits right beside it after `pnpm build`). Detect which by this file's own
// extension rather than hardcoding one path.
const isDev = import.meta.url.endsWith('.ts')
const entrypoint = fileURLToPath(new URL(isDev ? './index.ts' : './index.js', import.meta.url))

// Processes, not threads. Each shard owns a disjoint subset of guilds, gets its
// own gateway connection and its own event loop, so shards genuinely run in
// parallel across cores. Discord requires this past 2,500 guilds.
const manager = new ShardingManager(entrypoint, {
	token: env.discordToken,
	totalShards: env.shardCount,
	// Serial respawn avoids every shard reconnecting at once after a crash,
	// which would hit the identify rate limit.
	respawn: true,
	mode: 'process',
	execArgv: isDev ? ['--import', 'tsx'] : []
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
