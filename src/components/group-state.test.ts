import { describe, expect, it } from 'vitest';
import { nextShown, parseOpenGroups } from './group-state';

describe('parseOpenGroups', () => {
  it('keeps the remembered blocks', () => {
    expect(parseOpenGroups('{"energy":false,"telecom":true}')).toEqual({
      energy: false,
      telecom: true,
    });
  });

  it('anything else means every block open', () => {
    expect(parseOpenGroups(null)).toEqual({});
    expect(parseOpenGroups('not json')).toEqual({});
    expect(parseOpenGroups('[false]')).toEqual({});
    expect(parseOpenGroups('{"energy":"no","water":false}')).toEqual({ water: false });
  });
});

describe('nextShown', () => {
  it('20 more each time, up to the last', () => {
    expect(nextShown(5, 100, 20)).toBe(25);
    expect(nextShown(85, 100, 20)).toBe(100);
  });
});
