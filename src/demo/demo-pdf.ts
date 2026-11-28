/**
 * A one-page PDF with a few lines of text, for the demonstration's documents
 * (a warranty's receipt). Built by hand: Helvetica, WinAnsi encoding.
 */

/** WinAnsi code of a character; the euro sign is the only one above Latin-1 used here. */
function winAnsi(char: string): number {
  if (char === '€') return 0x80;
  const code = char.charCodeAt(0);
  return code < 256 ? code : 0x3f; // "?" for anything else
}

function escapePdfText(text: string): string {
  return text.replace(/[\\()]/g, (char) => `\\${char}`);
}

/** Bytes of a PDF with `lines` (the first one larger, as a title). */
export function demoPdf(lines: readonly string[]): Uint8Array<ArrayBuffer> {
  const [title = '', ...rest] = lines;
  const text = [
    'BT',
    `/F1 16 Tf 56 770 Td (${escapePdfText(title)}) Tj`,
    '/F1 11 Tf',
    ...rest.map((line) => `0 -20 Td (${escapePdfText(line)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];

  // One character is one byte (WinAnsi), so string lengths are byte offsets.
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(new ArrayBuffer(body.length));
  for (let index = 0; index < body.length; index++) bytes[index] = winAnsi(body[index]!);
  return bytes;
}
