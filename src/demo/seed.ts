/**
 * Example data of the demonstration: about 14 months of a household, made
 * up here (nothing comes from a real invoice). Suppliers, NIFs and line
 * layouts follow the parsers and their synthetic fixtures; dates count back
 * from today, so the alerts (loyalty ending, a price rise, a renewal, a
 * warranty) are always there. Amounts come from a fixed seed: the same each time.
 */
import type { Repositories } from '../db/repositories';
import { addMonthsTo, lastDay, monthOf, paymentId } from '../domain/month';
import type {
  CategoryId,
  Contract,
  CustomCategoryId,
  Income,
  Invoice,
  RecurringExpense,
  SpendingTransaction,
} from '../domain/types';
import { addMonthsToDate, PRESUMPTION_MONTHS, WARRANTY_MONTHS } from '../domain/warranty';
import { refreshAlerts, today as todayIso } from '../features/alerts/refresh';
import { ensureProvider, saveInvoice, type InvoiceDraft } from '../features/invoices/save';
import { updateSettings } from '../features/settings/settings';
import { sha256Hex } from '../lib/crypto';
import type { Cents } from '../lib/money';
import { aguasPortoParser } from '../parsers/aguas-porto';
import { fidelidadeParser } from '../parsers/fidelidade';
import { generaliParser } from '../parsers/generali';
import { meoParser } from '../parsers/meo';
import { repsolParser } from '../parsers/repsol';
import type { Parser, ExtractedLine, ExtractedReading } from '../parsers/types';
import { viaVerdeParser } from '../parsers/via-verde';
import { demoPdf } from './demo-pdf';

/** Months of history before the current one. */
export const DEMO_MONTHS = 13;
/** The telecom loyalty ends this many days from today (inside the 30-day alert). */
export const DEMO_LOYALTY_DAYS = 25;
/** The home insurance renews this many days from today (inside the 60-day alert). */
export const DEMO_RENEWAL_DAYS = 40;

const VAT_PCT = 23;
/** Water bills are taxed at the reduced rate (Águas do Porto fixture). */
const WATER_VAT_PCT = 6;
const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function dayOf(month: string, day: number): string {
  return `${month}-${String(Math.min(day, lastDay(month))).padStart(2, '0')}`;
}

function withVat(net: Cents, pct: number): { vatCents: Cents; totalCents: Cents } {
  const vatCents = Math.round((net * pct) / 100);
  return { vatCents, totalCents: net + vatCents };
}

function sum(lines: readonly ExtractedLine[]): Cents {
  return lines.reduce((total, line) => total + line.amountCents, 0);
}

/** Cents of `quantity` at a price in millionths of a euro (integers only). */
function priced(quantity: number, microEuros: number): Cents {
  return Math.round((quantity * microEuros) / 10_000);
}

/** "0.105000" for 105 000 µ€: the decimal string the lines keep. */
function priceText(microEuros: number): string {
  return (microEuros / 1_000_000).toFixed(6);
}

/** Deterministic pseudo-random numbers (mulberry32), so the demo looks the same each time. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function nifOf(parser: Parser): string {
  const nif = parser.issuerNifs[0];
  if (!nif) throw new Error(`Parser ${parser.id} has no NIF`);
  return nif;
}

interface Context {
  repos: Repositories;
  today: string;
  /** YYYY-MM of today. */
  month: string;
  random: () => number;
  docNumber: number;
}

/** The months of the demo, oldest first, up to the current one. */
function months(ctx: Context): string[] {
  return Array.from({ length: DEMO_MONTHS + 1 }, (_, index) =>
    addMonthsTo(ctx.month, index - DEMO_MONTHS),
  );
}

function between(ctx: Context, min: Cents, max: Cents): Cents {
  return Math.round(min + ctx.random() * (max - min));
}

