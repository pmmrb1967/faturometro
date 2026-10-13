import { createHmac } from 'node:crypto';

/**
 * Replaces personal data in invoice text with fake values of the same length
 * and format. The mapping is consistent within one run (the same original value
 * always gets the same replacement, in the text and in the QR code), and keyed
 * with a random secret so replacements cannot be reversed by brute force.
 */

export type ReplacementKind = 'term' | 'email' | 'iban' | 'nif' | 'postalCode' | 'digits';

export interface AnonymizerOptions {
  /** Sensitive strings to remove (names, addresses, …). Matched ignoring case and accents. */
  terms: readonly string[];
  /** NIFs that must be kept (e.g. the issuer, field A of the QR code). */
  keepNifs: readonly string[];
  /** Secret key for the replacement mapping; use a fresh random key per run. */
  key: Uint8Array;
}

/** QR fields that may carry personal data; all others are kept untouched. */
const QR_SENSITIVE_FIELDS = new Set(['B', 'G', 'H', 'S']);
const FINAL_CONSUMER_NIF = '999999990';
const MIN_TERM_WORD_LENGTH = 4;
const MIN_DIGIT_RUN = 6;

const ACCENT_CLASSES: Record<string, string> = {
  a: 'aáàâãä',
  e: 'eéèêë',
  i: 'iíìîï',
  o: 'oóòôõö',
  u: 'uúùûü',
  c: 'cç',
  n: 'nñ',
};

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a regex source matching `text` ignoring accents and with flexible whitespace. */
function accentInsensitiveSource(text: string): string {
  let source = '';
  for (const char of stripAccents(text).toLowerCase()) {
    if (/\s/.test(char)) {
      if (!source.endsWith('\\s+')) source += '\\s+';
      continue;
    }
    const variants = ACCENT_CLASSES[char];
    source += variants ? `[${variants}${variants.toUpperCase()}]` : escapeRegExp(char);
  }
  return source;
}

export function isValidNif(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  return nifCheckDigit(nif.slice(0, 8)) === Number(nif[8]);
}

