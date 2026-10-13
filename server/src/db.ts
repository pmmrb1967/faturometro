/** Minimal SQL interface: Cloudflare D1 in production, node:sqlite in tests. */
export type SqlValue = string | number | null;

export interface Sql {
  first<T>(query: string, ...params: SqlValue[]): Promise<T | null>;
  all<T>(query: string, ...params: SqlValue[]): Promise<T[]>;
  run(query: string, ...params: SqlValue[]): Promise<void>;
}

/** The subset of Cloudflare's D1Database used here (no dependency on its types). */
interface D1Statement {
  bind(...values: SqlValue[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface D1Like {
  prepare(query: string): D1Statement;
}

export function d1(db: D1Like): Sql {
  const statement = (query: string, params: SqlValue[]) => db.prepare(query).bind(...params);
  return {
    first: <T>(query: string, ...params: SqlValue[]) => statement(query, params).first<T>(),
    all: async <T>(query: string, ...params: SqlValue[]) =>
      (await statement(query, params).all<T>()).results,
    run: async (query: string, ...params: SqlValue[]) => {
      await statement(query, params).run();
    },
  };
}
