import { describe, expect, it } from 'vitest';
import { parseStats, report } from './sync-capacity';

const output = JSON.stringify([
  {
    results: [
      {
        accounts: 150,
        records_bytes: 100_000_000,
        files_bytes: 320_000_000,
        computed_at: '2026-10-14T03:17:00.000Z',
      },
    ],
    success: true,
    meta: {},
  },
]);

describe('sync capacity report', () => {
  it('reads the stats row from wrangler output', () => {
    expect(parseStats(output)).toEqual({
      accounts: 150,
      records_bytes: 100_000_000,
      files_bytes: 320_000_000,
      computed_at: '2026-10-14T03:17:00.000Z',
    });
  });

  it('fails clearly when the daily job has not run yet', () => {
    expect(() => parseStats(JSON.stringify([{ results: [], success: true }]))).toThrow(/stats/);
  });

  it('alerts at 70% of any limit and reports percentages only', () => {
    const below = report({ accounts: 139, records_bytes: 0, files_bytes: 0, computed_at: 'x' });
    expect(below.alert).toBe(false);
    const above = report(parseStats(output));
    expect(above.alert).toBe(true); // files 320/450 MB = 71%
    expect(above.text).toContain('71%');
    expect(above.text).toContain('75%'); // accounts 150/200
    expect(above.text).not.toMatch(/@/);
  });
});
