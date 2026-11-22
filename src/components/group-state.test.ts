import { describe, expect, it } from 'vitest';
import { isOpenIn, nextShown, parseOpenGroups } from './group-state';

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

describe('isOpenIn', () => {
  it('follows what was remembered', () => {
    expect(isOpenIn({ sync: true }, 'sync', false)).toBe(true);
    expect(isOpenIn({ sync: false }, 'sync', true)).toBe(false);
  });

  it('a block never touched takes the page default', () => {
    expect(isOpenIn({}, 'sync', true)).toBe(true);
    expect(isOpenIn({}, 'sync', false)).toBe(false);
  });
});
