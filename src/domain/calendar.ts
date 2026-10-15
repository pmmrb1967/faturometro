/**
 * Calendar export (.ics, RFC 5545): the end of each loyalty period and the
 * payment due dates still ahead, as all-day events with reminders. Built on the
 * device and downloaded by the user; the app never sends it anywhere.
 * Pure: the texts come from the caller (i18n lives outside the domain).
 */
import { daysBetween } from './alerts';
import { insuranceRenewalDate } from './insurance';
import type { Contract, Invoice } from './types';

/** Reminders before a payment due date, in days. */
export const PAYMENT_REMINDER_DAYS = [3];
/** Reminders fire at this local hour. */
const REMINDER_HOUR = 9;

export type CalendarEventKind = 'loyalty_end' | 'payment_due' | 'renewal';

export interface CalendarEvent {
  /** Stable across exports, so importing again updates the event. */
  uid: string;
  kind: CalendarEventKind;
  /** ISO date of the all-day event. */
  date: string;
  /** Days before the event when a reminder fires (only those still ahead). */
  remindDaysBefore: number[];
  contract: Contract;
  invoice?: Invoice;
}

export interface CalendarInput {
  contracts: Contract[];
  invoices: Invoice[];
  /** Same thresholds as the loyalty alerts (Settings.loyaltyAlertDays). */
  loyaltyAlertDays: number[];
  /** ISO date. */
  today: string;
}

const UID_DOMAIN = 'faturometro';

function remindersAhead(days: number[], date: string, today: string): number[] {
  const left = daysBetween(today, date);
  return [...new Set(days)].filter((day) => day >= 0 && day <= left).sort((a, b) => b - a);
}

/** Events from today on, sorted by date: loyalty ends of active contracts and due dates. */
export function calendarEvents(input: CalendarInput): CalendarEvent[] {
  const active = input.contracts.filter((contract) => contract.active);
  const contractById = new Map(active.map((contract) => [contract.id, contract]));
  const events: CalendarEvent[] = [];

  for (const contract of active) {
    const date = contract.loyaltyEndDate;
    if (!date || date < input.today) continue;
    events.push({
      uid: `loyalty-${contract.id}@${UID_DOMAIN}`,
      kind: 'loyalty_end',
      date,
      remindDaysBefore: remindersAhead(input.loyaltyAlertDays, date, input.today),
      contract,
    });
  }

  for (const contract of active.filter((candidate) => candidate.sector === 'insurance')) {
    const date = insuranceRenewalDate(
      contract,
      input.invoices.filter((invoice) => invoice.contractId === contract.id),
    );
    if (!date) continue;
    if (date < input.today) continue;
    events.push({
      uid: `renewal-${contract.id}@${UID_DOMAIN}`,
      kind: 'renewal',
      date,
      remindDaysBefore: remindersAhead(input.loyaltyAlertDays, date, input.today),
      contract,
    });
  }

  for (const invoice of input.invoices) {
    const contract = contractById.get(invoice.contractId);
    const date = invoice.dueDate;
    if (!contract || !date || date < input.today) continue;
    events.push({
      uid: `payment-${invoice.id}@${UID_DOMAIN}`,
      kind: 'payment_due',
      date,
      remindDaysBefore: remindersAhead(PAYMENT_REMINDER_DAYS, date, input.today),
      contract,
      invoice,
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}

export interface CalendarEntry {
  uid: string;
  date: string;
  summary: string;
  description?: string;
  url?: string;
  remindDaysBefore: number[];
  /** Text of the reminder notification. */
  reminder: string;
}

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Folds a content line at 75 octets without splitting a character (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Continuation lines start with a space, which counts towards their 75 octets.
    const limit = parts.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function basicDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Trigger for a reminder `days` before an all-day event, at REMINDER_HOUR local time. */
export function reminderTrigger(days: number): string {
  if (days === 0) return `PT${REMINDER_HOUR}H`;
  const hoursBack = 24 - REMINDER_HOUR;
  return days === 1 ? `-PT${hoursBack}H` : `-P${days - 1}DT${hoursBack}H`;
}

/** The whole .ics file, with CRLF line endings. `now` is an ISO date-time (DTSTAMP). */
export function toICalendar(entries: CalendarEntry[], calendarName: string, now: string): string {
  const stamp = now.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Faturometro//Calendario//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  for (const entry of entries) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${entry.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${basicDate(entry.date)}`,
      `DTEND;VALUE=DATE:${basicDate(nextDay(entry.date))}`,
      `SUMMARY:${escapeText(entry.summary)}`,
    );
    if (entry.description) lines.push(`DESCRIPTION:${escapeText(entry.description)}`);
    if (entry.url) lines.push(`URL:${entry.url}`);
    lines.push('TRANSP:TRANSPARENT');
    for (const days of entry.remindDaysBefore) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(entry.reminder)}`,
        `TRIGGER:${reminderTrigger(days)}`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