async function addContract(
  ctx: Context,
  parser: Parser,
  contract: Omit<Contract, 'id' | 'updatedAt' | 'providerId' | 'active' | 'createdAt'>,
  providerNif = nifOf(parser),
  providerName = parser.name,
): Promise<Contract> {
  const provider = await ensureProvider(ctx.repos, providerNif, providerName, contract.sector);
  return ctx.repos.contracts.put({
    ...contract,
    id: crypto.randomUUID(),
    providerId: provider.id,
    active: true,
    createdAt: new Date().toISOString(),
  });
}

type DemoInvoice = Pick<
  InvoiceDraft,
  | 'issueDate'
  | 'periodStart'
  | 'periodEnd'
  | 'dueDate'
  | 'directDebitDate'
  | 'readingWindow'
  | 'extraUsage'
  | 'contractHolder'
> & {
  lines: ExtractedLine[];
  readings?: ExtractedReading[];
  /** VAT on top of the lines, in percent; 0 when the lines already include it (insurance). */
  vatPct: number;
  docType?: string;
  /** Total when the lines are not itemised (tolls). */
  totalCents?: Cents;
};

async function addInvoice(
  ctx: Context,
  contract: Contract,
  parser: Parser,
  invoice: DemoInvoice,
  issuer: { nif: string; name: string } = { nif: nifOf(parser), name: parser.name },
): Promise<Invoice> {
  const net = sum(invoice.lines);
  const totals =
    invoice.totalCents !== undefined
      ? { vatCents: undefined, totalCents: invoice.totalCents }
      : withVat(net, invoice.vatPct);
  ctx.docNumber += 1;
  const docType = invoice.docType ?? 'FT';
  const draft: InvoiceDraft = {
    fileHash: `demo-${crypto.randomUUID()}`,
    issuerNif: issuer.nif,
    providerName: issuer.name,
    sector: contract.sector,
    contract: { id: contract.id },
    docType,
    docId: `${docType} DEMO/${String(ctx.docNumber).padStart(6, '0')}`,
    issueDate: invoice.issueDate,
    totalCents: totals.totalCents,
    ...(totals.vatCents !== undefined ? { vatCents: totals.vatCents } : {}),
    qrStatus: 'ok',
    validation: 'passed',
    sources: { totalCents: 'qr', issueDate: 'qr' },
    lines: invoice.lines,
    readings: invoice.readings ?? [],
    parser: { id: parser.id, version: parser.version },
  };
  const optional = [
    'periodStart',
    'periodEnd',
    'dueDate',
    'directDebitDate',
    'readingWindow',
    'extraUsage',
    'contractHolder',
  ] as const;
  for (const field of optional) {
    if (invoice[field] !== undefined) Object.assign(draft, { [field]: invoice[field] });
  }
  return saveInvoice(ctx.repos, draft, { keepOriginalFile: false });
}

/** Monthly issues on `day`, billing the month before; none after today. */
function monthlyIssues(ctx: Context, day: number) {
  return months(ctx)
    .map((month) => {
      const previous = addMonthsTo(month, -1);
      return {
        month,
        issueDate: dayOf(month, day),
        periodStart: `${previous}-01`,
        periodEnd: dayOf(previous, 31),
        previousMonth: previous,
      };
    })
    .filter((issue) => issue.issueDate <= ctx.today);
}

async function seedTelecom(ctx: Context): Promise<void> {
  const contract = await addContract(ctx, meoParser, {
    sector: 'telecom',
    label: 'Internet, TV e telemóvel',
    customerNumber: '1000000001',
    tariffName: 'Pacote Fibra + TV + Móvel',
    loyaltyEndDate: addDays(ctx.today, DEMO_LOYALTY_DAYS),
    telecom: { services: ['internet', 'tv', 'mobile'] },
  });
  const issues = monthlyIssues(ctx, 5);
  for (const [index, issue] of issues.entries()) {
    // The newest invoice brings the yearly price update: the price rise alert.
    const latest = index === issues.length - 1;
    const roaming = index === issues.length - 4;
    const lines: ExtractedLine[] = [
      {
        kind: 'base_fee',
        description: 'Pacote Fibra + TV + Móvel',
        amountCents: latest ? 4268 : 4065,
      },
      { kind: 'discount', description: 'Desconto Fatura Eletrónica', amountCents: -81 },
    ];
    if (roaming) lines.push({ kind: 'usage', description: 'Roaming', amountCents: 407 });
    const debit = addDays(issue.issueDate, 20);
    await addInvoice(ctx, contract, meoParser, {
      issueDate: issue.issueDate,
      periodStart: issue.periodStart,
      periodEnd: issue.periodEnd,
      dueDate: debit,
      directDebitDate: debit,
      lines,
      vatPct: VAT_PCT,
      ...(roaming ? { extraUsage: [{ description: 'Roaming', amountCents: 407 }] } : {}),
    });
  }
}

