import { env as processEnv } from 'node:process'

export const SNOWFLAKE_PATTERN = /^\d{17,20}$/

export type Env = {
	readonly discordToken: string
	readonly databasePath: string
	readonly shardCount: number | 'auto'
	readonly devGuildId?: string
}

export const loadEnv = (source: NodeJS.ProcessEnv = processEnv): Env => {
	const discordToken = source.DISCORD_TOKEN?.trim()
	if (!discordToken) throw new Error('Missing required environment variable: DISCORD_TOKEN')

	const devGuildId = source.DEV_GUILD_ID?.trim()
	if (devGuildId && !SNOWFLAKE_PATTERN.test(devGuildId))
		throw new Error(`Environment variable DEV_GUILD_ID is not a valid snowflake: ${devGuildId}`)

	const rawShards = source.SHARD_COUNT?.trim()
	const shardCount =
		!rawShards || rawShards === 'auto'
			? ('auto' as const)
			: (() => {
					const parsed = Number(rawShards)
					if (!Number.isInteger(parsed) || parsed < 1)
						throw new Error(
							`Environment variable SHARD_COUNT must be a positive integer or "auto": ${rawShards}`
						)
					return parsed
				})()

	const base = {
		discordToken,
		databasePath: source.DATABASE_PATH?.trim() || './data/onboarding.db',
		shardCount
	}

	// Assigned conditionally rather than as `devGuildId: undefined`, which
	// exactOptionalPropertyTypes rejects for an optional property.
	return devGuildId ? { ...base, devGuildId } : base
}
