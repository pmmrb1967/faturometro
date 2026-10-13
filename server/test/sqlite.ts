/** Test-only: the server's Sql interface over node:sqlite, with the real migration. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Sql, SqlValue } from '../src/db';

export function memorySql(): { sql: Sql; db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(join(__dirname, '../migrations/0001_init.sql'), 'utf8'));
  const sql: Sql = {
    first: async <T>(query: string, ...params: SqlValue[]) =>
      (db.prepare(query).get(...params) as T | undefined) ?? null,
    all: async <T>(query: string, ...params: SqlValue[]) => db.prepare(query).all(...params) as T[],
    run: async (query: string, ...params: SqlValue[]) => {
      db.prepare(query).run(...params);
    },
  };
  return { sql, db };
}
