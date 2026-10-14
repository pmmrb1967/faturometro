import type { Parser, ParserContext } from './types';
import { indaquaParser } from './indaqua';
import { nosParser } from './nos';
import { repsolParser } from './repsol';

/** Every layout parser. Issuer NIFs come from field A of real invoices' QR codes (PLAN.md §4). */
export const PARSERS: readonly Parser[] = [nosParser, repsolParser, indaquaParser];

/** By issuer NIF first (QR field A), then by text fingerprint. */
export function findParser(ctx: ParserContext, issuerNif?: string): Parser | undefined {
  if (issuerNif) {
    const byNif = PARSERS.find((parser) => parser.issuerNifs.includes(issuerNif));
    if (byNif) return byNif;
  }
  return PARSERS.find((parser) => {
    try {
      return parser.detect(ctx);
    } catch {
      return false;
    }
  });
}
