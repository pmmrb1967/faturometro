import { describe, expect, it } from 'vitest';
import type { PageText } from '../pdf/text';
import {
  amount,
  date,
  dayMonthRange,
  decimalString,
  findItem,
  quantity,
  rows,
  valueBelow,
  valueRightOf,
} from './utils';

function item(str: string, x: number, y: number) {
  return { str, x, y, width: str.length * 5, height: 9, fontName: 'f' };
}

const PAGE: PageText = {
  page: 1,
  width: 595,
  height: 842,
  items: [
    item('Total', 300, 100.5),
    item('Fatura n.º', 40, 50),
    item('FT 1/2', 41, 59),
    item('Descrição', 40, 100),
    item('42,79€', 400, 101),
  ],
};

describe('rows', () => {
  it('groups items on the same baseline, left to right', () => {
    expect(rows(PAGE).map((row) => row.text)).toEqual([
      'Fatura n.º',
      'FT 1/2',
      'Descrição | Total | 42,79€',
    ]);
  });
});

describe('label lookups', () => {
  it('finds the value below and to the right of a label', () => {
    const label = findItem(PAGE, /^Fatura n\.º$/);
    expect(label && valueBelow(PAGE, label)?.str).toBe('FT 1/2');
    const total = findItem(PAGE, /^Total$/);
    expect(total && valueRightOf(PAGE, total)?.str).toBe('42,79€');
  });
});

describe('values', () => {
  it('parses amounts with euro signs on either side', () => {
    expect(amount('€43,49')).toBe(4349);
    expect(amount('42,79€')).toBe(4279);
    expect(amount('-0,03')).toBe(-3);
    expect(amount('€43,490')).toBeNull();
  });

  it('keeps unit prices as decimal strings', () => {
    expect(decimalString('0,176159')).toBe('0.176159');
    expect(decimalString('-0,046800')).toBe('-0.046800');
    expect(decimalString('abc')).toBeNull();
  });

  it('parses quantities', () => {
    expect(quantity('6,90')).toBe(6.9);
    expect(quantity('6.508')).toBe(6508);
    expect(quantity('207')).toBe(207);
    expect(quantity('')).toBeNull();
  });

  it('parses dates in the formats invoices use', () => {
    expect(date('2026-06-21')).toBe('2026-06-21');
    expect(date('24-09-2026')).toBe('2026-09-24');
    expect(date('19 out 2026')).toBe('2026-10-19');
    expect(date('23 jun 2026')).toBe('2026-06-23');
    expect(date('31-02-2026')).toBeNull();
  });
});

describe('dayMonthRange', () => {
  it('infers years from the invoice date', () => {
    expect(dayMonthRange('22/05 a 21/06', '2026-06-23')).toEqual({
      start: '2026-05-22',
      end: '2026-06-21',
    });
    expect(dayMonthRange('23 ago - 22 set', '2026-09-24')).toEqual({
      start: '2026-08-23',
      end: '2026-09-22',
    });
  });

  it('handles periods billed in advance and across the new year', () => {
    expect(dayMonthRange('23 set - 22 out', '2026-09-24')).toEqual({
      start: '2026-09-23',
      end: '2026-10-22',
    });
    expect(dayMonthRange('23 dez - 22 jan', '2027-01-05')).toEqual({
      start: '2026-12-23',
      end: '2027-01-22',
    });
    expect(dayMonthRange('01/12 a 31/12', '2027-01-10')).toEqual({
      start: '2026-12-01',
      end: '2026-12-31',
    });
  });
});
