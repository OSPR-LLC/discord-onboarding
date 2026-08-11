import { describe, expect, it } from 'vitest'
import { loadEnv } from '../src/env.js'

describe('loadEnv', () => {
	it('reads the token and defaults the database path', () => {
		const env = loadEnv({ DISCORD_TOKEN: 'token-value' })
		expect(env.discordToken).toBe('token-value')
		expect(env.databasePath).toBe('./data/onboarding.db')
	})

	it('throws naming the token when it is missing', () => {
		expect(() => loadEnv({})).toThrow(/DISCORD_TOKEN/)
	})

	it('leaves the dev guild id undefined when not supplied', () => {
		expect(loadEnv({ DISCORD_TOKEN: 't' }).devGuildId).toBeUndefined()
	})

	it('rejects a dev guild id that is not a snowflake', () => {
		expect(() => loadEnv({ DISCORD_TOKEN: 't', DEV_GUILD_ID: 'nope' })).toThrow(/DEV_GUILD_ID/)
	})

	it('defaults the shard count to auto when not supplied', () => {
		expect(loadEnv({ DISCORD_TOKEN: 't' }).shardCount).toBe('auto')
	})

	it('treats an explicit "auto" the same as unset', () => {
		expect(loadEnv({ DISCORD_TOKEN: 't', SHARD_COUNT: 'auto' }).shardCount).toBe('auto')
	})

	it('parses a positive integer shard count', () => {
		expect(loadEnv({ DISCORD_TOKEN: 't', SHARD_COUNT: '4' }).shardCount).toBe(4)
	})

	it('rejects a non-integer shard count, naming SHARD_COUNT', () => {
		expect(() => loadEnv({ DISCORD_TOKEN: 't', SHARD_COUNT: 'nope' })).toThrow(/SHARD_COUNT/)
	})

	it('rejects a zero or negative shard count, naming SHARD_COUNT', () => {
		expect(() => loadEnv({ DISCORD_TOKEN: 't', SHARD_COUNT: '0' })).toThrow(/SHARD_COUNT/)
	})
})
