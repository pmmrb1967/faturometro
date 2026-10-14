/**
 * Reads the search parameters from COM.escolha's query forms (the HTML of
 * <base>/<Name>Consulta.do), so that a renamed parameter or value is picked up
 * by itself. Labels (input titles) are what is matched: if ANACOM renames
 * those, discovery fails and the weekly check opens an issue.
 */
import type { ComEscolhaConfig } from '../../src/domain/comescolha';

type Search = ComEscolhaConfig['single']['internet'];

export interface Input {
  name: string;
  value?: string;
  title?: string;
  type?: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  atilde: 'ã',
  ccedil: 'ç',
  eacute: 'é',
  ecirc: 'ê',
  iacute: 'í',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  uacute: 'ú',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(String.raw`\s${name}\s*=\s*"([^"]*)"`, 'i').exec(tag);
  return match?.[1] === undefined ? undefined : decodeEntities(match[1]);
}

export function inputs(html: string): Input[] {
  return [...html.matchAll(/<input\b[^>]*>/gi)].flatMap(([tag]) => {
    const name = attribute(tag, 'name');
    if (!name) return [];
    const input: Input = { name };
    const value = attribute(tag, 'value');
    const title = attribute(tag, 'title');
    const type = attribute(tag, 'type');
    if (value !== undefined) input.value = value;
    if (title !== undefined) input.title = title;
    if (type !== undefined) input.type = type.toLowerCase();
    return [input];
  });
}

/** The form's results page, without the session id ("X.do;jsessionid=…" → "X.do"). */
export function formPath(html: string): string | null {
  const action = /<form\b[^>]*\saction="([^"]+)"/i.exec(html)?.[1];
  const file = action?.split(';')[0]?.split('/').pop();
  return file && /\.do$/.test(file) ? file : null;
}

/** One query form → its search, or a list of what could not be found. */
export function discoverSearch(html: string): Search | { missing: string[] } {
  const all = inputs(html);
  const missing: string[] = [];
  const path = formPath(html);
  if (!path) missing.push('form action');

  // "All providers / all loyalty periods / …": checkboxes named todos*/todas* with value "on".
  const fixed: Record<string, string> = {};
  for (const input of all) {
    if (/^tod[oa]s[A-Z]/.test(input.name) && input.value === 'on') fixed[input.name] = 'on';
  }
  if (Object.keys(fixed).length === 0) missing.push('"all" filters');

  const limitParam = all.find((input) => input.type === 'text' && input.title === 'Euros')?.name;
  if (!limitParam) missing.push('monthly limit (Euros)');
  const postalParam = all.find((input) => /c[óo]digo postal/i.test(input.title ?? ''))?.name;

  if (!path || !limitParam || missing.length > 0) return { missing };
  return { path, fixed, limitParam, ...(postalParam ? { postalParam } : {}) };
}

const SERVICE_TITLES: [keyof ComEscolhaConfig['combined']['serviceIds'], RegExp][] = [
  ['internet', /^internet$/i],
  ['tv', /^televis[ãa]o$/i],
  ['landline', /^telefone fixo$/i],
  ['mobile', /^servi[çc]os no telem[óo]vel$/i],
];

/** The combined form: its search plus the service checkboxes. */
export function discoverCombined(
  html: string,
): ComEscolhaConfig['combined'] | { missing: string[] } {
  const search = discoverSearch(html);
  const missing = 'missing' in search ? [...search.missing] : [];
  const all = inputs(html).filter((input) => input.type === 'checkbox' && input.value);
  const ids: Partial<ComEscolhaConfig['combined']['serviceIds']> = {};
  let serviceParam: string | undefined;
  for (const [service, title] of SERVICE_TITLES) {
    const input = all.find((candidate) => title.test(candidate.title ?? ''));
    if (!input?.value) {
      missing.push(`service ${service}`);
      continue;
    }
    if (serviceParam && serviceParam !== input.name) missing.push(`service ${service} parameter`);
    serviceParam = input.name;
    ids[service] = input.value;
  }
  if ('missing' in search || !serviceParam || missing.length > 0) return { missing };
  const { internet, tv, landline, mobile } = ids;
  if (!internet || !tv || !landline || !mobile) return { missing: ['service ids'] };
  return { ...search, serviceParam, serviceIds: { internet, tv, landline, mobile } };
}

/**
 * Number of results on a results page ("110 resultado(s)"), or null. With no
 * results ANACOM shows the query form again with a "no compatible offers" note.
 */
export function resultCount(html: string): number | null {
  if (/n[ãa]o disponibiliza ofertas totalmente compat[íi]veis/i.test(decodeEntities(html)))
    return 0;
  const match = /(\d+)\s+resultado/.exec(html);
  return match?.[1] === undefined ? null : Number(match[1]);
}
