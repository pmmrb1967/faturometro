/**
 * Turns a real invoice PDF into an anonymized JSON fixture.
 *
 *   pnpm fixture:anon <pdf> <parserId>
 *
 * - PDF password (if any): environment variable FIXTURE_PDF_PASSWORD. It is
 *   also treated as a sensitive term (e.g. Repsol uses the holder's NIF).
 * - Sensitive terms (names, addresses, …): samples/anonymize.local.json,
 *   `{ "terms": ["Full Name", "Street and number", ...] }`. The samples/
 *   folder is git-ignored; never commit this file.
 *   Override the path with FIXTURE_TERMS_FILE.
 * - Output: fixtures/<parserId>/<random id>.json. Review it before committing.
 *
 * The script never prints original values, only replacement counts.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { Anonymizer, isValidNif } from './anonymize/anonymize';
import { extractPdf, PdfPasswordError, type ExtractedPdf } from './anonymize/pdf';

const TERMS_FILE = resolve(
  process.env.FIXTURE_TERMS_FILE ?? join('samples', 'anonymize.local.json'),
);
const FIXTURES_DIR = resolve('fixtures');

const termsSchema = z.object({ terms: z.array(z.string()) });

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function loadTerms(): string[] {
  if (!existsSync(TERMS_FILE)) {
    fail(
      `Missing ${TERMS_FILE}. Create it with {"terms": [...]} listing names, addresses and other personal data that appear in the invoice.`,
    );
  }
  const parsed = termsSchema.safeParse(JSON.parse(readFileSync(TERMS_FILE, 'utf8')));
  if (!parsed.success) fail(`Invalid ${TERMS_FILE}: expected {"terms": string[]}`);
  return parsed.data.terms;
}

function issuerNif(qr: string | null): string | null {
  const field = qr?.split('*').find((part) => part.trim().startsWith('A:'));
  return field ? field.slice(field.indexOf(':') + 1).trim() : null;
}

async function main(): Promise<void> {
  const [pdfPath, parserId] = process.argv.slice(2);
  if (!pdfPath || !parserId) fail('Usage: pnpm fixture:anon <pdf> <parserId>');
  if (!/^[a-z0-9-]+$/.test(parserId))
    fail('parserId must be lowercase letters, digits and hyphens');

  const password = process.env.FIXTURE_PDF_PASSWORD || undefined;
  const terms = loadTerms();
  // A NIF password is handled by the NIF rule (replaced by another valid NIF).
  if (password && !isValidNif(password)) terms.push(password);

  let extracted: ExtractedPdf;
  try {
    extracted = await extractPdf(new Uint8Array(readFileSync(pdfPath)), password);
  } catch (error) {
    if (error instanceof PdfPasswordError) {
      fail(
        error.reason === 'needed'
          ? 'The PDF is password protected: set FIXTURE_PDF_PASSWORD.'
          : 'FIXTURE_PDF_PASSWORD is incorrect.',
      );
    }
    throw error;
  }

  const issuer = issuerNif(extracted.qr);
  const anonymizer = new Anonymizer({
    terms,
    keepNifs: issuer ? [issuer] : [],
    key: randomBytes(32),
  });

  const pages = extracted.pages.map((page) => ({
    ...page,
    items: page.items.map((item) => ({ ...item, str: anonymizer.text(item.str) })),
  }));
  const qr = extracted.qr === null ? null : anonymizer.qr(extracted.qr);

  anonymizer.assertNoLeaks([
    ...pages.flatMap((page) => page.items.map((item) => item.str)),
    // Items are anonymized one by one; also check values split across items.
    ...pages.map((page) => page.items.map((item) => item.str).join('')),
    qr ?? '',
  ]);

  const fixture = {
    schemaVersion: 1,
    parserId,
    createdAt: new Date().toISOString().slice(0, 10),
    qr,
    qrPage: extracted.qrPage,
    pages,
  };

  const dir = join(FIXTURES_DIR, parserId);
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, `${randomUUID().slice(0, 8)}.json`);
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);

  const itemCount = pages.reduce((sum, page) => sum + page.items.length, 0);
  console.log(`✔ ${basename(outPath)}: ${pages.length} page(s), ${itemCount} text items`);
  console.log(
    `  QR: ${qr ? `found on page ${extracted.qrPage}` : 'not found'}${issuer ? `, issuer NIF ${issuer} kept` : ''}`,
  );
  console.log('  Replacements:', JSON.stringify(anonymizer.stats));
  console.log(
    `  Review ${outPath} before committing (names split across items, CPE with spaces, …).`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