/** kWh in each calendar month (January first): more in winter. */
const ELECTRICITY_KWH = [330, 300, 265, 225, 205, 190, 210, 220, 200, 230, 275, 315];
/** m³ of natural gas turned into kWh is on the invoice; here, kWh straight away. */
const GAS_KWH = [620, 560, 470, 340, 240, 160, 130, 130, 170, 290, 430, 560];

async function seedEnergy(ctx: Context): Promise<void> {
  const electricity = await addContract(ctx, repsolParser, {
    sector: 'electricity',
    label: 'Eletricidade',
    customerNumber: '12345 / 001',
    supplyPointId: 'PT0000000000000000XX',
    tariffName: 'Tarifa Bi-horária',
    electricity: { powerKva: 4.6, cycle: 'bi', cycleType: 'daily', socialTariff: false },
  });
  const gas = await addContract(ctx, repsolParser, {
    sector: 'gas',
    label: 'Gás natural',
    customerNumber: '12345 / 002',
    tariffName: 'Tarifa Gás',
    gas: { escalao: 2 },
  });

  for (const issue of monthlyIssues(ctx, 8)) {
    const calendarMonth = Number(issue.previousMonth.slice(5, 7)) - 1;
    const days = lastDay(issue.previousMonth);
    const debit = addDays(issue.issueDate, 20);
    const dates = {
      issueDate: issue.issueDate,
      periodStart: issue.periodStart,
      periodEnd: issue.periodEnd,
      dueDate: debit,
      directDebitDate: debit,
    };

    const kwh = ELECTRICITY_KWH[calendarMonth]! + Math.round((ctx.random() - 0.5) * 30);
    const empty = Math.round(kwh * 0.38);
    const offEmpty = kwh - empty;
    await addInvoice(ctx, electricity, repsolParser, {
      ...dates,
      vatPct: VAT_PCT,
      lines: [
        {
          kind: 'energy',
          description: 'Energia Vazio',
          amountCents: priced(empty, 105_000),
          quantity: empty,
          unit: 'kWh',
          unitPrice: priceText(105_000),
          period: 'empty',
        },
        {
          kind: 'energy',
          description: 'Energia Fora de Vazio',
          amountCents: priced(offEmpty, 185_000),
          quantity: offEmpty,
          unit: 'kWh',
          unitPrice: priceText(185_000),
          period: 'off_empty',
        },
        {
          kind: 'power',
          description: 'Potência Contratada (4.60 kVA)',
          amountCents: priced(days, 310_000),
          quantity: days,
          unit: 'day',
          unitPrice: priceText(310_000),
        },
        {
          kind: 'tax',
          description: 'Contribuição Audiovisual',
          amountCents: 285,
          quantity: 1,
          unit: 'month',
          unitPrice: priceText(2_850_000),
        },
        { kind: 'tax', description: 'Taxa Exploração DGEG (DL-4/93)', amountCents: 7 },
      ],
      readings: [
        {
          quantity: empty,
          unit: 'kWh',
          readingType: 'real',
          dateTo: issue.periodEnd,
          period: 'empty',
        },
        {
          quantity: offEmpty,
          unit: 'kWh',
          readingType: 'real',
          dateTo: issue.periodEnd,
          period: 'off_empty',
        },
      ],
    });

    const gasKwh = GAS_KWH[calendarMonth]! + Math.round((ctx.random() - 0.5) * 40);
    await addInvoice(ctx, gas, repsolParser, {
      ...dates,
      vatPct: VAT_PCT,
      lines: [
        {
          kind: 'energy',
          description: 'Energia Gás Natural',
          amountCents: priced(gasKwh, 82_000),
          quantity: gasKwh,
          unit: 'kWh',
          unitPrice: priceText(82_000),
        },
        {
          kind: 'power',
          description: 'Termo Fixo',
          amountCents: priced(days, 140_000),
          quantity: days,
          unit: 'day',
          unitPrice: priceText(140_000),
        },
      ],
      readings: [{ quantity: gasKwh, unit: 'kWh', readingType: 'real', dateTo: issue.periodEnd }],
    });
  }
}

