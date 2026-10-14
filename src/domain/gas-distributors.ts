/**
 * Natural gas distribution operators (ORD codes of the ERSE data). Names from
 * the DGEG list of concessions and licences:
 * https://www.dgeg.gov.pt/pt/areas-setoriais/energia/combustiveis/concessoes-e-licencas-sng/
 */
export const GAS_DISTRIBUTORS: readonly { code: string; name: string }[] = [
  { code: 'BEI', name: 'Beiragás' },
  { code: 'DIA', name: 'Dianagás' },
  { code: 'DUR', name: 'Duriensegás' },
  { code: 'LIS', name: 'Lisboagás' },
  { code: 'LUS', name: 'Lusitaniagás' },
  { code: 'MED', name: 'Medigás' },
  { code: 'PAX', name: 'Paxgás' },
  { code: 'REN', name: 'REN Portgás' },
  { code: 'SET', name: 'Setgás' },
  { code: 'SON', name: 'Sonorgás' },
  { code: 'TAG', name: 'Tagusgás' },
];

/** Name of an operator code; the code itself if the ERSE adds one not listed here. */
export function distributorName(code: string): string {
  return GAS_DISTRIBUTORS.find((item) => item.code === code)?.name ?? code;
}
