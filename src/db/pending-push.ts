import type { Table } from 'dexie';

/** A record to send on the next sync whatever its `updatedAt`. */
export interface PendingPush {
  table: string;
  id: string;
}

/**
 * Records restored from a backup keep their `updatedAt` (last write wins needs it), so they
 * can be older than the sync cursor. This device-local queue gets them sent all the same;
 * it lives here, not on the cursor, so that it survives a failed push and a sync in progress.
 */
export class PendingPushStore {
  readonly indexed = [] as const;
  private readonly table: Table<PendingPush, [string, string]>;

  constructor(table: Table<PendingPush, [string, string]>) {
    this.table = table;
  }

  async add(items: readonly PendingPush[]): Promise<void> {
    await this.table.bulkPut([...items]);
  }

  async list(): Promise<PendingPush[]> {
    return this.table.toArray();
  }

  async remove(items: readonly PendingPush[]): Promise<void> {
    await this.table.bulkDelete(items.map(({ table, id }): [string, string] => [table, id]));
  }
}
