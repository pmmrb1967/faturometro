import type { Repositories } from '../../db/repositories';
import { calendarEvents, toICalendar, type CalendarEntry } from '../../domain/calendar';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { today } from '../alerts/refresh';
import { getSettings } from '../settings/settings';

const copy = t.contracts.calendar;

/** Builds the .ics file from the stored contracts and invoices; null when there are no dates. */
export async function buildCalendarFile(
  repos: Repositories,
  origin: string,
  date = today(),
  now = new Date().toISOString(),
): Promise<{ ics: string; count: number } | null> {
  const [contracts, invoices, providers, settings] = await Promise.all([
    repos.contracts.list(),
    repos.invoices.list(),
    repos.providers.list(),
    getSettings(repos),
  ]);
  const providerName = new Map(providers.map((provider) => [provider.id, provider.name]));
  const events = calendarEvents({
    contracts,
    invoices,
    loyaltyAlertDays: settings.loyaltyAlertDays,
    today: date,
  });
  if (events.length === 0) return null;

  const entries = events.map((event): CalendarEntry => {
    const name = copy.name(event.contract.label, providerName.get(event.contract.providerId) ?? '');
    const url = `${origin}/app/contratos/${event.contract.id}`;
    const base = {
      uid: event.uid,
      date: event.date,
      url,
      remindDaysBefore: event.remindDaysBefore,
    };
    if (event.kind === 'renewal') {
      return {
        ...base,
        summary: copy.renewalSummary(name),
        description: copy.renewalDescription,
        reminder: copy.renewalReminder(name),
      };
    }
    if (event.kind === 'loyalty_end' || !event.invoice) {
      return {
        ...base,
        summary: copy.loyaltySummary(name),
        description: copy.loyaltyDescription,
        reminder: copy.loyaltyReminder(name),
      };
    }
    const amount = formatCents(event.invoice.totalCents);
    return {
      ...base,
      summary: copy.paymentSummary(name, amount),
      description: copy.paymentDescription(formatIsoDate(event.invoice.issueDate)),
      reminder: copy.paymentReminder(name, amount),
    };
  });
  return { ics: toICalendar(entries, copy.calendarName, now), count: entries.length };
}
