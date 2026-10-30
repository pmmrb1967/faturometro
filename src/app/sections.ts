export const SECTIONS = [
  { id: 'home', path: '/app' },
  { id: 'month', path: '/app/mes' },
  { id: 'spending', path: '/app/gastos' },
  { id: 'contracts', path: '/app/contratos' },
  { id: 'invoices', path: '/app/faturas' },
  { id: 'compare', path: '/app/comparar' },
  { id: 'settings', path: '/app/definicoes' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];
