/** Shared domain types (PLAN.md section 7). Money in integer cents; dates as ISO YYYY-MM-DD. */
import type { Cents } from '../lib/money';

export type Sector = 'telecom' | 'electricity' | 'gas' | 'water' | 'other';
export type Confidence = 'high' | 'low';
export type Source = 'qr' | 'parser' | 'ai' | 'manual';
export type IsoDate = string;
export type IsoDateTime = string;

/** Present on every stored record, for the optional sync. */
export interface SyncMeta {
  id: string;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime;
}

export interface Provider extends SyncMeta {
  /** Field A of the fiscal QR code. */
  nif: string;
  name: string;
  sectors: Sector[];
  parserId?: string;
}

export interface Contract extends SyncMeta {
  providerId: string;
  sector: Sector;
  label: string;
  customerNumber?: string;
  /** CPE (electricity) or CUI (gas). */
  supplyPointId?: string;
  tariffName?: string;
  loyaltyEndDate?: IsoDate;
  electricity?: {
    powerKva: number;
    cycle: 'simple' | 'bi' | 'tri';
    cycleType?: 'daily' | 'weekly';
    socialTariff: boolean;
  };
  active: boolean;
  createdAt: IsoDateTime;
}

export interface Invoice extends SyncMeta {
  contractId: string;
  providerId: string;
  fileHash: string;
  /** SHA-256 of issuer NIF + field G: deduplication without storing the number in clear. */
  docKey?: string;
  docType: string;
  /** Field G of the QR code. */
  docId?: string;
  atcud?: string;
  issueDate: IsoDate;
  periodStart?: IsoDate;
  periodEnd?: IsoDate;
  dueDate?: IsoDate;
  totalCents: Cents;
  vatCents?: Cents;
  qrStatus: 'ok' | 'missing' | 'invalid';
  validation: 'passed' | 'failed' | 'not_checked';
  sources: Partial<Record<string, Source>>;
  confidence: Partial<Record<string, Confidence>>;
  parserId?: string;
  parserVersion?: string;
  createdAt: IsoDateTime;
}

export type ConsumptionPeriod = 'empty' | 'off_empty' | 'full' | 'peak';

export interface InvoiceLine extends SyncMeta {
  invoiceId: string;
  kind:
    | 'base_fee'
    | 'addon'
    | 'equipment'
    | 'discount'
    | 'usage'
    | 'energy'
    | 'power'
    | 'tax'
    | 'other';
  description: string;
  amountCents: Cents;
  quantity?: number;
  unit?: 'kWh' | 'm3' | 'day' | 'month' | 'min' | 'GB';
  /** €/unit with up to 6 decimal places, kept as a decimal string to avoid float drift. */
  unitPrice?: string;
  period?: ConsumptionPeriod;
}

export interface Reading extends SyncMeta {
  invoiceId: string;
  contractId: string;
  period?: ConsumptionPeriod;
  quantity: number;
  unit: 'kWh' | 'm3';
  readingType: 'real' | 'estimated' | 'customer';
  dateFrom: IsoDate;
  dateTo: IsoDate;
}

export interface Alert extends SyncMeta {
  contractId: string;
  kind:
    | 'loyalty_ending'
    | 'price_increase'
    | 'estimated_readings'
    | 'missing_invoice'
    | 'cheaper_offer';
  severity: 'info' | 'warning';
  message: string;
  data?: Record<string, unknown>;
  createdAt: IsoDateTime;
  dismissedAt?: IsoDateTime;
}

export interface FieldCorrection extends SyncMeta {
  invoiceId: string;
  field: string;
  extracted: unknown;
  corrected: unknown;
  source: Source;
  createdAt: IsoDateTime;
}

/** One AI request, kept on this device only (PLAN.md §10: tokens per call, locally). */
export interface AiUsageRecord extends SyncMeta {
  createdAt: IsoDateTime;
  task: 'extract' | 'explain' | 'letter' | 'test';
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  /** Millionths of a US dollar (integer), from the list prices in src/ai/models.ts. */
  costMicroUsd: number;
}

export interface Settings extends SyncMeta {
  id: 'settings';
  aiProvider?: 'anthropic';
  aiApiKey?: string;
  aiModel?: string;
  aiAutoSend: boolean;
  /** Holder's NIF, tried first to open password-protected PDFs. */
  ownNif?: string;
  keepOriginalFiles: boolean;
  priceIncreaseThresholdPct: number;
  loyaltyAlertDays: number[];
  autoLockMinutes: number;
  /** Large family (5+ people): reduced VAT on up to 300 kWh per 30 days. */
  largeFamily: boolean;
  /** Minimum estimated yearly saving for a "cheaper offer" alert (PLAN.md §9). */
  cheaperOfferMinSavingCents: number;
}
