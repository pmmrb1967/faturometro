import { describe, expect, it } from 'vitest';
import { KNOWN_WITHOUT_READER } from '../../data/known-providers';
import { t } from '../../i18n/pt-PT';
import { PARSERS } from '../../parsers/registry';

describe('provider coverage', () => {
  it('describes every reader, with the date of its last change', () => {
    for (const parser of PARSERS) {
      expect(parser.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(t.providerCoverage.documentsOf).toHaveProperty(parser.id);
    }
  });

  it('does not list a supplier as without a reader when it has one', () => {
    const withReader = PARSERS.map((parser) => parser.name.toLowerCase());
    for (const names of Object.values(KNOWN_WITHOUT_READER)) {
      for (const name of names) {
        expect(withReader.some((reader) => reader.startsWith(name.toLowerCase()))).toBe(false);
      }
    }
  });
});
