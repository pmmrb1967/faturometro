import { INCOME_KINDS } from '../../domain/income';
import { SPENDING_CATEGORIES } from '../../domain/spending';
import { t } from '../../i18n/pt-PT';

const copy = t.spending;

/** Closed by default: what each category is for. */
export function SpendingHelp() {
  return (
    <details className="spending-help">
      <summary>{copy.help.spendingTitle}</summary>
      <dl>
        {SPENDING_CATEGORIES.map((category) => (
          <div key={category}>
            <dt>{copy.categories[category]}</dt>
            <dd>{copy.help.category[category]}</dd>
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
