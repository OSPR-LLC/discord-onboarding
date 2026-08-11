import { resolveGuildConfig, type ResolvedGuildConfig } from '../core/guild-config.js'
import type { GuildConfigRepository } from '../db/guild-config-repository.js'
import { isOk } from '../types.js'

/** Returns config only when the guild is both enabled and fully configured. */
export const resolveActiveConfig = (
	guildConfig: GuildConfigRepository,
	guildId: string
): ResolvedGuildConfig | null => {
	const row = guildConfig.get(guildId)
	if (!row?.enabled) return null

	const resolved = resolveGuildConfig(row)
	return isOk(resolved) ? resolved.value : null
}
