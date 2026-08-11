import type { GuildConfigRow } from '../types.js'
import type { ChannelKind, GuildConfigRepository, RoleKind } from './guild-config-repository.js'

export type CacheStats = { hits: number; misses: number; size: number }

/**
 * Read-through cache over the guild config repository.
 *
 * `get` is called on essentially every gateway event, so uncached it is a
 * SQLite query per message in every served guild. The cache is authoritative
 * only because every mutating method below invalidates its guild — adding a
 * write method without an invalidation is the one way to break this, so the
 * test suite covers each method individually.
 *
 * Entries are unbounded by guild count, which is fine: one small row per guild,
 * and a bot in 10,000 guilds holds 10,000 rows.
 */
export const createCachedGuildConfigRepository = (inner: GuildConfigRepository) => {
	// `undefined` means "not cached"; `null` means "cached, and the guild has no
	// row" — worth distinguishing so unconfigured guilds do not query every time.
	const cache = new Map<string, GuildConfigRow | null>()

	let hits = 0
	let misses = 0

	const invalidate = (guildId: string): void => {
		cache.delete(guildId)
	}

	return {
		get: (guildId: string): GuildConfigRow | null => {
			const cached = cache.get(guildId)
			if (cached !== undefined) {
				hits += 1
				return cached
			}

			misses += 1
			const row = inner.get(guildId)
			cache.set(guildId, row)
			return row
		},

		ensure: (guildId: string, joinedAt: string): void => {
			inner.ensure(guildId, joinedAt)
			invalidate(guildId)
		},

		setChannel: (
			guildId: string,
			kind: ChannelKind,
			channelId: string,
			actorId: string,
			at: string
		): void => {
			inner.setChannel(guildId, kind, channelId, actorId, at)
			invalidate(guildId)
		},

		setRole: (
			guildId: string,
			kind: RoleKind,
			roleId: string,
			actorId: string,
			at: string
		): void => {
			inner.setRole(guildId, kind, roleId, actorId, at)
			invalidate(guildId)
		},

		setRulesText: (guildId: string, text: string, actorId: string, at: string): void => {
			inner.setRulesText(guildId, text, actorId, at)
			invalidate(guildId)
		},

		setRulesMessageId: (guildId: string, messageId: string | null): void => {
			inner.setRulesMessageId(guildId, messageId)
			invalidate(guildId)
		},

		enable: (guildId: string, grandfatherBefore: string, actorId: string, at: string): void => {
			inner.enable(guildId, grandfatherBefore, actorId, at)
			invalidate(guildId)
		},

		disable: (guildId: string): void => {
			inner.disable(guildId)
			invalidate(guildId)
		},

		clearGrandfather: (guildId: string): void => {
			inner.clearGrandfather(guildId)
			invalidate(guildId)
		},

		remove: (guildId: string): void => {
			inner.remove(guildId)
			invalidate(guildId)
		},

		// Not cached: it is called once at startup and once per sweep tick, and
		// caching a whole-table scan would need invalidating on every write.
		listEnabled: (): GuildConfigRow[] => inner.listEnabled(),

		stats: (): CacheStats => ({ hits, misses, size: cache.size })
	}
}
