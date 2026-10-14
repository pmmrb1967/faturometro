import { describe, expect, it } from 'vitest';
import type { PageText } from '../../pdf/text';
import { parseFiscalQr, type FiscalQr } from '../../qr/parse';
import { buildDraft, renderContribution, setMasked, wordKey } from './skeleton';

// Synthetic invoice text only.
function item(str: string, x = 10, y = 10) {
  return { str, x, y, width: 50, height: 8, fontName: 'F1' };
}
const PAGES: PageText[] = [
  {
    page: 1,
    width: 595,
    height: 842,
    items: [
      item('Fatura n.º FT 2026/12345'),
      item('Maria Fictícia Exemplar', 10, 30),
      item('Rua Inventada 77, 4000-123 Porto', 10, 40),
      item('CPE PT 0002 0000 1234 5678 AB', 10, 50),
      item('Total a pagar 123,45 €', 10, 60),
      item('Total 123,45', 10, 70),
      item('maria@exemplo.pt', 10, 80),
      item('Cliente 987654', 10, 90),
    ],
  },
];
const QR_TEXT =
  'A:500000000*B:123456789*C:PT*D:FT*E:N*F:20261001*G:FT 2026/12345*H:ABCD-12345*I1:PT*I7:100.37*I8:23.08*N:23.08*O:123.45*Q:abcd*R:1234';
const QR = (parseFiscalQr(QR_TEXT) as { ok: true; qr: FiscalQr }).qr;
const PERSONAL = ['PT 0002 0000 1234 5678 AB', '987654', '123456789'];

function seeded(seed = 1) {
  let state = seed;
  return () => (state = (state * 48271) % 2147483647) / 2147483647;
}

function draft(random = seeded()) {
  return buildDraft({ pages: PAGES, qrs: [QR], personal: PERSONAL, context: { pages: 1 }, random });
}

const text = (contribution: ReturnType<typeof renderContribution>) =>
  contribution.pages.flatMap((page) => page.items.map((i) => i.str)).join('\n') +
  '\n' +
  contribution.qrs.map((qr) => qr.text).join('\n');

describe('contribution skeleton', () => {
  it('keeps positions and fonts', () => {
    const out = renderContribution(draft());
    expect(out.pages[0]!.items.map(({ x, y, fontName }) => ({ x, y, fontName }))).toEqual(
      PAGES[0]!.items.map(({ x, y, fontName }) => ({ x, y, fontName })),
    );
    expect(out.pages[0]!.width).toBe(595);
  });

  it('replaces every number of 3+ digits and keeps the shape', () => {
    const out = text(renderContribution(draft()));
    for (const number of [
      '12345',
      '4000',
      '123',
      '0002',
      '1234',
      '5678',
      '987654',
      '123456789',
      '20261001',
    ]) {
      expect(out).not.toContain(number);
    }
    expect(out).toMatch(/Total a pagar \d{3},\d{2} €/);
  });

  it('maps the same number to the same random number', () => {
    const out = renderContribution(draft());
    const totals = out.pages[0]!.items.filter((i) => i.str.startsWith('Total')).map((i) =>
      i.str.replace(/[^\d,]/g, ''),
    );
    expect(totals[0]).toBe(totals[1]);
  });

  it('never outputs the original digits, even when the RNG would repeat them', () => {
    const zeros = () => 0; // every digit would become 0: "0002" must still change
    expect(text(renderContribution(draft(zeros)))).not.toContain('0002');
  });

  it('keeps vocabulary words and masks the others by shape', () => {
    const out = text(renderContribution(draft()));
    expect(out).toContain('Fatura');
    expect(out).toContain('Total a pagar');
    expect(out).not.toContain('Maria');
    expect(out).not.toContain('Inventada');
    expect(out).toContain('Xxxxx'); // Maria
  });

  it('unmasks a word everywhere, but never a locked one', () => {
    let d = draft();
    d = setMasked(d, wordKey('Porto'), false);
    d = setMasked(d, wordKey('AB'), false); // part of the CPE: locked
    d = setMasked(d, wordKey('maria'), false); // appears in the email: locked
    const out = text(renderContribution(d));
    expect(out).toContain('Porto');
    expect(out).not.toMatch(/\bAB\b/);
    expect(out).not.toContain('maria@');
    expect(d.words[wordKey('Maria')]!.locked).toBe(true);
  });

  it('keeps only A, C and D of the QR, still parseable', () => {
    const out = renderContribution(draft());
    const parsed = parseFiscalQr(out.qrs[0]!.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.qr.issuerNif).toBe('500000000');
    expect(parsed.qr.buyerCountry).toBe('PT');
    expect(parsed.qr.docType).toBe('FT');
    expect(parsed.qr.buyerNif).toBe('999999990');
    expect(out.qrs[0]!.text).not.toContain('123.45');
    expect(out.qrs[0]!.text).not.toContain('ABCD');
    expect(out.issuerNif).toBe('500000000');
  });
});

describe('contribution skeleton: leaks found in review', () => {
  const page = (...strs: string[]): PageText[] => [
    { page: 1, width: 595, height: 842, items: strs.map((s, i) => item(s, 10, 10 + i * 10)) },
  ];
  const render = (pages: PageText[], personal: string[] = []) =>
    renderContribution(
      buildDraft({ pages, qrs: [], personal, context: { pages: 1 }, random: seeded() }),
    );
  const out = (pages: PageText[], personal: string[] = []) =>
    render(pages, personal).pages[0]!.items.map((i) => i.str);

  it('never passes glyph codes, private-use or non-ASCII digits in clear (C1)', () => {
    const [glyphs, privateUse, fullwidth] = out(
      page('\u0012\u0005\u0013\u0001', '', '１２３ ½'),
    );
    expect(glyphs).toBe('????');
    expect(privateUse).toBe('???');
    expect(fullwidth).not.toMatch(/[１２３½]/u);
    expect(fullwidth).toMatch(/^\d{3} \d$/);
  });

  it('masks surnames and places that look like vocabulary, accents count (C2)', () => {
    const [line] = out(page('Maria Dias, Rua da Luz, Campanhã, Vila Real'));
    expect(line).not.toMatch(/Dias|Luz|Campanhã|Real/);
    expect(line).toContain(' da ');
  });

  it('locks letters glued to digits (I2)', () => {
    const draft = buildDraft({
      pages: page('Ref CT12AB34 PT50'),
      qrs: [],
      personal: [],
      context: { pages: 1 },
      random: seeded(),
    });
    for (const key of ['ct', 'ab', 'pt']) expect(draft.words[key]?.locked).toBe(true);
    expect(renderContribution(draft).pages[0]!.items[0]!.str).not.toMatch(/CT|AB|PT/);
  });

  it('locks personal words written with ligatures (NFKD)', () => {
    const [line] = out(page('Teﬁlo Exemplo'), ['Tefilo']);
    const draft = buildDraft({
      pages: page('Teﬁlo'),
      qrs: [],
      personal: ['Tefilo'],
      context: { pages: 1 },
      random: seeded(),
    });
    expect(Object.values(draft.words)[0]!.locked).toBe(true);
    expect(line).not.toContain('ﬁ');
  });

  it('does not keep the exact width of items with masked words (I1)', () => {
    const [rendered] = render(page('Silva')).pages[0]!.items;
    expect(rendered!.str).toBe('Xxxxx');
    expect(rendered!.width).toBe(5 * 8 * 0.5);
    const [label] = render(page('Total')).pages[0]!.items;
    expect(label!.width).toBe(50);
  });
});
