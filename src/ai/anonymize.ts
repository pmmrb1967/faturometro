/**
 * Anonymization of invoice text before it goes to the free AI (Workers AI,
 * through our server). Runs in the app and again on the server
 * (server/src/ai-free.ts), so it has no imports.
 *
 * Adapted from Prazómetro (packages/ai/src/anonymize.ts), same author: NIF,
 * NISS, IBAN, phones, emails, plates, customer/contract/policy numbers and
 * other long numbers, addresses, postal codes and names become markers
 * ([NIF], [NOME], …). When in doubt, more is removed: a missing number makes a
 * field empty, a personal value must not leave.
 *
 * Kept on purpose, because the extraction needs them (docs/qr-fiscal.md):
 * amounts, dates, percentages, the document number ("FT 2026/123", checked
 * against the fiscal QR code) and the supply point (CPE/CUI).
 */

export type RemovedKind =
  | 'NIF'
  | 'NISS'
  | 'IBAN'
  | 'TELEFONE'
  | 'EMAIL'
  | 'MATRÍCULA'
  | 'REFERÊNCIA'
  | 'NÚMERO'
  | 'MORADA'
  | 'CÓDIGO POSTAL'
  | 'NOME';

export interface Anonymized {
  text: string;
  removed: Partial<Record<RemovedKind, number>>;
}

export interface AnonymizeOptions {
  /** Values the app knows about the person (own NIF, names), removed wherever they appear. */
  known?: string[];
}

/** Portuguese NIF: 9 digits with a mod-11 check digit. */
export function isNif(digits: string): boolean {
  if (!/^[1235689]\d{8}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * (9 - i);
  const check = 11 - (sum % 11);
  return (check >= 10 ? 0 : check) === Number(digits[8]);
}

const MONTHS =
  'janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const DATE = new RegExp(
  [
    String.raw`\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b`,
    String.raw`\b\d{4}[/.-]\d{2}[/.-]\d{2}\b`,
    String.raw`\b\d{1,2}\.?º?\s+de\s+(?:${MONTHS})\s+(?:de\s+)?\d{4}\b`,
  ].join('|'),
  'gi',
);
/** "1.234,56", "12,34", "12.34" (amounts and quantities), "23%". */
const AMOUNT =
  /(?<![\d.,])(?:\d{1,3}(?:[. ]\d{3})*,\d{1,4}|\d+[,.]\d{1,4}|\d{1,3}(?:[,.]\d+)?\s?%)(?![.,]?\d)/g;
/** Document numbers: type, optional series, year/number ("FT 2026/123", "FR A1/2026/45"). */
const DOC_ID =
  /\b(?:FT|FR|FS|NC|ND|FA|FAC|FTR|VD|RG|GR|RC)\s?[A-Z0-9][A-Z0-9.\-/]{0,20}\/\d{1,10}\b/g;
/** ATCUD ("ATCUD: JJ37MGK3-123"): the code identifies the issuer's series, not the person. */
const ATCUD = /\bATCUD\s*:?\s*[A-Z0-9]{8}-\d+\b/g;
/** CPE (electricity) and CUI (gas): "PT" + 16 digits + 2 letters, with optional spaces. */
const SUPPLY_POINT = /\bPT\s?(?:\d{4}\s?){4}[A-Z]{2}(?![A-Z0-9])/g;

const UPPER = 'A-ZÀ-ÖØ-Ý';
const LOWER = 'a-zß-öø-ÿ';
const WORD = `(?:[${UPPER}][${LOWER}'’]+|[${UPPER}]{2,})`;
const CONNECTOR = '(?:d[aeo]s?|D[AEO]S?|e|E)';
const NAME = `${WORD}(?:[ \\t]+(?:${CONNECTOR}[ \\t]+)?${WORD}){0,6}`;

