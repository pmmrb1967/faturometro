/**
 * Letters without AI (CLAUDE.md rule 4): templates filled locally with the
 * contract's data. Facts only from what the app stores; no laws, deadlines or
 * rights are claimed. Whatever the app does not know stays as a [PLACEHOLDER].
 */
import type { Repositories } from '../../db/repositories';
import { monthlyAverage } from '../../domain/comescolha';
import { oldCharges, prescriptionApplies } from '../../domain/prescription';
import type { Contract, Sector } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { formatCents, type Cents } from '../../lib/money';
import { findingText, latestAudit } from '../contracts/audit-view';
import { getSettings } from '../settings/settings';

const copy = t.contracts.letters;

export const LETTER_KINDS = [
  'renegotiate',
  'price_increase',
  'estimated_reading',
  'block_extras',
  'prescription',
  'cancel',
] as const;
export type LetterKind = (typeof LETTER_KINDS)[number];

const METERED: readonly Sector[] = ['electricity', 'gas', 'water'];

/** Letters that make sense for this contract (estimated readings only with a meter). */
export function letterKinds(contract: Pick<Contract, 'sector'>): LetterKind[] {
  return LETTER_KINDS.filter((kind) => {
    if (kind === 'estimated_reading') return METERED.includes(contract.sector);
    if (kind === 'block_extras') return contract.sector === 'telecom';
    if (kind === 'prescription') return prescriptionApplies(contract.sector);
    return true;
  });
}

export interface LetterData {
  providerName: string;
  contract: Pick<
    Contract,
    'sector' | 'customerNumber' | 'supplyPointId' | 'tariffName' | 'loyaltyEndDate'
  >;
  ownNif?: string;
  average?: { cents: Cents; count: number };
  latestInvoice?: { issueDate: string; totalCents: Cents };
  /** From the latest price-increase alert. */
  increase?: {
    issueDate: string;
    totalCents: Cents;
    reason: string;
    before: number;
    after: number;
    increasePct: number;
  };
  /** From the estimated-readings alert. */
  estimatedCount?: number;
  /** What changed in the latest invoice (audit), one sentence each. */
  auditDetails?: string[];
  /** From the cheaper-offer alert. */
  cheaperOffer?: { name: string; yearlySavingCents: Cents };
  /** The newest invoice that bills services from more than six months before it. */
  oldCharges?: {
    docId?: string;
    issueDate: string;
    totalCents: Cents;
    periodStart: string;
    periodEnd: string;
    oldUntil: string;
  };
  /** Usage outside the package on the latest invoice (telecom). */
  extraUsage?: { issueDate: string; items: { description: string; amountCents: Cents }[] };
}

function paragraphs(...items: (string | false | undefined)[]): string {
  return items.filter(Boolean).join(' ');
}

function increaseText(data: LetterData): string {
  const increase = data.increase;
  const latest = data.latestInvoice;
  if (!increase) {
    return latest
      ? copy.increaseUnknown(formatIsoDate(latest.issueDate), formatCents(latest.totalCents))
      : copy.increaseUnknown(copy.placeholders.date, copy.placeholders.amount);
  }
  const date = formatIsoDate(increase.issueDate);
  switch (increase.reason) {
    case 'base_fee':
      return copy.increaseBaseFee(date, formatCents(increase.before), formatCents(increase.after));
    case 'total':
      return copy.increaseTotal(date, formatCents(increase.before), formatCents(increase.after));
    case 'unit_price':
      return copy.increaseUnitPrice(date, increase.increasePct.toFixed(1).replace('.', ','));
    default:
      return copy.increaseUnknown(date, formatCents(increase.totalCents));
  }
}

function loyaltyText(data: LetterData, today: string): string | undefined {
  const end = data.contract.loyaltyEndDate;
  if (!end) return undefined;
  return end < today ? copy.loyaltyEnded(formatIsoDate(end)) : copy.loyaltyEnds(formatIsoDate(end));
}

