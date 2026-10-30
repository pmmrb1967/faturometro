import { INCOME_KINDS } from '../../domain/income';
import { SPENDING_CATEGORIES } from '../../domain/spending';
import { t } from '../../i18n/pt-PT';

const copy = t.spending;

/** Closed by default: what each category and kind of income is for. */
export function SpendingHelp() {
  return (
    <details className="spending-help">
      <summary>{copy.help.title}</summary>
      <h3>{copy.help.categories}</h3>
      <dl>
        {SPENDING_CATEGORIES.map((category) => (
          <div key={category}>
            <dt>{copy.categories[category]}</dt>
            <dd>{copy.help.category[category]}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">{copy.help.invoices}</p>
      <h3>{copy.help.incomes}</h3>
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