/** m³ per month; one month with a leak (the spike on the chart). */
async function seedWater(ctx: Context): Promise<void> {
  const contract = await addContract(ctx, aguasPortoParser, {
    sector: 'water',
    label: 'Água',
    customerNumber: '1000000 / 2000000',
    tariffName: 'Doméstico',
  });
  const issues = monthlyIssues(ctx, 5);
  for (const [index, issue] of issues.entries()) {
    const latest = index === issues.length - 1;
    const leak = index === issues.length - 4;
    const m3 = leak ? 15 : 5 + Math.round(ctx.random() * 3);
    const sewage = Math.round(m3 * 9) / 10;
    // Paid by hand (no direct debit): the newest one is due in a few days.
    const dueDate = latest ? addDays(ctx.today, 3) : addDays(issue.issueDate, 20);
    await addInvoice(ctx, contract, aguasPortoParser, {
      issueDate: issue.issueDate,
      periodStart: issue.periodStart,
      periodEnd: issue.periodEnd,
      dueDate,
      vatPct: WATER_VAT_PCT,
      lines: [
        {
          kind: 'usage',
          description: '1 Esc. Consumo Água',
          amountCents: priced(m3, 650_000),
          quantity: m3,
          unit: 'm3',
          unitPrice: priceText(650_000),
          vatRate: WATER_VAT_PCT,
        },
        {
          kind: 'base_fee',
          description: 'Tar. Disponibilidade',
          amountCents: 390,
          quantity: 1,
          unit: 'month',
          unitPrice: priceText(3_900_000),
          vatRate: WATER_VAT_PCT,
        },
        {
          kind: 'usage',
          description: '1 Esc. Saneamento Dom.',
          amountCents: priced(sewage, 550_000),
          quantity: sewage,
          unit: 'm3',
          unitPrice: priceText(550_000),
          vatRate: WATER_VAT_PCT,
        },
        {
          kind: 'tax',
          description: 'Taxa Recursos Hídricos Água',
          amountCents: priced(m3, 40_000),
          quantity: m3,
          unit: 'm3',
          unitPrice: priceText(40_000),
          vatRate: WATER_VAT_PCT,
        },
      ],
      readings: [{ quantity: m3, unit: 'm3', readingType: 'real', dateTo: issue.periodEnd }],
      // The newest invoice says when to send the next reading: soon.
      ...(latest
        ? { readingWindow: { start: addDays(ctx.today, 2), end: addDays(ctx.today, 5) } }
        : {}),
    });
  }
  // Water is paid by hand: earlier invoices are ticked as paid, the newest is not.
  const invoices = (await ctx.repos.invoices.findBy('contractId', contract.id)).sort((a, b) =>
    a.issueDate.localeCompare(b.issueDate),
  );
  for (const invoice of invoices.slice(0, -1)) {
    await ctx.repos.payments.put({
      id: paymentId({ invoiceId: invoice.id }),
      invoiceId: invoice.id,
      paidOn: addDays(invoice.dueDate ?? invoice.issueDate, -2),
    });
  }
}

