/**
 * "Explain this invoice" and letters (PLAN.md §10, uses 2 and 3). Versioned.
 *
 * Only structured data already stored in the app is sent: amounts, dates,
 * lines and consumption. Never the holder's name, address, NIF, customer
 * number or supply point: letters use placeholders, filled in locally after
 * the answer arrives (fillPlaceholders).
 */
import type { Contract, Invoice, InvoiceLine, Reading } from '../../domain/types';
import { formatCents } from '../../lib/money';
import type { TextRequest } from '../provider';

export const EXPLAIN_PROMPT_VERSION = 'explain-v1';
export const LETTER_PROMPT_VERSION = 'letter-v1';

export type LetterKind = 'renegotiate' | 'cancel' | 'estimated_reading';

export interface InvoiceContext {
  invoice: Pick<
    Invoice,
    'issueDate' | 'periodStart' | 'periodEnd' | 'dueDate' | 'totalCents' | 'vatCents'
  >;
  lines: Pick<InvoiceLine, 'kind' | 'description' | 'amountCents' | 'quantity' | 'unit'>[];
  readings: Pick<Reading, 'quantity' | 'unit' | 'readingType' | 'dateTo'>[];
}

export interface ContractContext {
  providerName: string;
  contract: Pick<Contract, 'sector' | 'tariffName' | 'loyaltyEndDate'> & {
    powerKva?: number;
  };
  /** Most recent first. */
  invoices: InvoiceContext[];
  /** From the comparator, when there is a cheaper offer (electricity). */
  cheaperOffer?: { name: string; yearlySavingCents: number };
}

const SECTOR_NAMES: Record<Contract['sector'], string> = {
  electricity: 'eletricidade',
  gas: 'gás natural',
  water: 'água',
  telecom: 'telecomunicações',
  insurance: 'seguro',
  other: 'outra despesa',
};

function describeInvoice(context: InvoiceContext): string {
  const { invoice } = context;
  const rows = [
    `- Data: ${invoice.issueDate}`,
    invoice.periodStart && invoice.periodEnd
      ? `- Período: ${invoice.periodStart} a ${invoice.periodEnd}`
      : undefined,
    `- Total: ${formatCents(invoice.totalCents)}`,
    invoice.vatCents !== undefined ? `- IVA: ${formatCents(invoice.vatCents)}` : undefined,
    ...context.lines.map(
      (line) =>
        `  - ${line.description} (${line.kind}): ${formatCents(line.amountCents)}` +
        (line.quantity !== undefined ? ` — ${line.quantity} ${line.unit ?? ''}`.trimEnd() : ''),
    ),
    ...context.readings.map(
      (reading) =>
        `  - Leitura ${reading.readingType} até ${reading.dateTo}: ${reading.quantity} ${reading.unit}`,
    ),
  ];
  return rows.filter(Boolean).join('\n');
}

function describeContract(context: ContractContext): string {
  const { contract } = context;
  return [
    `Fornecedor: ${context.providerName}`,
    `Serviço: ${SECTOR_NAMES[contract.sector]}`,
    contract.tariffName ? `Tarifário: ${contract.tariffName}` : undefined,
    contract.powerKva ? `Potência contratada: ${contract.powerKva} kVA` : undefined,
    contract.loyaltyEndDate ? `Fim da fidelização: ${contract.loyaltyEndDate}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

export function explainRequest(context: ContractContext): TextRequest {
  const [latest, ...previous] = context.invoices;
  return {
    task: 'explain',
    promptVersion: EXPLAIN_PROMPT_VERSION,
    maxOutputTokens: 2_000,
    system:
      'Explicas faturas domésticas portuguesas a quem não é especialista, em português europeu, tratando a pessoa por "tu". ' +
      'Sê claro e breve (até 250 palavras), com parágrafos curtos ou uma lista. ' +
      'Usa só os dados fornecidos; se faltar informação para explicar algo, diz isso. ' +
      'Explica as parcelas principais e, se houver faturas anteriores, o que mudou e porquê (preço, consumo, dias faturados, descontos que terminaram). ' +
      'Termina com uma sugestão prática, se fizer sentido.',
    user: [
      describeContract(context),
      '',
      'Fatura a explicar:',
      latest ? describeInvoice(latest) : '(sem dados)',
      ...(previous.length > 0
        ? ['', 'Faturas anteriores (mais recente primeiro):', ...previous.map(describeInvoice)]
        : []),
    ].join('\n'),
  };
}

const LETTER_GOALS: Record<LetterKind, string> = {
  renegotiate:
    'Pedido de renegociação: o cliente quer manter o serviço mas pagar menos; pede uma proposta melhor e refere, se existir, a oferta mais barata encontrada no mercado.',
  cancel:
    'Denúncia do contrato (pedido de cessação), com pedido de confirmação escrita da data de fim e de que não há penalizações se a fidelização já terminou.',
  estimated_reading:
    'Reclamação por faturação com leituras estimadas: pede a correção com base em leitura real e a emissão de nova fatura.',
};

/** Placeholders the model must use; filled in locally, never sent. */
export const PLACEHOLDERS = {
  name: '[NOME]',
  address: '[MORADA]',
  nif: '[NIF]',
  customerNumber: '[N.º DE CLIENTE]',
  supplyPoint: '[CPE/CUI]',
  date: '[DATA]',
} as const;

export function letterRequest(kind: LetterKind, context: ContractContext): TextRequest {
  const offer = context.cheaperOffer;
  return {
    task: 'letter',
    promptVersion: LETTER_PROMPT_VERSION,
    maxOutputTokens: 2_000,
    system:
      'Escreves cartas formais curtas em português europeu, de um cliente doméstico para o seu fornecedor. ' +
      'Usa exatamente estes marcadores para os dados pessoais, sem os inventar nem preencher: ' +
      `${Object.values(PLACEHOLDERS).join(', ')}. ` +
      'Não inventes factos, números de contrato, leis ou prazos que não te sejam dados. ' +
      'Devolve só o texto da carta (com assunto), pronto a copiar para email.',
    user: [
      `Objetivo: ${LETTER_GOALS[kind]}`,
      '',
      describeContract(context),
      ...(offer
        ? [
            `Oferta mais barata encontrada no simulador da ERSE: ${offer.name}, com poupança estimada de ${formatCents(offer.yearlySavingCents)} por ano.`,
          ]
        : []),
      '',
      'Faturas recentes (mais recente primeiro):',
      ...context.invoices.slice(0, 3).map(describeInvoice),
    ].join('\n'),
  };
}

/** Fills the placeholders the app knows (locally); the rest stay for the user. */
export function fillPlaceholders(
  text: string,
  values: Partial<Record<keyof typeof PLACEHOLDERS, string>>,
): string {
  let result = text;
  for (const [key, placeholder] of Object.entries(PLACEHOLDERS)) {
    const value = values[key as keyof typeof PLACEHOLDERS];
    if (value) result = result.split(placeholder).join(value);
  }
  return result;
}
