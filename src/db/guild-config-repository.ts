import type { Database, Statement } from 'better-sqlite3'
import type { GuildConfigRow } from '../types.js'

export type ChannelKind = 'rules' | 'introductions' | 'modlog'
export type RoleKind = 'verified' | 'unverified'

const CHANNEL_COLUMNS: Record<ChannelKind, string> = {
	rules: 'rules_channel_id',
	introductions: 'introductions_channel_id',
	modlog: 'mod_log_channel_id'
}

const ROLE_COLUMNS: Record<RoleKind, string> = {
	verified: 'verified_role_id',
	unverified: 'unverified_role_id'
}

type Row = {
	guild_id: string
	rules_channel_id: string | null
	introductions_channel_id: string | null
	mod_log_channel_id: string | null
	verified_role_id: string | null
	unverified_role_id: string | null
	rules_text: string | null
	rules_message_id: string | null
	enabled: number
	grandfather_before: string | null
	joined_at: string
	configured_at: string | null
	configured_by: string | null
}

const toConfig = (row: Row): GuildConfigRow => ({
	guildId: row.guild_id,
	rulesChannelId: row.rules_channel_id,
	introductionsChannelId: row.introductions_channel_id,
	modLogChannelId: row.mod_log_channel_id,
	verifiedRoleId: row.verified_role_id,
	unverifiedRoleId: row.unverified_role_id,
	rulesText: row.rules_text,
	rulesMessageId: row.rules_message_id,
	enabled: row.enabled === 1,
	grandfatherBefore: row.grandfather_before,
	joinedAt: row.joined_at,
	configuredAt: row.configured_at,
	configuredBy: row.configured_by
})

export const createGuildConfigRepository = (db: Database) => {
	// Every statement is compiled once here, not per call. `get` runs on
	// effectively every gateway event, so recompiling its SQL each time would
	// be pure waste at any real event rate.
	const statements = {
		ensure: db.prepare(
			'INSERT INTO guild_config (guild_id, joined_at) VALUES (?, ?) ON CONFLICT(guild_id) DO NOTHING'
		),
		get: db.prepare('SELECT * FROM guild_config WHERE guild_id = ?'),
		touch: db.prepare(
			'UPDATE guild_config SET configured_at = ?, configured_by = ? WHERE guild_id = ?'
		),
		setRulesText: db.prepare('UPDATE guild_config SET rules_text = ? WHERE guild_id = ?'),
		setRulesMessageId: db.prepare(
			'UPDATE guild_config SET rules_message_id = ? WHERE guild_id = ?'
		),
		enable: db.prepare(
			'UPDATE guild_config SET enabled = 1, grandfather_before = ? WHERE guild_id = ?'
		),
		disable: db.prepare('UPDATE guild_config SET enabled = 0 WHERE guild_id = ?'),
		clearGrandfather: db.prepare(
			'UPDATE guild_config SET grandfather_before = NULL WHERE guild_id = ?'
		),
		listEnabled: db.prepare('SELECT * FROM guild_config WHERE enabled = 1'),
		remove: db.prepare('DELETE FROM guild_config WHERE guild_id = ?')
	}

	// Column names cannot be bound as parameters, so each target column needs
	// its own compiled statement. Building them from the fixed maps keeps the
	// SQL free of any caller-supplied string.
	const channelStatements = Object.fromEntries(
		Object.entries(CHANNEL_COLUMNS).map(([kind, column]) => [
			kind,
			db.prepare(`UPDATE guild_config SET ${column} = ? WHERE guild_id = ?`)
		])
	) as Record<ChannelKind, Statement<[string, string]>>

	const roleStatements = Object.fromEntries(
		Object.entries(ROLE_COLUMNS).map(([kind, column]) => [
			kind,
			db.prepare(`UPDATE guild_config SET ${column} = ? WHERE guild_id = ?`)
		])
	) as Record<RoleKind, Statement<[string, string]>>

	const touch = (guildId: string, actorId: string, at: string): void => {
		statements.touch.run(at, actorId, guildId)
	}

	return {
		ensure: (guildId: string, joinedAt: string): void => {
			statements.ensure.run(guildId, joinedAt)
		},

		get: (guildId: string): GuildConfigRow | null => {
			const row = statements.get.get(guildId) as Row | undefined
			return row ? toConfig(row) : null
		},

		setChannel: (
			guildId: string,
			kind: ChannelKind,
			channelId: string,
			actorId: string,
			at: string
		): void => {
			channelStatements[kind].run(channelId, guildId)
			touch(guildId, actorId, at)
		},

		setRole: (
			guildId: string,
			kind: RoleKind,
			roleId: string,
			actorId: string,
			at: string
		): void => {
			roleStatements[kind].run(roleId, guildId)
			touch(guildId, actorId, at)
		},

		setRulesText: (guildId: string, text: string, actorId: string, at: string): void => {
			statements.setRulesText.run(text, guildId)
			touch(guildId, actorId, at)
		},

		setRulesMessageId: (guildId: string, messageId: string | null): void => {
			statements.setRulesMessageId.run(messageId, guildId)
		},

		enable: (guildId: string, grandfatherBefore: string, actorId: string, at: string): void => {
			statements.enable.run(grandfatherBefore, guildId)
			touch(guildId, actorId, at)
		},

		disable: (guildId: string): void => {
			statements.disable.run(guildId)
		},

		clearGrandfather: (guildId: string): void => {
			statements.clearGrandfather.run(guildId)
		},

		listEnabled: (): GuildConfigRow[] => (statements.listEnabled.all() as Row[]).map(toConfig),

		remove: (guildId: string): void => {
			statements.remove.run(guildId)
		}
	}
}

export type GuildConfigRepository = ReturnType<typeof createGuildConfigRepository>
