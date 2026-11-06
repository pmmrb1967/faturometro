import { describe, expect, it } from 'vitest';
import { saveInOrder } from './save-all';

describe('saveInOrder', () => {
  it('saves one document after the other, in order', async () => {
    const order: number[] = [];
    let running = 0;
    const step = (n: number) => async () => {
      running++;
      expect(running).toBe(1);
      await Promise.resolve();
      order.push(n);
      running--;
      return true;
    };
    expect(await saveInOrder([step(1), step(2), step(3)])).toEqual({ saved: 3, stopped: false });
    expect(order).toEqual([1, 2, 3]);
  });

  it('stops at the first document that is not saved (missing data), leaving the rest', async () => {
    const calls: number[] = [];
    const step = (n: number, ok: boolean) => async () => {
      calls.push(n);
      return ok;
    };
    expect(await saveInOrder([step(1, true), step(2, false), step(3, true)])).toEqual({
      saved: 1,
      stopped: true,
    });
    expect(calls).toEqual([1, 2]);
  });
});