async function seedInsurance(ctx: Context): Promise<void> {
  // Home: a yearly receipt; the renewal letter says next year costs more.
  const renewal = addDays(ctx.today, DEMO_RENEWAL_DAYS);
  const lastYear = addDays(renewal, -365);
  const capitals = [
    { name: 'Recheio', capitalCents: 2_000_000 },
    { name: 'Imóvel', capitalCents: 15_000_000 },
  ];
  const home = await addContract(ctx, generaliParser, {
    sector: 'insurance',
    label: 'Seguro Multirrisco',
    customerNumber: '1000000001',
    insurance: {
      product: 'CASA',
      option: 'Base',
      policyNumber: '2000000001',
      insuredObject: 'Recheio, Imóvel',
      capitals,
      // Same day of the year as the renewal (a leap year in between must not move it).
      startDate: addMonthsToDate(renewal, -36),
      annualPremiumCents: 33_864,
      renewal: {
        date: renewal,
        currentCents: 33_864,
        nextCents: 35_890,
        capitals: [
          { name: 'Recheio', currentCents: 2_000_000, nextCents: 2_060_000 },
          { name: 'Imóvel', currentCents: 15_000_000, nextCents: 15_450_000 },
        ],
      },
    },
  });
  // Only last year's receipt: an older one would make "Início" compare with a year
  // that has almost no data (the comparison needs invoices from two years back).
  const yearly = [{ start: lastYear, premium: 30_000, stamp: 2_714 }];
  for (const year of yearly) {
    const issueDate = addDays(year.start, -12);
    if (issueDate > ctx.today) continue;
    await addInvoice(ctx, home, generaliParser, {
      issueDate,
      periodStart: year.start,
      periodEnd: addDays(year.start, 364),
      dueDate: year.start,
      directDebitDate: year.start,
      docType: 'FR',
      vatPct: 0,
      lines: [
        { kind: 'base_fee', description: 'Prémio comercial', amountCents: year.premium },
        { kind: 'other', description: 'Custos de gestão do seguro', amountCents: 150 },
        { kind: 'tax', description: 'Imposto de selo', amountCents: year.stamp },
        { kind: 'tax', description: 'Outros encargos e taxas', amountCents: 1_000 },
      ],
    });
  }

  // Health: a receipt each month, paid by direct debit on the 1st.
  const health = await addContract(ctx, fidelidadeParser, {
    sector: 'insurance',
    label: 'Seguro de Saúde',
    customerNumber: '1000000001',
    category: 'health',
    insurance: { product: 'SAÚDE EXEMPLO', policyNumber: '1234567', insuredPersons: 2 },
  });
  for (const month of months(ctx)) {
    const start = `${month}-01`;
    if (start > ctx.today) continue;
    await addInvoice(ctx, health, fidelidadeParser, {
      issueDate: start,
      periodStart: start,
      periodEnd: dayOf(month, 31),
      directDebitDate: start,
      docType: 'FR',
      vatPct: 0,
      lines: [
        { kind: 'base_fee', description: 'Prémio comercial', amountCents: 8_000 },
        { kind: 'tax', description: 'Imposto do selo', amountCents: 400 },
        { kind: 'tax', description: 'INEM', amountCents: 200 },
      ],
    });
  }
}

async function seedTolls(ctx: Context): Promise<void> {
  const contract = await addContract(ctx, viaVerdeParser, {
    sector: 'transport',
    label: 'Via Verde',
    customerNumber: '100000001',
    usageBased: true,
  });
  for (const issue of monthlyIssues(ctx, 28)) {
    // Summer trips cost more.
    const summer = ['07', '08'].includes(issue.previousMonth.slice(5, 7));
    const totalCents = between(ctx, summer ? 3_500 : 900, summer ? 6_800 : 2_900);
    await addInvoice(ctx, contract, viaVerdeParser, {
      issueDate: issue.issueDate,
      periodStart: issue.periodStart,
      periodEnd: issue.periodEnd,
      vatPct: VAT_PCT,
      lines: [],
      totalCents,
    });
  }
}

async function addCategory(ctx: Context, name: string, note: string): Promise<CustomCategoryId> {
  const id: CustomCategoryId = `c-${crypto.randomUUID()}`;
  await ctx.repos.categories.put({ id, name, note, createdAt: new Date().toISOString() });
  return id;
}

