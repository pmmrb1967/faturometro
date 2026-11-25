import { INCOME_KINDS } from '../../domain/income';
import { categoryOrder } from '../../domain/categories';
import { t } from '../../i18n/pt-PT';
import { categoryName, categoryNote, useCustomCategories } from '../categories/use-categories';

const copy = t.spending;

/** Closed by default: what each category is for. */
export function SpendingHelp() {
  const custom = useCustomCategories() ?? [];
  return (
    <details className="spending-help">
      <summary>{copy.help.spendingTitle}</summary>
      <dl>
        {categoryOrder(custom).map((category) => (
          <div key={category}>
            <dt>{categoryName(category, custom)}</dt>
            <dd>{categoryNote(category, custom)}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{copy.help.invoices}</p>
    </details>
  );
}

/** Closed by default: what income is, read once, and what each kind is for. */
export function IncomeHelp() {
  return (
    <details className="spending-help">
      <summary>{copy.help.incomeTitle}</summary>
      <p className="muted">{copy.income.intro}</p>
      <dl>
        {INCOME_KINDS.map((kind) => (
          <div key={kind}>
            <dt>{copy.income.kinds[kind]}</dt>
            <dd>{copy.help.income[kind]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
