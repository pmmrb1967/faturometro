import { describe, expect, it } from 'vitest';
import { validateExtraction } from '../features/ingest/validate';
import { layoutFixtures } from '../test/fixtures';
import { findParser } from './registry';

// Every layout with fixtures: parser output must pass cross-validation with the QR code.
const documents = ['nos', 'repsol', 'indaqua'].flatMap((provider) =>
  layoutFixtures(provider).flatMap((fixture) =>
    fixture.qrs.map((qr, index) => ({
      name: `${provider}/${fixture.name} #${index + 1}`,
      fixture,
      qr,
    })),
  ),
);

describe('parsers pass cross-validation', () => {
  it.each(documents)('$name', ({ fixture, qr }) => {
    const ctx = { pages: fixture.pages, qrs: fixture.qrs };
    const parser = findParser(ctx, qr.issuerNif);
    expect(parser).toBeDefined();
    const result = validateExtraction(parser!.parse(ctx, qr), qr);
    expect(result.failures).toEqual([]);
    expect(result.validation).toBe('passed');
  });
});
