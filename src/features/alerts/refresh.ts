import type { Repositories } from '../../db/repositories';
import { computeAlerts, type AlertDraft } from '../../domain/alerts';
import type { Alert, Contract } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { getSettings } from '../settings/settings';

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Text shown to the user (also stored in the alert, as PLAN.md §7 expects). */
export function alertMessage(alert: Pick<Alert, 'kind' | 'data'>, contract?: Contract): string {
  const copy = t.alerts.messages;
  const label = contract?.label ?? '';
  const data = alert.data ?? {};
  const number = (key: string) => Number(data[key] ?? 0);
  const text = (key: string) => String(data[key] ?? '');
  switch (alert.kind) {
    case 'loyalty_ending':
      return copy.loyaltyEnding(label, formatIsoDate(text('endDate')), number('daysLeft'));
    case 'price_increase': {
      const pct = number('increasePct').toFixed(1).replace('.', ',');
      if (text('reason') === 'unit_price') return copy.unitPriceIncrease(label, pct);
      if (text('reason') === 'premium') {
        return copy.premiumIncrease(
          label,
          formatCents(number('before')),
          formatCents(number('after')),
          pct,
        );
      }
      const before = formatCents(number('before'));
      const after = formatCents(number('after'));
      return text('reason') === 'base_fee'
        ? copy.baseFeeIncrease(label, before, after)
        : copy.totalIncrease(label, before, after, pct);
    }
    case 'estimated_readings':
      return copy.estimatedReadings(label, number('count'));
    case 'old_charges':
      return copy.oldCharges(
        label,
        formatIsoDate(text('issueDate')),
        formatIsoDate(text('periodStart')),
        formatIsoDate(text('oldUntil')),
      );
    case 'payment_due':
      return copy.paymentDue(
        label,
        formatCents(number('totalCents')),
        formatIsoDate(text('dueDate')),
        number('daysLeft'),
      );
    case 'social_tariff_lost':
      return copy.socialTariffLost(
        label,
        formatIsoDate(text('issueDate')),
        formatIsoDate(text('previousIssueDate')),
        formatCents(number('previousDiscountCents')),
      );
    case 'meter_reading':
      return copy.meterReading(label, formatIsoDate(text('start')), formatIsoDate(text('end')));
    case 'missing_invoice':
      return data.expectedIssueDate
        ? copy.missingUsual(
            label,
            formatIsoDate(text('expectedIssueDate')),
            data.expectedDueDate ? formatIsoDate(text('expectedDueDate')) : undefined,
          )
        : copy.missingInvoice(label, formatIsoDate(text('lastIssueDate')), number('days'));
    case 'cheaper_offer':
      return copy.cheaperOffer(label, formatCents(number('savingCents')));
    case 'premium_notice':
      return copy.premiumNotice(
        label,
        formatIsoDate(text('date')),
        formatCents(number('before')),
        formatCents(number('after')),
        number('increasePct').toFixed(1).replace('.', ','),
      );
    case 'renewal':
      return copy.renewal(label, formatIsoDate(text('date')), number('daysLeft'));
    case 'invoice_audit': {
      const kinds = Array.isArray(data.kinds) ? data.kinds.map(String) : [];
      const parts = kinds.map((kind) => copy.auditParts[kind]).filter(Boolean) as string[];
      return copy.invoiceAudit(label, formatIsoDate(text('issueDate')), parts);
    }
  }
}

/**
 * Recomputes alerts: new situations are added, alerts no longer true are
 * removed, and dismissed alerts are kept (so they do not come back).
 */
export async function refreshAlerts(repos: Repositories, date = today()): Promise<void> {
  const [contracts, invoices, lines, readings, payments, settings, existing] = await Promise.all([
    repos.contracts.list(),
    repos.invoices.list(),
    repos.invoiceLines.list(),
    repos.readings.list(),
    repos.payments.list(),
    getSettings(repos),
    repos.alerts.list(),
  ]);
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const drafts = computeAlerts({
    contracts,
    invoices,
    lines,
    readings,
    payments,
    settings,
    today: date,
  });
  const wanted = new Map(drafts.map((draft) => [draft.key, draft]));
  const current = new Map(existing.map((alert) => [alert.id, alert]));

  for (const [key, draft] of wanted) {
    const before = current.get(key);
    if (before?.dismissedAt) continue;
    await repos.alerts.put(toAlert(draft, contractById.get(draft.contractId), before?.createdAt));
  }
  for (const alert of existing) {
    // Comparator alerts are managed by the comparator.
    if (!wanted.has(alert.id) && !alert.dismissedAt && alert.kind !== 'cheaper_offer') {
      await repos.alerts.remove(alert.id);
    }
  }
}

function toAlert(
  draft: AlertDraft,
  contract: Contract | undefined,
  createdAt?: string,
): Omit<Alert, 'updatedAt'> {
  const { key, ...rest } = draft;
  return {
    ...rest,
    id: key,
    message: alertMessage(draft, contract),
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

export async function dismissAlert(repos: Repositories, id: string): Promise<void> {
  const alert = await repos.alerts.get(id);
  if (alert) await repos.alerts.put({ ...alert, dismissedAt: new Date().toISOString() });
}