/** Words that follow "Caro" or "Nome:" and are not names. */
const NOT_NAMES = new Set([
  'cliente',
  'clientes',
  'contribuinte',
  'senhor',
  'senhora',
  'titular',
  'destinatário',
  'segurado',
  'segurada',
  'tomador',
  'exmo',
  'exma',
]);

const LABELS = [
  String.raw`Exm[oa]s?\.?(?:\(a\))?[ \t]+(?:Senhor(?:\(a\)|a)?|Sr(?:a|\.ª|ª)?\.?(?:\(a\))?)`,
  String.raw`Prezad[oa](?:\(a\))?(?:[ \t]+(?:Senhor(?:\(a\)|a)?|Sr(?:a|\.ª|ª)?\.?))?`,
  String.raw`Car[oa](?:\(a\))?`,
  String.raw`(?:Sr|Sra|Dr|Dra|Eng)\.ª?`,
  String.raw`(?:Nome|NOME|Cliente|CLIENTE|Adquirente|ADQUIRENTE|Destinatário|DESTINATÁRIO|Titular|TITULAR|Tomador(?:[ \t]+do[ \t]+[Ss]eguro)?|TOMADOR|Segurad[oa]|SEGURAD[OA])(?:[ \t]+(?:do|da)[ \t]+[${LOWER}]+)?[ \t]*[:|]`,
];
// The name may be on the same line or on the next one ("Exma. Senhora\nAna Carvalho").
const LABELLED_NAME = new RegExp(`(${LABELS.join('|')})([ \\t]+|[ \\t]*\\n[ \\t]*)(${NAME})`, 'gu');

const STREET = [
  'Rua',
  'R\\.',
  'Avenida',
  'Av\\.',
  'Travessa',
  'Tv\\.',
  'Largo',
  'Praça',
  'Praceta',
  'Estrada',
  'Alameda',
  'Calçada',
  'Beco',
  'Bairro',
  'Urbanização',
  'Urb\\.',
  'Quinta',
  'Lugar',
  'Caminho',
  'Rotunda',
  'Edifício',
];
const STREET_ALL = [...STREET, ...STREET.map((street) => street.toUpperCase())];
const ADDRESS = new RegExp(`\\b(?:${STREET_ALL.join('|')})[ \\t][^\\n|]{0,100}`, 'gu');

const POSTAL = new RegExp(
  `\\b\\d{4}-\\d{3}(?:[ \\t]+[${UPPER}][\\p{L}'’-]*(?:[ \\t]+(?:d[aeo]s?|[${UPPER}][\\p{L}'’-]*))*)?`,
  'gu',
);

/** Customer, contract, account, policy, installation and payment references. */
const REFERENCE = new RegExp(
  String.raw`\b((?:[Cc]liente|CLIENTE|[Cc]ontrato|CONTRATO|[Cc]onta|CONTA|[Aa]pólice|APÓLICE|[Ii]nstalação|INSTALAÇÃO|[Rr]eferência|REFERÊNCIA|[Rr]ef\.|[Ee]ntidade|ENTIDADE|[Cc]ontador|CONTADOR|[Mm]andato|MANDATO|ADC|[Cc]artão de [Cc]idadão)(?:[ \t]+(?:n\.?[ \t]?[ºo°]\.?|número|nr\.?|N\.?º))?[ \t]*[:-]?[ \t|]*)([A-Z0-9](?:[A-Z0-9/.\-]|[ ](?=\d)){2,}[A-Z0-9])`,
  'gu',
);
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PLATE =
  /\b(?:[A-Z]{2}[- ·]\d{2}[- ·](?:\d{2}|[A-Z]{2})|\d{2}[- ·][A-Z]{2}[- ·]\d{2}|\d{2}[- ·]\d{2}[- ·][A-Z]{2})\b/g;
