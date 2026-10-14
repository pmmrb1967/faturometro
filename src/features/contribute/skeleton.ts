/**
 * The anonymized skeleton of an invoice layout ("Contribuir com este layout").
 *
 * A Draft keeps the original words in memory only, so the person can unmask a
 * word in the preview; only `renderContribution` output ever leaves the browser:
 * - every number becomes a random number of the same shape (the same number gives
 *   the same random number within one contribution, never the original digits);
 * - words outside the invoice vocabulary are masked by shape ("Silva" → "Xxxxx");
 * - words of known personal values (and of any text with an email) stay masked.
 */
import type { PageText, TextItem } from '../../pdf/text';
import type { FiscalQr } from '../../qr/parse';
import { VOCABULARY } from './vocabulary';
import { wordKey } from './word-key';

export { wordKey } from './word-key';

export type Token =
  | { kind: 'sep'; text: string }
  | { kind: 'num'; text: string }
  | { kind: 'word'; key: string; original: string; shape: string };

export interface DraftItem extends Omit<TextItem, 'str'> {
  tokens: Token[];
}

export interface DraftPage {
  page: number;
  width: number;
  height: number;
  items: DraftItem[];
}

export interface WordState {
  key: string;
  sample: string;
  count: number;
  /** Part of a personal value: never unmasked. */
  locked: boolean;
  masked: boolean;
}

export interface ContributionContext {
  pages: number;
  parserId?: string;
  parserVersion?: string;
  failures?: string[];
}

export interface Draft {
  issuerNif: string;
  pages: DraftPage[];
  words: Record<string, WordState>;
  qrs: string[];
  context: ContributionContext;
}

export interface Contribution {
  version: 1;
  createdAt: string;
  issuerNif: string;
  context: ContributionContext;
  pages: PageText[];
  qrs: { text: string }[];
}

export interface DraftInput {
  pages: PageText[];
  qrs: FiscalQr[];
  /** Values read from the invoice that identify the person (NIF, CPE, customer number…). */
  personal: string[];
  context: ContributionContext;
  random?: () => number;
}

const TOKEN = /(\p{L}+)|(\d+)|([^\p{L}\d]+)/gu;
/** QR fields kept as they are: issuer NIF, buyer country, document type and status, tax regions. */
const QR_KEPT = new Set(['A', 'C', 'D', 'E', 'I1', 'J1', 'K1']);
const FINAL_CONSUMER = '999999990';

function shapeOf(word: string): string {
  return [...word].map((char) => (char !== char.toLowerCase() ? 'X' : 'x')).join('');
}

function randomDigits(original: string, random: () => number): string {
  let out = '';
  for (let index = 0; index < original.length; index++) {
    const nonZero = index === 0 && original.length > 1 && original[0] !== '0';
    const digit = nonZero ? 1 + Math.floor(random() * 9) : Math.floor(random() * 10);
    out += String(Math.min(digit, 9));
  }
  if (out === original) {
    // Never the original digits.
    const last = Number(out.at(-1));
    out = out.slice(0, -1) + String((last + 1) % 10);
  }
  return out;
}

function letterRuns(text: string): string[] {
  return text.match(/\p{L}+/gu) ?? [];
}

export function buildDraft(input: DraftInput): Draft {
  const random = input.random ?? Math.random;
  const numbers = new Map<string, string>();
  const num = (digits: string): string => {
    let replaced = numbers.get(digits);
    if (replaced === undefined) {
      replaced = randomDigits(digits, random);
      numbers.set(digits, replaced);
    }
    return replaced;
  };

  const locked = new Set<string>();
  const personal = [
    ...input.personal,
    ...input.qrs.flatMap((qr) =>
      qr.buyerNif && qr.buyerNif !== FINAL_CONSUMER ? [qr.buyerNif] : [],
    ),
  ];
  for (const value of personal) for (const run of letterRuns(value)) locked.add(wordKey(run));
  for (const page of input.pages) {
    for (const item of page.items) {
      if (item.str.includes('@')) for (const run of letterRuns(item.str)) locked.add(wordKey(run));
    }
  }

  const words: Record<string, WordState> = {};
  const pages = input.pages.map((page): DraftPage => ({
    page: page.page,
    width: page.width,
    height: page.height,
    items: page.items.map(({ str, ...position }): DraftItem => {
      const tokens: Token[] = [];
      for (const [, letters, digits, other] of str.matchAll(TOKEN)) {
        if (letters !== undefined) {
          const key = wordKey(letters);
          const state = (words[key] ??= {
            key,
            sample: letters,
            count: 0,
            locked: locked.has(key),
            masked: locked.has(key) || !VOCABULARY.has(key),
          });
          state.count++;
          tokens.push({ kind: 'word', key, original: letters, shape: shapeOf(letters) });
        } else if (digits !== undefined) {
          tokens.push({ kind: 'num', text: num(digits) });
        } else if (other !== undefined) {
          tokens.push({ kind: 'sep', text: other });
        }
      }
      return { ...position, tokens };
    }),
  }));

  return {
    issuerNif: input.qrs[0]?.issuerNif ?? '',
    pages,
    words,
    qrs: input.qrs.map((qr) => anonymizeQr(qr.raw, num)),
    context: input.context,
  };
}

function anonymizeQr(raw: string, num: (digits: string) => string): string {
  return raw
    .trim()
    .split('*')
    .map((part) => {
      const separator = part.indexOf(':');
      if (separator < 0) return '';
      const code = part.slice(0, separator).trim().toUpperCase();
      const value = part.slice(separator + 1).trim();
      if (QR_KEPT.has(code)) return `${code}:${value}`;
      if (code === 'B') return `B:${FINAL_CONSUMER}`;
      // The date is mandatory for the QR to parse; only its year stays.
      if (code === 'F') return `F:${value.slice(0, 4)}0101`;
      const masked = value
        .replace(/\d+/g, (digits) => num(digits))
        .replace(/\p{L}+/gu, (letters) => 'X'.repeat(letters.length));
      return `${code}:${masked}`;
    })
    .filter((part) => part !== '')
    .join('*');
}

/** Masks or unmasks every occurrence of a word; locked words stay masked. */
export function setMasked(draft: Draft, key: string, masked: boolean): Draft {
  const state = draft.words[key];
  if (!state || state.locked || state.masked === masked) return draft;
  return { ...draft, words: { ...draft.words, [key]: { ...state, masked } } };
}

export function renderContribution(draft: Draft, now = new Date()): Contribution {
  return {
    version: 1,
    createdAt: now.toISOString(),
    issuerNif: draft.issuerNif,
    context: draft.context,
    pages: draft.pages.map((page) => ({
      page: page.page,
      width: page.width,
      height: page.height,
      items: page.items.map(({ tokens, ...position }) => ({
        ...position,
        str: tokens
          .map((token) => {
            if (token.kind !== 'word') return token.text;
            return draft.words[token.key]?.masked === false ? token.original : token.shape;
          })
          .join(''),
      })),
    })),
    qrs: draft.qrs.map((text) => ({ text })),
  };
}
