/** Shared domain types (PLAN.md section 7). Money in integer cents; dates as ISO YYYY-MM-DD. */
import type { Cents } from '../lib/money';

export type Sector = 'telecom' | 'electricity' | 'gas' | 'water' | 'insurance' | 'other';
export type Confidence = 'high' | 'low';
export type Source = 'qr' | 'parser' | 'ai' | 'manual';
export type IsoDate = string;
export type IsoDateTime = string;
/** Services of a telecom contract, in this display order. */
export const TELECOM_SERVICES = ['internet', 'tv', 'landline', 'mobile'] as const;
export type TelecomService = (typeof TELECOM_SERVICES)[number];

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

/** What an insurance policy covers, as printed on its receipts (the newest one wins). */
export interface InsuranceDetails {
  /** Product and option ("Automóvel Ligeiros", "Mais"). */
  product?: string;
  option?: string;
  policyNumber?: string;
  /** What is insured ("FORD Kuga Diesel", "Recheio e imóvel"). */
  insuredObject?: string;
  /** Insured capitals ("Imóvel" 285 149,24 €). */
  capitals?: { name: string; capitalCents: Cents }[];
  /** From the renewal letter: what the next year will cost, before it is paid. */
  renewal?: InsuranceRenewal;
  /** From the particular conditions: every coverage, its capital and deductible. */
  coverages?: InsuranceCoverage[];
  annualPremiumCents?: Cents;
  /** How many people the policy covers (health insurance); names are never kept. */
  insuredPersons?: number;
  /** When the contract started: it renews every year on this day. */
  startDate?: IsoDate;
  /** Car insurance bonus/malus index, in percent. */
  bonusMalusPct?: number;
}

export interface InsuranceRenewal {
  date: IsoDate;
  currentCents: Cents;
  nextCents: Cents;
  /** What the insurer says changed the premium ("Inflação de mercado" 6,9 %). */
  factors?: { name: string; pct: number }[];
  /** Insured capitals now and next year. */
  capitals?: { name: string; currentCents: Cents; nextCents: Cents }[];
}

export interface InsuranceCoverage {
  name: string;
  /** As printed ("6 450 000,00 €", "Conforme Cond. Gerais e/ou Especiais"). */
  capital?: string;
  capitalCents?: Cents;
  deductible?: string;
  /** Health insurance: share paid in the insurer's network ("Seguradora 100 % · cliente 0 %"). */
  network?: string;
  /** Health insurance: share paid by reimbursement, outside the network. */
  reimbursement?: string;
  /** Waiting period before the coverage applies ("180 dias"). */
  waitingPeriod?: string;
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
  /** Monthly price with VAT the user says was contracted (fixed-price sectors), entered by hand. */
  monthlyPriceCents?: Cents;
  electricity?: {
    powerKva: number;
    cycle: 'simple' | 'bi' | 'tri';
    cycleType?: 'daily' | 'weekly';
    socialTariff: boolean;
  };
  gas?: {
    /** Consumption tier (escalão 1–4), from the invoice or chosen by the user. */
    escalao?: 1 | 2 | 3 | 4;
    /** Distribution operator: ERSE ORD code, or 'unknown'. Chosen by the user. */
    distributor?: string;
  };
  insurance?: InsuranceDetails;
  telecom?: {
    services: TelecomService[];
    /** Read from an invoice and not yet confirmed by the user. */
    fromInvoice?: boolean;
  };
  active: boolean;
  /** Date the user changed supplier (the contract ended). */
  endedAt?: IsoDate;
  /** The contract that replaced this one (same sector, new supplier). */
  replacedById?: string;
  createdAt: IsoDateTime;
}

/** First and last day to send a meter reading (both included). */
export interface ReadingWindow {
  start: IsoDate;
  end: IsoDate;
}

/** One kind of telecom usage outside the package ("Tráfego de dados em roaming"). */
export interface ExtraUsage {
  description: string;
  /** Without VAT, rounded to the cent. */
  amountCents: Cents;
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
  /** Days to send the next meter reading, as printed on the invoice. */
  readingWindow?: ReadingWindow;
  /** Telecom usage billed outside the package, without VAT (only the non-zero ones). */
  extraUsage?: ExtraUsage[];
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
    | 'cheaper_offer'
    | 'invoice_audit'
    | 'renewal'
    | 'premium_notice'
    | 'meter_reading';
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
