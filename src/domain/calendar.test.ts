import { describe, expect, it } from 'vitest';
import {
  calendarEvents,
  escapeText,
  foldLine,
  reminderTrigger,
  toICalendar,
  type CalendarInput,
} from './calendar';
import type { Contract, Invoice } from './types';

const META = { updatedAt: '2026-01-01T00:00:00.000Z' };

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    ...META,
    id: 'c1',
    providerId: 'p1',
    sector: 'telecom',
    label: 'Internet',
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function invoice(id: string, dueDate: string | undefined, contractId = 'c1'): Invoice {
  return {
    ...META,
    id,
    contractId,
    providerId: 'p1',
    fileHash: id,
    docType: 'FT',
    issueDate: '2026-10-01',
    ...(dueDate ? { dueDate } : {}),
    totalCents: 4599,
    qrStatus: 'ok',
    validation: 'passed',
    sources: {},
    confidence: {},
    createdAt: '2026-10-01T10:00:00.000Z',
  };
}

function input(overrides: Partial<CalendarInput> = {}): CalendarInput {
  return {
    contracts: [contract({ loyaltyEndDate: '2027-01-31' })],
    invoices: [],
    loyaltyAlertDays: [60, 30, 7],
    today: '2026-10-14',
    ...overrides,
  };
}

describe('calendarEvents', () => {
  it('adds the end of the loyalty period with the alert thresholds as reminders', () => {
    const [event, ...rest] = calendarEvents(input());
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      uid: 'loyalty-c1@faturometro',
      kind: 'loyalty_end',
      date: '2027-01-31',
      remindDaysBefore: [60, 30, 7],
    });
  });

  it('keeps only the reminders still ahead', () => {
    const [event] = calendarEvents(input({ today: '2027-01-10' }));
    expect(event?.remindDaysBefore).toEqual([7]);
  });

  it('leaves out past dates and inactive contracts', () => {
    expect(calendarEvents(input({ today: '2027-02-01' }))).toEqual([]);
    const inactive = contract({ loyaltyEndDate: '2027-01-31', active: false });
    expect(
      calendarEvents(input({ contracts: [inactive], invoices: [invoice('i1', '2026-10-20')] })),
    ).toEqual([]);
  });

  it('adds payment due dates from today on, sorted by date', () => {
    const events = calendarEvents(
      input({
        invoices: [
          invoice('late', '2026-10-13'),
          invoice('none', undefined),
          invoice('today', '2026-10-14'),
          invoice('next', '2026-10-20'),
          invoice('orphan', '2026-10-20', 'gone'),
        ],
      }),
    );
    expect(events.map((event) => [event.uid, event.remindDaysBefore])).toEqual([
      ['payment-today@faturometro', []],
      ['payment-next@faturometro', [3]],
      ['loyalty-c1@faturometro', [60, 30, 7]],
    ]);
    expect(events[0]?.invoice?.id).toBe('today');
  });
});

describe('meter readings', () => {
  it('adds the window of the newest invoice, with a reminder on its first day', () => {
    const old = {
      ...invoice('old', undefined),
      issueDate: '2026-08-01',
      readingWindow: { start: '2026-09-01', end: '2026-09-04' },
    };
    const latest = {
      ...invoice('new', undefined),
      readingWindow: { start: '2026-10-28', end: '2026-10-31' },
    };
    const events = calendarEvents(input({ contracts: [contract()], invoices: [old, latest] }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      uid: 'reading-c1@faturometro',
      kind: 'meter_reading',
      date: '2026-10-28',
      endDate: '2026-10-31',
      remindDaysBefore: [0],
    });
    expect(
      calendarEvents(input({ contracts: [contract()], invoices: [latest], today: '2026-11-01' })),
    ).toEqual([]);
  });
});

describe('insurance renewals', () => {
  it('adds the day after the latest paid period, for insurance contracts', () => {
    const policy = contract({ id: 'ins', sector: 'insurance' });
    const receipt = (id: string, end: string): Invoice => ({
      ...invoice(id, undefined, 'ins'),
      periodStart: '2025-10-10',
      periodEnd: end,
    });
    const events = calendarEvents(
      input({
        contracts: [policy],
        invoices: [receipt('old', '2025-10-09'), receipt('new', '2026-10-09')],
        today: '2026-09-01',
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({
        uid: 'renewal-ins@faturometro',
        kind: 'renewal',
        date: '2026-10-10',
        remindDaysBefore: [30, 7],
      }),
    ]);
  });
});

describe('ics helpers', () => {
  it('escapes text values', () => {
    expect(escapeText('a\\b; c, d\ne')).toBe('a\\\\b\\; c\\, d\\ne');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const line = `SUMMARY:${'é'.repeat(80)}`;
    const parts = foldLine(line).split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((part) => part.startsWith(' '))).toBe(true);
    expect(parts.map((part, i) => (i === 0 ? part : part.slice(1))).join('')).toBe(line);
    expect(foldLine('SHORT')).toBe('SHORT');
  });

  it('fires reminders at 9:00 the given number of days before', () => {
    expect(reminderTrigger(0)).toBe('PT9H');
    expect(reminderTrigger(1)).toBe('-PT15H');
    expect(reminderTrigger(7)).toBe('-P6DT15H');
  });
});

describe('toICalendar', () => {
  it('writes all-day events with reminders and CRLF line endings', () => {
    const ics = toICalendar(
      [
        {
          uid: 'loyalty-c1@faturometro',
          date: '2027-01-31',
          summary: 'Fim da fidelização: Internet, NOS',
          description: 'Compara ofertas antes de renovar.',
          url: 'https://app.example/app/contratos/c1',
          remindDaysBefore: [30],
          reminder: 'Faltam dias',
        },
      ],
      'Faturómetro',
      '2026-10-14T12:34:56.789Z',
    );
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(
      ics
        .split('\r\n')
        .slice(0, -1)
        .every((line) => line.length > 0),
    ).toBe(true);
    const lines = ics.split('\r\n');
    expect(lines).toEqual(
      expect.arrayContaining([
        'BEGIN:VCALENDAR',
        'X-WR-CALNAME:Faturómetro',
        'UID:loyalty-c1@faturometro',
        'DTSTAMP:20261014T123456Z',
        'DTSTART;VALUE=DATE:20270131',
        'DTEND;VALUE=DATE:20270201',
        'SUMMARY:Fim da fidelização: Internet\\, NOS',
        'URL:https://app.example/app/contratos/c1',
        'TRIGGER:-P29DT15H',
        'END:VCALENDAR',
      ]),
    );
    expect(lines.filter((line) => line === 'BEGIN:VALARM')).toHaveLength(1);
  });

  it('crosses month and year ends for the end date', () => {
    const ics = toICalendar(
      [{ uid: 'u', date: '2026-12-31', summary: 's', remindDaysBefore: [], reminder: 'r' }],
      'c',
      '2026-10-14T00:00:00Z',
    );
    expect(ics).toContain('DTEND;VALUE=DATE:20270101');
    expect(ics).not.toContain('VALARM');
  });

  it('ends an event over several days the day after its last day', () => {
    const ics = toICalendar(
      [
        {
          uid: 'u',
          date: '2026-10-28',
          endDate: '2026-10-31',
          summary: 's',
          remindDaysBefore: [],
          reminder: 'r',
        },
      ],
      'c',
      '2026-10-14T00:00:00Z',
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20261028');
    expect(ics).toContain('DTEND;VALUE=DATE:20261101');
  });
});