async function seedHousehold(ctx: Context): Promise<void> {
  const sport = await addCategory(ctx, 'Desporto', 'Ginásio, equipamento, inscrições');
  const pets = await addCategory(ctx, 'Animais', 'Comida, veterinário, vacinas');
  const holidays = await addCategory(ctx, 'Férias', 'Viagens e alojamento');
  const first = months(ctx)[0]!;
  const createdAt = new Date().toISOString();
  const year = ctx.month.slice(0, 4);

  const expenses: Omit<RecurringExpense, 'id' | 'updatedAt' | 'createdAt'>[] = [
    {
      name: 'Renda da casa',
      amountCents: 75_000,
      // The yearly rent update, in January.
      ...(`${year}-01` > first
        ? { amountChanges: [{ fromMonth: `${year}-01`, amountCents: 76_650 }] }
        : {}),
      everyMonths: 1,
      dueDay: 1,
      startMonth: first,
      category: 'home',
    },
    {
      name: 'Condomínio',
      amountCents: 9_000,
      everyMonths: 3,
      dueDay: 10,
      startMonth: first,
      category: 'home',
    },
    {
      name: 'Ginásio',
      amountCents: 3_500,
      everyMonths: 1,
      dueDay: 8,
      startMonth: first,
      category: sport,
    },
    {
      name: 'Explicações de Matemática',
      amountCents: 8_000,
      everyMonths: 1,
      dueDay: 15,
      startMonth: first,
      category: 'education',
    },
  ];
  for (const expense of expenses) {
    await ctx.repos.expenses.put({
      ...expense,
      id: crypto.randomUUID(),
      // Months already past count as paid; the rest of this month is still to pay.
      paidUntil: ctx.today,
      createdAt,
    });
  }

  const lastNovember = `${year}-11` <= ctx.month ? `${year}-11` : `${Number(year) - 1}-11`;
  const incomes: Omit<Income, 'id' | 'updatedAt' | 'createdAt'>[] = [
    {
      kind: 'salary',
      name: 'Salário',
      amountCents: 165_000,
      everyMonths: 1,
      dueDay: 25,
      startMonth: first,
    },
    {
      kind: 'salary',
      name: 'Salário (2.º titular)',
      amountCents: 142_000,
      everyMonths: 1,
      dueDay: 28,
      startMonth: first,
    },
    {
      kind: 'bonus',
      name: 'Subsídio de Natal',
      amountCents: 165_000,
      everyMonths: 1,
      oneOff: true,
      dueDay: 20,
      startMonth: lastNovember,
      endMonth: lastNovember,
    },
  ];
  for (const income of incomes) {
    await ctx.repos.incomes.put({ ...income, id: crypto.randomUUID(), createdAt });
  }

  // Everyday purchases, a few each month.
  const purchase = async (
    date: string,
    amountCents: Cents,
    category: CategoryId,
    description: string,
    toPay = false,
  ): Promise<SpendingTransaction> =>
    ctx.repos.transactions.put({
      id: crypto.randomUUID(),
      date,
      ...(toPay ? { toPay: true as const } : {}),
      amountCents,
      category,
      description,
      source: 'manual',
      createdAt,
    });
  for (const [index, month] of months(ctx).entries()) {
    const planned: [number, Cents, Cents, CategoryId, string][] = [
      [3, 4_500, 12_000, 'food', 'Supermercado'],
      [10, 4_500, 12_000, 'food', 'Supermercado'],
      [17, 4_500, 12_000, 'food', 'Supermercado'],
      [24, 4_500, 12_000, 'food', 'Supermercado'],
      [6, 4_000, 6_500, 'transport', 'Combustível'],
      [21, 4_000, 6_500, 'transport', 'Combustível'],
      [14, 2_500, 6_000, 'leisure', 'Restaurante'],
    ];
    if (index % 2 === 0) planned.push([19, 800, 3_000, 'health', 'Farmácia']);
    if (index % 4 === 1) planned.push([12, 3_500, 8_000, pets, 'Veterinário']);
    if (index % 3 === 2) planned.push([9, 2_000, 4_500, sport, 'Sapatilhas de corrida']);
    for (const [day, min, max, category, description] of planned) {
      const date = dayOf(month, day);
      const amount = between(ctx, min, max);
      if (date <= ctx.today) await purchase(date, amount, category, description);
    }
  }

  // One-off expenses: a repair, holidays, a car service still to pay.
  const monthsAgo = (count: number, day: number) => dayOf(addMonthsTo(ctx.month, -count), day);
  await purchase(monthsAgo(4, 12), 18_500, 'home', 'Reparação do esquentador');
  const lastAugust = `${year}-08` < ctx.month ? `${year}-08` : `${Number(year) - 1}-08`;
  await purchase(dayOf(lastAugust, 2), 64_000, holidays, 'Alojamento nas férias');
  await purchase(addDays(ctx.today, 12), 24_000, 'transport', 'Revisão do carro', true);

  await seedWarranties(ctx, purchase, monthsAgo);
}