function bodyOf(kind: LetterKind, data: LetterData, today: string): string[] {
  const service = copy.services[data.contract.sector];
  const latest = data.latestInvoice;
  switch (kind) {
    case 'renegotiate':
      return [
        paragraphs(
          copy.client(service, data.contract.tariffName),
          data.average && copy.average(formatCents(data.average.cents), data.average.count),
          loyaltyText(data, today),
        ),
        ...(data.cheaperOffer
          ? [
              copy.cheaperOffer(
                data.cheaperOffer.name,
                formatCents(data.cheaperOffer.yearlySavingCents),
              ),
            ]
          : []),
        copy.renegotiateAsk,
        copy.renegotiateElse,
      ];
    case 'price_increase':
      return [
        paragraphs(copy.client(service, data.contract.tariffName), increaseText(data)),
        ...(data.auditDetails?.length
          ? [[copy.auditDetails, ...data.auditDetails.map((line) => `- ${line}`)].join('\n')]
          : []),
        paragraphs(copy.increaseAsk, loyaltyText(data, today)),
      ];
    case 'estimated_reading':
      return [
        paragraphs(
          data.estimatedCount ? copy.estimatedCount(data.estimatedCount) : copy.estimatedSome,
          latest &&
            copy.estimatedLatest(formatIsoDate(latest.issueDate), formatCents(latest.totalCents)),
        ),
        copy.estimatedAsk,
      ];
    case 'block_extras':
      return [
        copy.client(service, data.contract.tariffName),
        ...(data.extraUsage
          ? [
              [
                copy.extraUsage(formatIsoDate(data.extraUsage.issueDate)),
                ...data.extraUsage.items.map(
                  (item) =>
                    `- ${copy.extraUsageItem(item.description, formatCents(item.amountCents))}`,
                ),
              ].join('\n'),
            ]
          : []),
        copy.blockAsk,
      ];
    case 'prescription': {
      const old = data.oldCharges;
      return [
        old
          ? copy.prescriptionInvoice(
              old.docId ?? copy.placeholders.invoiceNumber,
              formatIsoDate(old.issueDate),
              formatCents(old.totalCents),
              formatIsoDate(old.periodStart),
              formatIsoDate(old.periodEnd),
            )
          : copy.prescriptionInvoice(
              copy.placeholders.invoiceNumber,
              copy.placeholders.date,
              copy.placeholders.amount,
              copy.placeholders.date,
              copy.placeholders.date,
            ),
        copy.prescriptionInvoke(
          old ? formatIsoDate(old.periodStart) : copy.placeholders.date,
          old ? formatIsoDate(old.oldUntil) : copy.placeholders.date,
        ),
        copy.prescriptionAsk,
      ];
    }
    case 'cancel':
      return [
        paragraphs(copy.cancelStatement(service), loyaltyText(data, today)),
        copy.cancelAsk(data.contract.sector === 'telecom'),
      ];
  }
}

/** The letter's subject and full text (header, reference, body, closing). */
export function buildLetter(
  kind: LetterKind,
  data: LetterData,
  today: string,
): { subject: string; text: string } {
  const subject = copy.subjects[kind];
  const supplyPoint = METERED.includes(data.contract.sector)
    ? data.contract.supplyPointId
    : undefined;
  const text = [
    copy.header(data.ownNif ?? copy.placeholders.nif, data.providerName, formatIsoDate(today)),
    copy.subjectLine(subject),
    copy.reference(data.contract.customerNumber ?? copy.placeholders.customerNumber, supplyPoint),
    copy.greeting,
    ...bodyOf(kind, data, today),
    copy.closing,
  ].join('\n\n');
  return { subject, text };
}

/** Gathers what the letters use from the stored contract, invoices, alerts and settings. */
export async function loadLetterData(repos: Repositories, contract: Contract): Promise<LetterData> {
  const [provider, invoices, alerts, settings, audit] = await Promise.all([
    repos.providers.get(contract.providerId),
    repos.invoices.findBy('contractId', contract.id),
    repos.alerts.list(),
    getSettings(repos),
    latestAudit(repos, contract),
  ]);
  const auditDetails = audit?.audit.findings.map(findingText) ?? [];
  invoices.sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  const own = alerts
    .filter((alert) => alert.contractId === contract.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latestOf = (kind: string) => own.find((alert) => alert.kind === kind)?.data;

  const increaseData = latestOf('price_increase');
  const increaseInvoice = invoices.find((invoice) => invoice.id === increaseData?.invoiceId);
  const estimated = latestOf('estimated_readings');
  const offer = latestOf('cheaper_offer');
  const average = monthlyAverage(invoices);
  const latest = invoices[0];
  const extraUsage = latest?.extraUsage?.filter((item) => item.amountCents > 0) ?? [];
  // Invoices are sorted newest first.
  const withOld = invoices.find((invoice) => oldCharges(invoice));
  const old = withOld ? oldCharges(withOld) : null;

  return {
    providerName: provider?.name ?? '',
    contract,
    ...(settings.ownNif ? { ownNif: settings.ownNif } : {}),
    ...(auditDetails.length > 0 ? { auditDetails } : {}),
    ...(average ? { average } : {}),
    ...(latest
      ? { latestInvoice: { issueDate: latest.issueDate, totalCents: latest.totalCents } }
      : {}),
    ...(withOld && old
      ? {
          oldCharges: {
            ...(withOld.docId ? { docId: withOld.docId } : {}),
            issueDate: old.issueDate,
            totalCents: withOld.totalCents,
            periodStart: old.periodStart,
            periodEnd: old.periodEnd,
            oldUntil: old.oldUntil,
          },
        }
      : {}),
    ...(latest && extraUsage.length > 0
      ? { extraUsage: { issueDate: latest.issueDate, items: extraUsage } }
      : {}),
    ...(increaseData && increaseInvoice
      ? {
          increase: {
            issueDate: increaseInvoice.issueDate,
            totalCents: increaseInvoice.totalCents,
            reason: String(increaseData.reason ?? ''),
            before: Number(increaseData.before ?? 0),
            after: Number(increaseData.after ?? 0),
            increasePct: Number(increaseData.increasePct ?? 0),
          },
        }
      : {}),
    ...(estimated && typeof estimated.count === 'number'
      ? { estimatedCount: estimated.count }
      : {}),
    ...(offer && typeof offer.savingCents === 'number'
      ? {
          cheaperOffer: {
            name: `${String(offer.supplier ?? '')} — ${String(offer.offerName ?? '')}`,
            yearlySavingCents: offer.savingCents,
          },
        }
      : {}),
  };
}
