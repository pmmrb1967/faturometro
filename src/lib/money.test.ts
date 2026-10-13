import { describe, expect, it } from 'vitest';
import { formatCents, parseDotDecimalAmount, parsePtAmount, sumCents } from './money';

describe('parsePtAmount', () => {
  it.each([
    ['12,34', 1234],
    ['12,3', 1230],
    ['12', 1200],
    ['0,07', 7],
    ['1.234,56', 123456],
    ['1 234,56 €', 123456],
    ['1\u00a0234,56\u00a0€', 123456],
    ['-5,10', -510],
    ['€ 9,99', 999],
  ])('parses %j as %i cents', (text, cents) => {
    expect(parsePtAmount(text)).toBe(cents);
  });

  it.each(['', 'abc', '12,345', '1.23', '1,2,3'])('rejects %j', (text) => {
    expect(parsePtAmount(text)).toBeNull();
  });

  it('avoids floating point drift', () => {
    expect(parsePtAmount('0,29')).toBe(29);
    expect(parsePtAmount('1,15')).toBe(115);
  });
});

describe('parseDotDecimalAmount', () => {
  it.each([
    ['1234.56', 123456],
    ['0.10', 10],
    ['7', 700],
    ['-3.5', -350],
  ])('parses %j as %i cents', (text, cents) => {
    expect(parseDotDecimalAmount(text)).toBe(cents);
  });

  it.each(['1,23', '1.234,56', '1.234'])('rejects %j', (text) => {
    expect(parseDotDecimalAmount(text)).toBeNull();
  });
});

describe('sumCents', () => {
  it('sums integer cents', () => {
    expect(sumCents([10, 20, -5])).toBe(25);
  });

  it('rejects non-integer values', () => {
    expect(() => sumCents([0.1])).toThrow(TypeError);
  });
});

describe('formatCents', () => {
  it('formats in pt-PT euros', () => {
    expect(formatCents(123456).replace(/\s/g, ' ')).toBe('1234,56 €');
  });
});