const LONG_NUMBER = /(?<![\w/])(?:\+\s?)?\d(?:[ .]?\d){6,}(?![\w/])/g;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function anonymizeText(input: string, options: AnonymizeOptions = {}): Anonymized {
  const removed: Partial<Record<RemovedKind, number>> = {};
  const mark = (kind: RemovedKind) => {
    removed[kind] = (removed[kind] ?? 0) + 1;
    return `[${kind}]`;
  };

  // 0. Values the app knows (own NIF, names): before anything else changes the text.
  let text = input;
  const knownNames = new Set<string>();
  for (const value of options.known ?? []) {
    const trimmed = value.trim();
    if (/^\d{9}$/.test(trimmed)) {
      text = text.replace(
        new RegExp(`(?<!\\d)${trimmed.split('').join('[ .]?')}(?!\\d)`, 'g'),
        () => mark('NIF'),
      );
    } else {
      for (const word of trimmed.split(/\s+/)) if (word.length >= 3) knownNames.add(word);
    }
  }

  // 1. Protect what the extraction needs.
  const kept: string[] = [];
  const protect = (match: string) => `${kept.push(match) - 1}`;
  text = text
    .replace(SUPPLY_POINT, protect)
    .replace(ATCUD, protect)
    .replace(DOC_ID, protect)
    .replace(DATE, protect)
    .replace(AMOUNT, protect);

  // 2. Identifiers with a shape of their own.
  text = text
    .replace(EMAIL, () => mark('EMAIL'))
    .replace(IBAN, () => mark('IBAN'))
    .replace(REFERENCE, (_match, label: string, code: string) =>
      /\d/.test(code) ? `${label}${mark('REFERÊNCIA')}` : `${label}${code}`,
    )
    .replace(PLATE, () => mark('MATRÍCULA'))
    .replace(LONG_NUMBER, (match) => {
      const digits = match.replace(/\D/g, '').replace(/^351(?=\d{9}$)/, '');
      if (digits.length === 9 && isNif(digits)) return mark('NIF');
      if (digits.length === 11 && /^[12]/.test(digits)) return mark('NISS');
      if (digits.length === 9 && /^[29]/.test(digits)) return mark('TELEFONE');
      return mark('NÚMERO');
    });

  // 3. Addresses and postal codes.
  text = text.replace(ADDRESS, () => mark('MORADA')).replace(POSTAL, () => mark('CÓDIGO POSTAL'));

  // 4. Names: after "Exmo. Senhor", "Nome:", "Titular:"…, the known ones, and the
  //    same words anywhere else.
  const found = new Set(knownNames);
  text = text.replace(LABELLED_NAME, (match, label: string, space: string, name: string) => {
    const words = name.split(/[ \t]+/).filter((word) => !/^(?:d[aeo]s?|e)$/i.test(word));
    if (words.every((word) => NOT_NAMES.has(word.toLowerCase()))) return match;
    for (const word of words) {
      if (word.length >= 3 && !NOT_NAMES.has(word.toLowerCase())) found.add(word);
    }
    return `${label}${space}${mark('NOME')}`;
  });
  // A line holding only a name, right above an address (the recipient block).
  text = text.replace(
    new RegExp(`^([ \\t]*)(${NAME})[ \\t]*\\n(?=[ \\t]*\\[MORADA\\])`, 'gmu'),
    (_match, indent: string, name: string) => {
      for (const word of name.split(/[ \t]+/)) if (word.length >= 3) found.add(word);
      return `${indent}${mark('NOME')}\n`;
    },
  );
  if (found.size > 0) {
    const words = [...found].sort((a, b) => b.length - a.length).map(escape);
    const any = new RegExp(
      `(?<![\\p{L}])(?:${words.join('|')})(?:[ \\t]+(?:${CONNECTOR}[ \\t]+)?(?:${words.join('|')}))*(?![\\p{L}])`,
      'giu',
    );
    text = text.replace(any, () => mark('NOME'));
  }

  // 5. Put back what was protected.
  text = text.replace(/(\d+)/g, (_match, index: string) => kept[Number(index)] ?? '');
  return { text, removed };
}
