/**
 * Database connection management
 *
 * Uses better-sqlite3 with WAL mode and foreign keys.
 */

import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';
import { logger } from '../utils/logger.js';

let db: Database.Database | null = null;

/**
 * Initialize (or re-initialize) the database.
 */
export function initDatabase(dbPath: string): Database.Database {
  if (db) {
    db.close();
  }

  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Create tables if they don't exist
  db.exec(SCHEMA_SQL);

  // Clear existing data for a clean scrape
  db.exec(`
    DELETE FROM curriculum_course;
    DELETE FROM course;
    DELETE FROM degree_program;
    DELETE FROM department;
  `);

  logger.info('DB', `Initialized: ${dbPath}`);
  return db;
}

/**
 * Get the current database instance.
 */
export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDatabase() first');
  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
