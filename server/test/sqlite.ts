/** Test-only: the server's Sql interface over node:sqlite, with the real migrations. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Sql, SqlValue } from '../src/db';

/** `source`: a migrations folder (every *.sql, in order) or one .sql file. */
export function memorySql(source = 'migrations'): { sql: Sql; db: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const path = join(__dirname, '..', source);
  const files = source.endsWith('.sql')
    ? [path]
    : readdirSync(path)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => join(path, name));
  for (const file of files) db.exec(readFileSync(file, 'utf8'));
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
