import Database from 'better-sqlite3'
import { migrate } from '../../src/db/migrate.js'

export const createTestDb = (): Database.Database => {
	const db = new Database(':memory:')
	migrate(db)
	return db
}
