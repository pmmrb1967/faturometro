import { createHmac } from 'node:crypto';
import { isValidNif, nifCheckDigit } from '../../src/domain/nif';

export { isValidNif };

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
/** NIFs starting with 5 (legal persons) or 6 (public bodies) identify organisations, not people. */
const COMPANY_NIF_PREFIX = /^[56]/;
const MIN_TERM_WORD_LENGTH = 4;
/** Numbers inside terms (door numbers, …) are also replaced on their own from this length. */
const MIN_TERM_NUMBER_LENGTH = 3;
/** Customer and installation numbers can be as short as 5 digits. */
const MIN_DIGIT_RUN = 5;
const POSTAL_CODE = /(?<!\d)(\d{4})\s*-\s*(\d{3})(?!\d)/g;
const OPAQUE_CODE = /(?<![\w;:+/=])[A-Za-z0-9;:+/=]{16,}(?![\w;:+/=])/g;

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

const BARCODE_SYMBOLS = /[\^`~{}|\\<>$#@!"'[\]_=+;?&]/g;

/** Text drawn with a barcode font: long and dense in symbols rarely seen in prose. */
function isBarcodeGibberish(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (compact.length < 12) return false;
  const symbols = compact.match(BARCODE_SYMBOLS)?.length ?? 0;
  return symbols >= 4 && symbols / compact.length >= 0.15;
}

/** Puts the digits of `digits` into the positions of the digits of `template`. */
function withSpacingOf(template: string, digits: string): string {
  let index = 0;
  return template.replace(/\d/g, (digit) => digits[index++] ?? digit);
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

/** Texts to check for leaks: see Anonymizer.assertNoLeaks. */
export interface LeakCheckInput {
  items?: readonly string[];
  joined?: readonly string[];
  other?: readonly string[];
}

function isTextArray(input: readonly string[] | LeakCheckInput): input is readonly string[] {
  return Array.isArray(input);
}

/** How many times `needle` appears in `text` (non-overlapping). */
function occurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  for (
    let index = text.indexOf(needle);
    index >= 0;
    index = text.indexOf(needle, index + needle.length)
  ) {
    count++;
  }
  return count;
}

export class Anonymizer {
  private readonly replacements = new Map<string, string>();
  /** Every sensitive value seen, with what it is (never the value): "term 2", "nif"… */
  private readonly originals = new Map<string, string>();
  private readonly keepNifs: Set<string>;
  private readonly termPatterns: RegExp[];
  /** Whole text items to replace exactly (parts of values split across items). */
  private readonly exactItems = new Map<string, string>();
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
      .filter(
        (word) =>
          (/\p{L}/u.test(word) && word.length >= MIN_TERM_WORD_LENGTH) ||
          (/^\d+$/.test(word) && word.length >= MIN_TERM_NUMBER_LENGTH),
      );
    // Full terms first, then individual words (catches names split across text items).
    const unique = [...new Set([...terms, ...words])].sort((a, b) => b.length - a.length);
    this.termPatterns = unique.map(
      (term) =>
        new RegExp(`(?<![\\p{L}\\p{N}])${accentInsensitiveSource(term)}(?![\\p{L}\\p{N}])`, 'giu'),
    );
    // Labels say which line of the terms file a leaked value comes from, not the value.
    terms.forEach((term, index) => {
      if (!this.originals.has(term)) this.originals.set(term, `term ${index + 1}`);
      for (const word of term.split(/[\s,;/]+/)) {
        if (words.includes(word) && !this.originals.has(word)) {
          this.originals.set(word, `word of term ${index + 1}`);
        }
      }
    });
  }

  /**
   * Looks at a whole page before its items are anonymized one by one, to catch
   * values split across text items (e.g. a postal code as "4455", "-", "237").
   */
  scanPage(items: readonly string[]): void {
    for (const match of items.join(' ').matchAll(POSTAL_CODE)) {
      const [, four = '', three = ''] = match;
      const replacement = this.postalCode(`${four}-${three}`);
      this.exactItems.set(four, replacement.slice(0, 4));
      this.exactItems.set(three, replacement.slice(5));
    }
  }

  /**
   * Anonymizes a page's text items: each item, then the sensitive terms that
   * only appear when items are read together ("MA" + "RIA", letter-by-letter
   * text). Those letters are scrambled where they are, so the same fragment
   * elsewhere on the page is left alone.
   */
  page(items: readonly string[]): string[] {
    this.scanPage(items);
    const out = items.map((item) => this.text(item));
    this.digitGroupsAcrossItems(items, out);
    this.boxedCharsAcrossItems(items, out);
    // Letters and digits of the page, with the item and position each came from, and
    // whether a space came just before (a split value has none: "MA" + "RIA").
    const chars: { item: number; at: number; base: string; afterSpace: boolean }[] = [];
    out.forEach((item, index) => {
      let space = false;
      [...item].forEach((char, at) => {
        if (/\s/.test(char)) {
          space = true;
          return;
        }
        chars.push({ item: index, at, base: stripAccents(char).toLowerCase(), afterSpace: space });
        space = false;
      });
    });
    const flat = chars.map((char) => char.base).join('');
    const marked = new Map<number, Set<number>>();
    for (const [original, label] of this.originals) {
      if (!label.includes('term')) continue;
      const needle = normalizeForLeakCheck(original);
      if (needle.length < MIN_TERM_WORD_LENGTH) continue;
      for (let index = flat.indexOf(needle); index >= 0; index = flat.indexOf(needle, index + 1)) {
        const span = chars.slice(index, index + needle.length);
        if (new Set(span.map((char) => char.item)).size < 2) continue;
        // "es" + " quer do" is not "esquerdo": words of the text, not a split value.
        if (span.slice(1).some((char) => char.afterSpace)) continue;
        for (const char of span) {
          const positions = marked.get(char.item) ?? new Set<number>();
          positions.add(char.at);
          marked.set(char.item, positions);
        }
      }
    }
    for (const [index, positions] of marked) {
      const letters = [...(out[index] ?? '')];
      const scrambled = [...this.scramble(letters.join(''), positions.size)];
      for (const at of positions) letters[at] = scrambled[at] ?? letters[at] ?? '';
      out[index] = letters.join('');
      this.stats.term++;
    }
    return out;
  }

  /**
   * A number printed as digit groups in separate text items ("123", "456",
   * "789": MEO's customer number and NIF) is replaced as a whole, with the same
   * mapping as the compact form, and written back group by group.
   */
  private digitGroupsAcrossItems(items: readonly string[], out: string[]): void {
    const group = /^\d{2,4}$/;
    let index = 0;
    while (index < items.length) {
      const run: number[] = [];
      for (let next = index; next < items.length; next++) {
        const text = (items[next] ?? '').trim();
        if (group.test(text)) run.push(next);
        else if (text !== '' || run.length === 0) break;
      }
      if (run.length < 3) {
        index++;
        continue;
      }
      index = (run.at(-1) ?? index) + 1;
      const parts = run.map((at) => (items[at] ?? '').trim());
      const compact = parts.join('');
      if (compact.length < MIN_DIGIT_RUN) continue;
      if (this.isKeptNif(compact) || isPlausibleDate(compact)) continue;
      const replacement = this.replaceNumber(compact);
      let offset = 0;
      run.forEach((at, position) => {
        const length = parts[position]?.length ?? 0;
        out[at] = (items[at] ?? '').replace(
          parts[position] ?? '',
          replacement.slice(offset, offset + length),
        );
        offset += length;
      });
    }
  }

  /**
   * A value written one character per box on a form ("4", "4", "5", "5", "-",
   * "2", "3", "7": Fidelidade's proposal) is replaced as a whole, with the same
   * mapping as the compact form; the digits are written back box by box.
   */
  private boxedCharsAcrossItems(items: readonly string[], out: string[]): void {
    const box = /^[\p{L}\p{N}-]$/u;
    let index = 0;
    while (index < items.length) {
      const run: number[] = [];
      for (let next = index; next < items.length; next++) {
        if (box.test((items[next] ?? '').trim())) run.push(next);
        else break;
      }
      index = (run.at(-1) ?? index) + 1;
      const compact = run.map((at) => (items[at] ?? '').trim()).join('');
      const digits = compact.replace(/\D/g, '');
      let replacement: string | null = null;
      const postal = /^(\d{4})-?(\d{3})$/.exec(compact);
      if (postal) {
        replacement = this.postalCode(`${postal[1]}-${postal[2]}`).replace('-', '');
      } else if (
        digits.length >= MIN_DIGIT_RUN &&
        !this.isKeptNif(digits) &&
        !isPlausibleDate(digits)
      ) {
        replacement = this.replaceNumber(digits);
      }
      if (replacement === null) continue;
      let offset = 0;
      for (const at of run) {
        const char = (items[at] ?? '').trim();
        if (!/\d/.test(char)) continue;
        out[at] = (items[at] ?? '').replace(char, replacement[offset] ?? char);
        offset++;
      }
    }
  }

  /** Anonymizes free text (a text item from the PDF). */
  text(input: string): string {
    const trimmed = input.trim();
    const exact = this.exactItems.get(trimmed);
    if (exact !== undefined) return input.replace(trimmed, exact);
    // Barcodes drawn with a font come out as symbol soup and may encode personal data.
    if (isBarcodeGibberish(input)) {
      this.stats.digits++;
      return '#'.repeat(input.length);
    }

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
    // Partially masked numbers ("PT50****4845", "PT50…467****404**5"): visible digits are still personal.
    segments = applyRule(
      segments,
      /(?<![A-Za-z0-9])(?:[A-Z]{2})?[\d*•]*[*•]{2,}[\d*•]*/g,
      (match) => {
        if (!/\d/.test(match)) return null;
        return this.replace(match, 'digits', () => this.scrambleDigits(match));
      },
    );
    segments = applyRule(segments, POSTAL_CODE, (match) => {
      const [four = '', three = ''] = match.split('-').map((part) => part.trim());
      return withSpacingOf(match, this.postalCode(`${four}-${three}`).replace('-', ''));
    });
    // Digit groups separated by single spaces ("123 456 789"): same mapping as the compact form.
    segments = applyRule(segments, /(?<![\d.,])\d{2,4}(?: \d{2,4}){2,}(?!\d|[.,]\d)/g, (match) => {
      const compact = match.replace(/ /g, '');
      if (compact.length < MIN_DIGIT_RUN) return null;
      if (this.isKeptNif(compact) || isPlausibleDate(compact)) return null;
      return withSpacingOf(match, this.replaceNumber(compact));
    });
    // Digit groups separated by dots ("123.456.789"); amounts (",dd" after) are excluded.
    segments = applyRule(segments, /(?<![\d.,])\d{3}(?:\.\d{3}){2,}(?!\d|[.,]\d)/g, (match) => {
      const compact = match.replace(/\./g, '');
      if (this.isKeptNif(compact)) return null;
      return withSpacingOf(match, this.replaceNumber(compact));
    });
    segments = applyRule(segments, /(?<!\d)\d{9}(?!\d)/g, (match) => {
      if (!isValidNif(match) || this.isKeptNif(match)) return null;
      return this.replaceNumber(match);
    });
    const digitRun = new RegExp(`(?<![\\d.,])\\d{${MIN_DIGIT_RUN},}(?!\\d|[.,]\\d)`, 'g');
    segments = applyRule(segments, digitRun, (match) => {
      if (this.isKeptNif(match) || isPlausibleDate(match)) return null;
      return this.replaceNumber(match);
    });
    // Opaque codes (e.g. payment codes drawn with a barcode font) may encode personal data.
    segments = applyRule(segments, OPAQUE_CODE, (match) => {
      if (!/\d/.test(match) || !/[a-z]/.test(match) || !/[A-Z]/.test(match)) return null;
      return this.replace(match, 'digits', () => this.scramble(match));
    });
    return segments.map((segment) => segment.text).join('');
  }

  private postalCode(compact: string): string {
    return this.replace(compact, 'postalCode', () => this.scramble(compact));
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

  /**
   * Throws if any original sensitive value is still present. The error says
   * what leaked and how (never the value).
   *
   * - `items` (anonymized one by one, with the same word boundaries): a value
   *   as a whole word, or spelled out with spaces ("M A R I A"), is a leak; a
   *   value only inside a longer word ("Matos" in "Matosinhos") is not.
   * - `joined` (each page's items joined): more occurrences than the items
   *   explain means a value split across items ("MA" + "RIA").
   * - `other` (QR codes; also a plain array): any occurrence is a leak.
   */
  assertNoLeaks(input: readonly string[] | LeakCheckInput): void {
    const {
      items = [],
      joined = [],
      other = [],
    }: LeakCheckInput = isTextArray(input) ? { other: input } : input;
    const plain = (text: string) => stripAccents(text).toLowerCase().replace(/\s+/g, ' ');
    const leaks = [...this.originals].flatMap(([original, label]) => {
      const needle = normalizeForLeakCheck(original);
      if (needle.length < MIN_TERM_WORD_LENGTH) return [];
      const spaced = plain(original).trim();
      const multiword = spaced.includes(' ');
      // Occurrences within the text's words ("es quer do" is not "esquerdo");
      // a multi-word value is matched with its spaces.
      const count = (text: string) =>
        multiword
          ? occurrences(plain(text), spaced)
          : plain(text)
              .split(' ')
              .reduce((sum, word) => sum + occurrences(normalizeForLeakCheck(word), needle), 0);
      const whole = new RegExp(
        `(?<![\\p{L}\\p{N}])${accentInsensitiveSource(original)}(?![\\p{L}\\p{N}])`,
        'iu',
      );
      // Letter by letter with spaces ("M A R I A").
      const letterSpaced = new RegExp(
        [...needle].map((char) => escapeRegExp(char)).join('\\s+'),
        'iu',
      );
      const how: string[] = [];
      let inItems = 0;
      for (const item of items) {
        if (!multiword && letterSpaced.test(plain(item))) how.push('spaced out in a text item');
        const found = count(item);
        if (found === 0) continue;
        if (whole.test(item)) how.push('as a word in a text item');
        inItems += found;
      }
      const inPages = joined.reduce((sum, page) => sum + count(page), 0);
      if (inPages > inItems) how.push('split across text items');
      if (other.some((text) => normalizeForLeakCheck(text).includes(needle))) {
        how.push('in a QR code or other text');
      }
      return how.length > 0 ? [`${label} ${[...new Set(how)].join(', ')}`] : [];
    });
    if (leaks.length > 0) {
      throw new Error(
        `Anonymization leak: ${leaks.length} sensitive value(s) still present (${leaks.join('; ')})`,
      );
    }
  }

  /** Kept: configured NIFs, the final consumer and company/public-body NIFs (not personal data). */
  private isKeptNif(value: string): boolean {
    if (this.keepNifs.has(value)) return true;
    return isValidNif(value) && COMPANY_NIF_PREFIX.test(value);
  }

  /** A valid NIF becomes another valid NIF; any other number is scrambled digit by digit. */
  private replaceNumber(digits: string): string {
    if (isValidNif(digits)) return this.replace(digits, 'nif', () => this.fakeNif(digits));
    return this.replace(digits, 'digits', () => this.scramble(digits));
  }

  private replace(original: string, kind: ReplacementKind, make: () => string): string {
    const known = this.replacements.get(original);
    if (known !== undefined) return known;
    let replacement = make();
    for (let attempt = 1; replacement === original; attempt++) {
      replacement = this.scramble(original, attempt);
    }
    this.replacements.set(original, replacement);
    if (!this.originals.has(original)) this.originals.set(original, kind);
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

  /** Replaces only the digits, keeping letters and everything else. */
  private scrambleDigits(value: string): string {
    const next = this.stream(value, 0);
    return value.replace(/\d/g, () => String(next() % 10));
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
