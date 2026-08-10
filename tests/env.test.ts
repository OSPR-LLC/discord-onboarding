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
})
