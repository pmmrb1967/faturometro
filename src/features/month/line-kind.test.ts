import { describe, expect, it } from 'vitest';
import { lineKind } from './line-kind';

describe('lineKind', () => {
  it('names purchases and one-off expenses as one kind, and keeps the others', () => {
    expect(
      (['invoice', 'forecast', 'expense', 'transaction'] as const).map((kind) =>
        lineKind({ kind }),
      ),
    ).toEqual(['invoice', 'forecast', 'expense', 'oneOff']);
  });
});
