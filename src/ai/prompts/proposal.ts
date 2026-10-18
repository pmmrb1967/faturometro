/**
 * Insurance proposal reading prompt (versioned: bump PROPOSAL_PROMPT_VERSION
 * on any change). The answer fills the proposal form, which the user reviews
 * before saving; nothing is saved straight from the AI.
 *
 * Only the proposal itself and the names of the current policy's coverages
 * are sent (to match them); never the policy number, capitals or premium.
 * Strict JSON schema as in extract.ts: unknown values are "".
 */
import { z } from 'zod';
import { parseDotDecimalAmount, type Cents } from '../../lib/money';

export const PROPOSAL_PROMPT_VERSION = 'proposal-v1';

export const PROPOSAL_SYSTEM = `Lês propostas e simulações de seguros portuguesas e devolves os dados no formato JSON pedido, para as comparar com a apólice atual do cliente.

Regras:
- Copia apenas o que está escrito na proposta. Nunca inventes nem estimes. Se um valor não estiver na proposta, devolve "" (texto vazio).
- Valores em euros com ponto decimal e sem separador de milhares: "1234.56".
- insurer: o nome da seguradora que faz a proposta.
- annualPremium: o prémio total a pagar por ano, com impostos e encargos. Se a proposta só indicar o valor de cada fração (mensal, trimestral, semestral), devolve "" — não multipliques.
- coverages: uma entrada por cobertura da proposta. name: o nome como está na proposta. current: o nome exato da cobertura da apólice atual a que corresponde, escolhido da lista dada, ou "" se nenhuma corresponder. Não uses o mesmo nome da lista em duas entradas. included: false só se a proposta disser que a cobertura não está incluída. capital: o capital seguro em euros. deductible: a franquia em euros; se a franquia for uma percentagem ou um texto ("10 % mín. 250 €", "Sem franquia"), devolve "" e não a convertas.`;

export function proposalUserPrompt(documentText: string | undefined, coverages: string[]): string {
  const list = coverages.map((name) => `- ${name}`).join('\n');
  const intro = `Coberturas da apólice atual:\n${list}`;
  return documentText
    ? `${intro}\n\nTexto da proposta, linha a linha (as células da mesma linha estão separadas por " | "):\n\n${documentText}`
    : `${intro}\n\nA proposta está no documento anexo.`;
}

/** JSON schema sent to the API (strict: every property required, no extra properties). */
export const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insurer', 'annualPremium', 'coverages'],
  properties: {
    insurer: { type: 'string' },
    annualPremium: { type: 'string' },
    coverages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'current', 'included', 'capital', 'deductible'],
        properties: {
          name: { type: 'string' },
          current: { type: 'string' },
          included: { type: 'boolean' },
          capital: { type: 'string' },
          deductible: { type: 'string' },
        },
      },
    },
  },
} as const;

export const proposalResponseSchema = z.object({
  insurer: z.string().max(200),
  annualPremium: z.string().max(30),
  coverages: z
    .array(
      z.object({
        name: z.string().max(300),
        current: z.string().max(300),
        included: z.boolean(),
        capital: z.string().max(30),
        deductible: z.string().max(30),
      }),
    )
    .max(100),
});

export type ProposalResponse = z.infer<typeof proposalResponseSchema>;

export interface ProposalReading {
  insurer: string;
  annualPremiumCents?: Cents;
  /** By the current policy's coverage name; a coverage not listed is not in the proposal. */
  coverages: Record<string, { included: boolean; capitalCents?: Cents; deductibleCents?: Cents }>;
  /** Coverages of the proposal that match none of the current policy's. */
  extra: string[];
}

function cents(text: string): Cents | undefined {
  const value = text.trim() ? parseDotDecimalAmount(text) : null;
  return value !== null && value >= 0 ? value : undefined;
}

/** Keeps only names of the current policy, each once; amounts in integer cents. */
export function toProposalReading(
  response: ProposalResponse,
  currentNames: readonly string[],
): ProposalReading {
  const known = new Set(currentNames);
  const coverages: ProposalReading['coverages'] = {};
  const extra: string[] = [];
  for (const coverage of response.coverages) {
    if (!known.has(coverage.current) || coverages[coverage.current]) {
      if (coverage.included && coverage.name.trim()) extra.push(coverage.name.trim());
      continue;
    }
    const capitalCents = cents(coverage.capital);
    const deductibleCents = cents(coverage.deductible);
    coverages[coverage.current] = {
      included: coverage.included,
      ...(capitalCents !== undefined ? { capitalCents } : {}),
      ...(deductibleCents !== undefined ? { deductibleCents } : {}),
    };
  }
  const premium = cents(response.annualPremium);
  return {
    insurer: response.insurer.trim(),
    ...(premium !== undefined ? { annualPremiumCents: premium } : {}),
    coverages,
    extra,
  };
}
