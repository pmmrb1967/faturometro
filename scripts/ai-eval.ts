/**
 * Phase 5 evaluation (PLAN.md §13): AI extraction vs the layout parsers on
 * the fixtures, to choose the default model and effort.
 *
 *   pnpm ai:eval [--models a,b] [--efforts low,medium] [--public-only]
 *
 * Needs ANTHROPIC_API_KEY (environment or .env.local; never printed). Sends
 * the text of the public synthetic fixtures and, unless --public-only, of
 * the private anonymized ones (fixtures/private, local only) to the
 * Anthropic API. The console shows only aggregate numbers and the names of
 * mismatched fields; the detailed report goes to fixtures/private/ (ignored
 * by Git).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicProvider, type Effort } from '../src/ai/anthropic';
import { documentText } from '../src/ai/document';
import { formatMicroUsd } from '../src/ai/models';
import { AiError } from '../src/ai/provider';
import { validateExtraction } from '../src/features/ingest/validate';
import type { PageText } from '../src/pdf/text';
import { findParser } from '../src/parsers/registry';
import type { ExtractedInvoice } from '../src/parsers/types';
import { parseFiscalQr, vatCents, type FiscalQr } from '../src/qr/parse';

const ROOT = join(import.meta.dirname, '..');
const FIXTURES = join(ROOT, 'fixtures');

function apiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const file = join(ROOT, '.env.local');
  if (existsSync(file)) {
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((row) => row.startsWith('ANTHROPIC_API_KEY='));
    if (line)
      return line
        .slice('ANTHROPIC_API_KEY='.length)
        .trim()
        .replace(/^["']|["']$/g, '');
  }
  throw new Error('ANTHROPIC_API_KEY em falta (variável de ambiente ou .env.local).');
}

function option(name: string, fallback: string): string[] {
  const index = process.argv.indexOf(`--${name}`);
  return (index >= 0 ? (process.argv[index + 1] ?? '') : fallback).split(',').filter(Boolean);
}

interface Case {
  name: string;
  pages: PageText[];
  qr: FiscalQr;
  /** Several invoices in the file: which one. */
  docId?: string;
  reference?: ExtractedInvoice;
}

function loadCases(publicOnly: boolean): Case[] {
  const dirs: { dir: string; label: string }[] = [];
  for (const entry of readdirSync(FIXTURES, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'private') {
      dirs.push({ dir: join(FIXTURES, entry.name), label: entry.name });
    }
  }
  const privateRoot = join(FIXTURES, 'private');
  if (!publicOnly && existsSync(privateRoot)) {
    for (const entry of readdirSync(privateRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push({ dir: join(privateRoot, entry.name), label: `private/${entry.name}` });
      }
    }
  }
  const cases: Case[] = [];
  for (const { dir, label } of dirs) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        pages?: PageText[];
        qrs?: { text: string }[];
      };
      if (!raw.pages) continue;
      const qrs = (raw.qrs ?? []).flatMap(({ text }) => {
        const result = parseFiscalQr(text);
        return result.ok ? [result.qr] : [];
      });
      const ctx = { pages: raw.pages, qrs };
      for (const qr of qrs) {
        const parser = findParser(ctx, qr.issuerNif);
        const reference = parser ? parser.parse(ctx, qr) : undefined;
        cases.push({
          name: `${label}/${file}${qrs.length > 1 ? `#${qr.docId}` : ''}`,
          pages: raw.pages,
          qr,
          ...(qrs.length > 1 && qr.docId ? { docId: qr.docId } : {}),
          ...(reference ? { reference } : {}),
        });
      }
    }
  }
  return cases;
}

const SCALAR_FIELDS = [
  'docId',
  'issueDate',
  'periodStart',
  'periodEnd',
  'dueDate',
  'totalCents',
  'netCents',
  'vatCents',
  'customerNumber',
  'supplyPointId',
  'powerKva',
  'loyaltyEndDate',
] as const;

const squash = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value;

