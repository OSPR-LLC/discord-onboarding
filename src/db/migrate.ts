import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database } from 'better-sqlite3'

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql')

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

	db.exec(readFileSync(schemaPath, 'utf8'))
}