async function seedWarranties(
  ctx: Context,
  purchase: (
    date: string,
    amount: Cents,
    category: CategoryId,
    description: string,
  ) => Promise<SpendingTransaction>,
  monthsAgo: (count: number, day: number) => string,
): Promise<void> {
  const createdAt = new Date().toISOString();

  // Bought seven months ago, with its receipt kept.
  const washerDate = monthsAgo(7, 16);
  const washer = await purchase(washerDate, 42_999, 'shopping', 'Máquina de lavar roupa');
  const bytes = demoPdf([
    'Fatura-recibo (exemplo)',
    'Documento de demonstração do Faturómetro: não é uma fatura verdadeira.',
    '',
    `Data: ${washerDate}`,
    'Máquina de lavar roupa 8 kg',
    'Total: 429,99 €',
  ]);
  const fileHash = await sha256Hex(bytes);
  await ctx.repos.documents.put({ fileHash, mime: 'application/pdf', bytes });
  await ctx.repos.warranties.put({
    id: crypto.randomUUID(),
    product: 'Máquina de lavar roupa',
    seller: 'Loja de eletrodomésticos',
    purchaseDate: washerDate,
    deliveryDate: addDays(washerDate, 3),
    months: WARRANTY_MONTHS.new,
    priceCents: 42_999,
    fileHash,
    transactionId: washer.id,
    createdAt,
  });

  // The presumption of the defect ends in a few weeks: the "warranty_proof" alert.
  const vacuumDelivery = addMonthsToDate(addDays(ctx.today, 20), -PRESUMPTION_MONTHS.new);
  await ctx.repos.warranties.put({
    id: crypto.randomUUID(),
    product: 'Aspirador',
    purchaseDate: vacuumDelivery,
    deliveryDate: vacuumDelivery,
    months: WARRANTY_MONTHS.new,
    priceCents: 18_990,
    createdAt,
  });

  // The warranty itself ends soon: the "warranty_ending" alert.
  const laptopDelivery = addMonthsToDate(addDays(ctx.today, 45), -WARRANTY_MONTHS.new);
  await ctx.repos.warranties.put({
    id: crypto.randomUUID(),
    product: 'Computador portátil',
    seller: 'Loja de informática',
    purchaseDate: laptopDelivery,
    deliveryDate: laptopDelivery,
    months: WARRANTY_MONTHS.new,
    priceCents: 89_900,
    notes: 'Bateria a perder autonomia: ver antes do fim da garantia.',
    createdAt,
  });
}

/** Fills an empty profile with the demonstration's data and works out its alerts. */
export async function seedDemo(repos: Repositories, today = todayIso()): Promise<void> {
  const ctx: Context = {
    repos,
    today,
    month: monthOf(today),
    random: randomFrom(20_261_128),
    docNumber: 0,
  };
  // No AI in the demonstration, and no backup reminder: nothing here is worth keeping.
  await updateSettings(repos, { aiMode: 'none', lastBackupAt: today });
  await seedTelecom(ctx);
  await seedEnergy(ctx);
  await seedWater(ctx);
  await seedInsurance(ctx);
  await seedTolls(ctx);
  await seedHousehold(ctx);
  await refreshAlerts(repos, today);
}