/** Fields the reference has, and whether the AI got each one right. */
function compare(testCase: Case, ai: ExtractedInvoice): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  const { qr, reference } = testCase;
  // Against the QR code (always available).
  result['qr:total'] = ai.totalCents?.value === qr.totalCents;
  result['qr:vat'] = ai.vatCents === undefined || ai.vatCents.value === vatCents(qr);
  if (qr.docId) result['qr:docId'] = squash(ai.docId?.value) === squash(qr.docId);
  result['qr:issueDate'] = ai.issueDate?.value === qr.date;
  if (!reference) return result;
  // Against the layout parser.
  if (reference.sector) result.sector = ai.sector === reference.sector;
  for (const field of SCALAR_FIELDS) {
    const expected = reference[field]?.value;
    if (expected === undefined) continue;
    result[field] = squash(ai[field]?.value) === squash(expected);
  }
  if (reference.lines.length > 0) {
    const sum = (invoice: ExtractedInvoice) =>
      invoice.lines.reduce((total, line) => total + line.amountCents, 0);
    result.linesSum = sum(ai) === sum(reference);
  }
  if (reference.readings.length > 0) {
    const kwh = (invoice: ExtractedInvoice) =>
      Math.round(invoice.readings.reduce((total, reading) => total + reading.quantity, 0));
    result.readingsTotal = kwh(ai) === kwh(reference);
  }
  return result;
}

interface Row {
  model: string;
  effort: Effort;
  case: string;
  ok: boolean;
  error?: string;
  validation?: string;
  fields?: Record<string, boolean>;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
}

async function main() {
  const models = option('models', 'claude-haiku-5-5,claude-sonnet-5-5');
  const efforts = option('efforts', 'low') as Effort[];
  const publicOnly = process.argv.includes('--public-only');
  const cases = loadCases(publicOnly);
  const key = apiKey();
  console.log(
    `${cases.length} documentos (${cases.filter((c) => c.reference).length} com leitor de referência), modelos: ${models.join(', ')}, esforço: ${efforts.join(', ')}`,
  );

  const rows: Row[] = [];
  for (const model of models) {
    for (const effort of efforts) {
      const provider = new AnthropicProvider({ apiKey: key, model, effort });
      for (const testCase of cases) {
        const started = Date.now();
        try {
          const result = await provider.extract(
            { kind: 'text', text: documentText(testCase.pages) },
            testCase.docId,
          );
          const fields = compare(testCase, result.extraction);
          rows.push({
            model,
            effort,
            case: testCase.name,
            ok: true,
            validation: validateExtraction(result.extraction, testCase.qr).validation,
            fields,
            costMicroUsd: result.usage.reduce((sum, usage) => sum + usage.costMicroUsd, 0),
            inputTokens: result.usage.reduce((sum, usage) => sum + usage.inputTokens, 0),
            outputTokens: result.usage.reduce((sum, usage) => sum + usage.outputTokens, 0),
            ms: Date.now() - started,
          });
          const wrong = Object.entries(fields)
            .filter(([, right]) => !right)
            .map(([field]) => field);
          console.log(
            `  ${model} ${effort} ${testCase.name}: ${wrong.length === 0 ? 'tudo certo' : `errado: ${wrong.join(', ')}`}`,
          );
        } catch (error) {
          const code = error instanceof AiError ? error.code : String(error);
          rows.push({
            model,
            effort,
            case: testCase.name,
            ok: false,
            error: code,
            costMicroUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            ms: Date.now() - started,
          });
          console.log(`  ${model} ${effort} ${testCase.name}: erro ${code}`);
          if (code === 'invalid_key' || code === 'no_credit') throw error;
        }
      }
    }
  }

  console.log('\nResumo');
  for (const model of models) {
    for (const effort of efforts) {
      const mine = rows.filter((row) => row.model === model && row.effort === effort);
      const checks = mine.flatMap((row) => Object.values(row.fields ?? {}));
      const right = checks.filter(Boolean).length;
      const passed = mine.filter((row) => row.validation === 'passed').length;
      const cost = mine.reduce((sum, row) => sum + row.costMicroUsd, 0);
      const ms = mine.reduce((sum, row) => sum + row.ms, 0);
      console.log(
        `${model} (${effort}): campos certos ${right}/${checks.length} (${Math.round((100 * right) / Math.max(1, checks.length))}%), ` +
          `validação QR ${passed}/${mine.length}, erros ${mine.filter((row) => !row.ok).length}, ` +
          `custo médio ${formatMicroUsd(Math.round(cost / Math.max(1, mine.length)))}, ` +
          `tempo médio ${(ms / Math.max(1, mine.length) / 1000).toFixed(1)} s`,
      );
    }
  }

  const outDir = join(FIXTURES, 'private');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `ai-eval-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`\nRelatório detalhado (local, ignorado pelo Git): ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof AiError ? `Erro da API: ${error.code}` : error);
  process.exit(1);
});
