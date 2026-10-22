/**
 * Test-only: synthetic E-Redes exports (docs/eredes-xlsx.md): the same structure
 * as a real file (one sheet, inline strings, header in row 8), with a fake CPE
 * and meter number.
 */
import { strToU8, zipSync } from 'fflate';

export type FixtureRow = [date: string, time: string, kw: string, state: string];

const HEADER = ['Contador', 'Data', 'Hora', 'Consumo registado, Ativa (kW)', 'Estado'];
const COLUMNS = 'ABCDE';

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function eredesXlsx(
  rows: FixtureRow[],
  options: { header?: string[]; sharedStrings?: boolean } = {},
): Uint8Array {
  const strings: string[] = [];
  const cell = (reference: string, value: string) => {
    if (!options.sharedStrings) {
      return `<c r="${reference}" s="0" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
    }
    strings.push(value);
    return `<c r="${reference}" s="0" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const line = (number: number, values: string[]) =>
    `<row r="${number}">${values
      .map((value, index) => cell(`${COLUMNS[index]}${number}`, value))
      .join('')}</row>`;
  const sheetRows = [
    line(1, ['Dados Globais']),
    line(3, ['CPE', 'PT0000000000000000XX']),
    line(4, ['Data de Início', '2025-01-01']),
    line(5, ['Data de Fim', '2025-12-31']),
    line(6, ['Intervalo', '15 min']),
    line(8, options.header ?? HEADER),
    ...rows.map((row, index) => line(9 + index, ['000000000000001', ...row])),
  ];
  const files: Record<string, Uint8Array> = {
    'xl/worksheets/sheet1.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${sheetRows.join('')}</sheetData></worksheet>`,
    ),
  };
  if (options.sharedStrings) {
    files['xl/sharedStrings.xml'] = strToU8(
      `<sst>${strings.map((value) => `<si><t>${escape(value)}</t></si>`).join('')}</sst>`,
    );
  }
  return zipSync(files);
}
