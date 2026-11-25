import type { MonthItem } from '../../domain/month';

/** The four kinds of a line of the month, each with its colour (tokens `--kind-*`). */
export type LineKind = 'invoice' | 'forecast' | 'expense' | 'oneOff';

export function lineKind(item: Pick<MonthItem, 'kind'>): LineKind {
  return item.kind === 'transaction' ? 'oneOff' : item.kind;
}