function nifCheckDigit(first8: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(first8[i]) * (9 - i);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** NIB check digits (last two digits of a Portuguese IBAN). */
function nibCheckDigits(first19: string): string {
  let remainder = 0;
  for (const digit of `${first19}00`) remainder = (remainder * 10 + Number(digit)) % 97;
  return String(98 - remainder).padStart(2, '0');
}

function isPlausibleDate(digits: string): boolean {
  if (!/^\d{8}$/.test(digits)) return false;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  return year >= 1990 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

interface Segment {
  text: string;
  /** Already replaced: later rules skip it. */
  done: boolean;
}

/**
 * Applies a replacement rule to the segments not yet replaced. `replace`
 * returns the new text, or null to leave the match as it is.
 */
function applyRule(
  segments: readonly Segment[],
  pattern: RegExp,
  replace: (match: string) => string | null,
): Segment[] {
  const result: Segment[] = [];
  for (const segment of segments) {
    if (segment.done) {
      result.push(segment);
      continue;
    }
    let last = 0;
    for (const match of segment.text.matchAll(pattern)) {
      const replacement = replace(match[0]);
      if (replacement === null) continue;
      if (match.index > last)
        result.push({ text: segment.text.slice(last, match.index), done: false });
      result.push({ text: replacement, done: true });
      last = match.index + match[0].length;
    }
    if (last < segment.text.length) result.push({ text: segment.text.slice(last), done: false });
  }
  return result;
}

function normalizeForLeakCheck(text: string): string {
  return stripAccents(text).toLowerCase().replace(/\s+/g, '');
}

export class Anonymizer {
  private readonly replacements = new Map<string, string>();
  private readonly originals = new Set<string>();
  private readonly keepNifs: Set<string>;
  private readonly termPatterns: RegExp[];
  private readonly key: Uint8Array;
  readonly stats: Record<ReplacementKind, number> = {
    term: 0,
    email: 0,
    iban: 0,
    nif: 0,
    postalCode: 0,
    digits: 0,
  };

  constructor(options: AnonymizerOptions) {
    this.key = options.key;
    this.keepNifs = new Set(options.keepNifs);
    this.keepNifs.add(FINAL_CONSUMER_NIF);

    const terms = options.terms.map((term) => term.trim()).filter((term) => term.length > 0);
    const words = terms
      .flatMap((term) => term.split(/[\s,;/]+/))
      .filter((word) => /\p{L}/u.test(word) && word.length >= MIN_TERM_WORD_LENGTH);
    // Full terms first, then individual words (catches names split across text items).
    const unique = [...new Set([...terms, ...words])].sort((a, b) => b.length - a.length);
    this.termPatterns = unique.map(
      (term) =>
        new RegExp(`(?<![\\p{L}\\p{N}])${accentInsensitiveSource(term)}(?![\\p{L}\\p{N}])`, 'giu'),
    );
    for (const term of unique) this.originals.add(term);
  }

  /** Anonymizes free text (a text item from the PDF). */
  text(input: string): string {
    // Replaced segments are protected so later rules never touch them again.
    let segments: Segment[] = [{ text: input, done: false }];
    for (const pattern of this.termPatterns) {
      segments = applyRule(segments, pattern, (match) =>
        this.replace(match, 'term', () => this.scramble(match)),
      );
    }
    segments = applyRule(segments, /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (match) =>
      this.replace(match, 'email', () => this.scramble(match)),
    );
    segments = applyRule(segments, /\bPT50(?:\s?\d){21}(?!\d)/g, (match) =>
      this.replace(match, 'iban', () => this.fakeIban(match)),
    );
    segments = applyRule(segments, /(?<!\d)\d{9}(?!\d)/g, (match) => {
      if (this.keepNifs.has(match) || !isValidNif(match)) return null;
      return this.replace(match, 'nif', () => this.fakeNif(match));
    });
    segments = applyRule(segments, /(?<!\d)\d{4}-\d{3}(?!\d)/g, (match) =>
      this.replace(match, 'postalCode', () => this.scramble(match)),
    );
    const digitRun = new RegExp(`(?<![\\d.,])\\d{${MIN_DIGIT_RUN},}(?!\\d|[.,]\\d)`, 'g');
    segments = applyRule(segments, digitRun, (match) => {
      if (this.keepNifs.has(match) || isPlausibleDate(match)) return null;
      return this.replace(match, 'digits', () => this.scramble(match));
    });
    return segments.map((segment) => segment.text).join('');
  }

  /** Anonymizes a fiscal QR code string, keeping amounts, dates and the issuer. */
  qr(input: string): string {
    return input
      .split('*')
      .map((field) => {
        const separator = field.indexOf(':');
        if (separator < 0) return field;
        const code = field.slice(0, separator).trim();
        if (!QR_SENSITIVE_FIELDS.has(code)) return field;
        return `${field.slice(0, separator)}:${this.text(field.slice(separator + 1))}`;
      })
      .join('*');
  }

  /** Throws if any original sensitive value is still present in the given texts. */
  assertNoLeaks(texts: readonly string[]): void {
    const haystack = normalizeForLeakCheck(texts.join('\n'));
    const leaks = [...this.originals].filter((original) => {
      const needle = normalizeForLeakCheck(original);
      return needle.length >= MIN_TERM_WORD_LENGTH && haystack.includes(needle);
    });
    if (leaks.length > 0) {
      throw new Error(`Anonymization leak: ${leaks.length} sensitive value(s) still present`);
    }
  }

  private replace(original: string, kind: ReplacementKind, make: () => string): string {
    const known = this.replacements.get(original);
    if (known !== undefined) return known;
    let replacement = make();
    for (let attempt = 1; replacement === original; attempt++) {
      replacement = this.scramble(original, attempt);
    }
    this.replacements.set(original, replacement);
    this.originals.add(original);
    this.stats[kind]++;
    return replacement;
  }

  private stream(value: string, salt: number): () => number {
    let counter = 0;
    let buffer = Buffer.alloc(0);
    let offset = 0;
    return () => {
      if (offset >= buffer.length) {
        buffer = createHmac('sha256', this.key).update(`${salt}:${counter++}:${value}`).digest();
        offset = 0;
      }
      return buffer[offset++] ?? 0;
    };
  }

  /** Replaces digits with digits and letters with letters (same case), keeping everything else. */
  private scramble(value: string, salt = 0): string {
    const next = this.stream(value, salt);
    let output = '';
    for (const char of value) {
      const base = stripAccents(char);
      if (/\d/.test(char)) output += String(next() % 10);
      else if (/[a-z]/.test(base)) output += String.fromCharCode(97 + (next() % 26));
      else if (/[A-Z]/.test(base)) output += String.fromCharCode(65 + (next() % 26));
      else output += char;
    }
    return output;
  }

  /** Valid NIF with the same first digit (keeps the taxpayer type). */
  private fakeNif(nif: string): string {
    const next = this.stream(nif, 0);
    let first8 = nif[0] ?? '1';
    while (first8.length < 8) first8 += String(next() % 10);
    return first8 + String(nifCheckDigit(first8));
  }

  /** Valid Portuguese IBAN, keeping the original spacing. */
  private fakeIban(iban: string): string {
    const next = this.stream(iban, 0);
    let digits = '';
    for (let i = 0; i < 19; i++) digits += String(next() % 10);
    digits += nibCheckDigits(digits);
    let index = 0;
    return iban.replace(/\d/g, (digit, position: number) => {
      if (position < 4) return digit; // the "50" in "PT50"
      return digits[index++] ?? digit;
    });
  }
}
