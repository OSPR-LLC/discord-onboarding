import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from 'better-sqlite3'

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql')

// Columns added after the initial schema. `CREATE TABLE IF NOT EXISTS` is a
// no-op against a database that already has the table, so a column added to
// schema.sql only reaches existing databases through an explicit, guarded
// ALTER TABLE here. Each entry runs at most once per database, ever.
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
	{
		table: 'guild_config',
		column: 'intro_template_text',
		ddl: 'ALTER TABLE guild_config ADD COLUMN intro_template_text TEXT'
	},
	{
		table: 'guild_config',
		column: 'intro_template_message_id',
		ddl: 'ALTER TABLE guild_config ADD COLUMN intro_template_message_id TEXT'
	}
]

const hasColumn = (db: Database, table: string, column: string): boolean =>
	(db.pragma(`table_info(${table})`) as { name: string }[]).some((row) => row.name === column)

export const migrate = (db: Database): void => {
	db.pragma('foreign_keys = ON')

	// WAL lets readers run concurrently with a writer, which is what makes a
	// single database file safe to share across shard processes. It is
	// unsupported on in-memory databases, where SQLite reports "memory" instead.
	if (!db.memory) {
		db.pragma('journal_mode = WAL')
		// NORMAL is durable across process crashes (only a power loss can lose
		// the last transaction) and removes an fsync from every write.
		db.pragma('synchronous = NORMAL')
		// Shard processes share the file; wait rather than throwing SQLITE_BUSY.
		db.pragma('busy_timeout = 5000')
	}

	// The old questionnaire_answers had fixed purpose/experience_level/built_for_discord
	// columns. The configurable-questionnaire feature (2026-08-11) replaced it with a
	// normalized per-question table of the same name — CREATE TABLE IF NOT EXISTS is a
	// no-op against the old shape, so it has to be dropped first. This discards any rows
	// in the old shape; accepted because no guild had live production answer data when
	// this landed. See docs/superpowers/specs/2026-08-11-configurable-questionnaire-design.md.
	if (hasColumn(db, 'questionnaire_answers', 'purpose'))
		db.exec('DROP TABLE questionnaire_answers')

	db.exec(readFileSync(schemaPath, 'utf8'))

	for (const { table, column, ddl } of ADDED_COLUMNS)
		if (!hasColumn(db, table, column)) db.exec(ddl)
}
