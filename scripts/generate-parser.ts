/**
 * Development tool (not part of the app, PLAN.md §10): asks Claude for a
 * proposed layout parser and its test, from an anonymized fixture of a new
 * layout. The proposal is written for human review to
 * fixtures/private/proposals/<providerId>/ (ignored by Git: it may quote
 * text of the fixture). Copy it into src/parsers/ only after reviewing it,
 * registering it in registry.ts and running pnpm test:parsers.
 *
 *   pnpm parser:generate <fixture.json> <providerId> [--model claude-opus-5-5]
 *
 * Needs ANTHROPIC_API_KEY (environment or .env.local; never printed). Sends
 * the fixture's text and QR codes plus this repository's parser code and
 * guide to the Anthropic API.
 */
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { documentText } from '../src/ai/document';
import { costMicroUsd, formatMicroUsd } from '../src/ai/models';
import type { PageText } from '../src/pdf/text';

const ROOT = join(import.meta.dirname, '..');
const PROMPT_VERSION = 'generate-parser-v1';

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

const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const proposalSchema = z.object({
  parserSource: z.string().min(1),
  testSource: z.string().min(1),
  notes: z.string(),
});

async function main() {
  const [fixturePath, providerId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!fixturePath || !providerId || !/^[a-z0-9-]+$/.test(providerId)) {
    console.error('Uso: pnpm parser:generate <fixture.json> <providerId>');
    process.exit(1);
  }
  const absolute = resolve(fixturePath);
  if (absolute.includes(`${join(ROOT, 'samples')}`)) {
    throw new Error(
      'Usa uma fixture anonimizada (pnpm fixture:anon), nunca um ficheiro de samples/.',
    );
  }
  const modelIndex = process.argv.indexOf('--model');
  const model = modelIndex >= 0 ? (process.argv[modelIndex + 1] ?? '') : 'claude-opus-5-5';

  const fixture = JSON.parse(readFileSync(absolute, 'utf8')) as {
    pages: PageText[];
    qrs?: { text: string }[];
  };
  const system = `You write layout parsers for Faturómetro, a TypeScript app that reads Portuguese household invoices.
Follow the repository's guide and conventions exactly: English code and comments, strict TypeScript, no \`any\`, money in integer cents through src/lib/money.ts helpers, never throw for missing fields, a confidence per field, work only on TextItem[] through the helpers in src/parsers/utils.ts.
Do not invent reference data (provider NIFs, VAT rules): take the issuer NIF only from the fixture's QR codes; if something is unclear, say so in the notes instead of guessing.
The test must load fixtures with layoutFixtures('${providerId}') and cross-check total, VAT, document id and date against the fiscal QR code, like the example.`;

  const user = [
    '# Guide (docs/parsers.md)',
    read('docs/parsers.md'),
    '# Types (src/parsers/types.ts)',
    read('src/parsers/types.ts'),
    '# Helpers (src/parsers/utils.ts)',
    read('src/parsers/utils.ts'),
    '# Example parser (src/parsers/nos.ts)',
    read('src/parsers/nos.ts'),
    '# Example test (src/parsers/nos.test.ts)',
    read('src/parsers/nos.test.ts'),
    `# New layout: providerId "${providerId}"`,
    'Fiscal QR codes in the file:',
    ...(fixture.qrs ?? []).map((qr) => `- ${qr.text}`),
    '',
    'Text, row by row (cells separated by " | "):',
    documentText(fixture.pages),
    '',
    `Write src/parsers/${providerId}.ts (exporting the parser) and src/parsers/${providerId}.test.ts.`,
  ].join('\n\n');

  const client = new Anthropic({ apiKey: apiKey(), maxRetries: 1, timeout: 600_000 });
  console.log(`A pedir uma proposta a ${model}…`);
  const response = await client.messages.create({
    model,
    max_tokens: 64_000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: {
      effort: 'high',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['parserSource', 'testSource', 'notes'],
          properties: {
            parserSource: { type: 'string' },
            testSource: { type: 'string' },
            notes: { type: 'string' },
          },
        },
      },
    },
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const proposal = proposalSchema.parse(JSON.parse(text));

  const outDir = join(ROOT, 'fixtures', 'private', 'proposals', providerId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${providerId}.ts`), proposal.parserSource);
  writeFileSync(join(outDir, `${providerId}.test.ts`), proposal.testSource);
  writeFileSync(
    join(outDir, 'NOTES.md'),
    `# Proposta de parser: ${providerId}\n\nModelo: ${model} (${PROMPT_VERSION})\n\n${proposal.notes}\n`,
  );
  const cost = costMicroUsd(model, response.usage.input_tokens, response.usage.output_tokens);
  console.log(
    `Proposta em ${outDir} (rever antes de copiar para src/parsers/). ` +
      `Tokens: ${response.usage.input_tokens} + ${response.usage.output_tokens}, custo ≈ ${formatMicroUsd(cost)}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
