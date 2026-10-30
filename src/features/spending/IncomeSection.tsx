import { useState } from 'react';
import { GroupBlock } from '../../components/GroupBlock';
import { INCOME_KINDS, incomeMonth } from '../../domain/income';
import { addMonthsTo, expenseActive, expenseAmount } from '../../domain/month';
import type { Income } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { formatMonth } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { useSession } from '../auth/session-context';
import { frequencyOf } from '../month/frequency';
import { IncomeForm, type SavedIncome } from './IncomeForm';

const copy = t.spending.income;

function nameOf(income: Income): string {
  return income.name || copy.kinds[income.kind];
}

/** What comes in: the incomes of the month, and adding, changing or stopping one. */
export function IncomeSection({
  month,
  incomes,
  onMonth,
}: {
  month: string;
  incomes: readonly Income[];
  onMonth: (month: string) => void;
}) {
  const { session } = useSession();
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [shownMonth, setShownMonth] = useState(month);
  if (month !== shownMonth) {
    setShownMonth(month);
    setEditing(null);
  }
  if (!session) return null;
  const repos = session.repos;

  // Between their first and last month (coming in this month or not).
  const active = incomes
    .filter((income) => expenseActive(income, month))
    .sort(
      (a, b) =>
        INCOME_KINDS.indexOf(a.kind) - INCOME_KINDS.indexOf(b.kind) ||
        nameOf(a).localeCompare(nameOf(b), 'pt'),
    );

  async function save(income: SavedIncome | null) {
    setEditing(null);
    if (!income) return;
    await repos.incomes.put(income);
    setOpen(true);
    // Shown where it landed.
    if (!expenseActive(income, month)) onMonth(income.startMonth);
  }

  return (
    <section className="spending-income-block" aria-label={copy.title}>
      {/* Closed, one line above the charts: it changes rarely, purchases every day. */}
      <GroupBlock
        title={copy.title}
        summary={
          active.length > 0
            ? copy.listSummary(active.length, formatCents(incomeMonth(month, active).totalCents))
            : incomes.length === 0
              ? copy.empty
              : copy.emptyMonth
        }
        open={open}
        onToggle={setOpen}
      >
        <p className="muted">{copy.intro}</p>
        {active.length > 0 && (
          <ul className="list">
            {active.map((income) =>
              editing === income.id ? (
                <li key={income.id}>
                  <IncomeForm initial={income} month={month} onDone={save} />
                </li>
              ) : (
                <li key={income.id} className="list-item month-expense">
                  <strong>{nameOf(income)}</strong>
                  <span className="meta">
                    {[
                      income.name ? copy.kinds[income.kind] : undefined,
                      formatCents(expenseAmount(income, month)),
                      frequencyOf(income),
                      copy.day(income.dueDay),
                      income.oneOff
                        ? copy.inMonth(formatMonth(income.startMonth))
                        : income.endMonth
                          ? copy.between(
                              formatMonth(income.startMonth),
                              formatMonth(income.endMonth),
                            )
                          : copy.since(formatMonth(income.startMonth)),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <IncomeActions
                    income={income}
                    month={month}
                    onEdit={() => setEditing(income.id)}
                  />
                </li>
              ),
            )}
          </ul>
        )}
        {editing === 'new' ? (
          <IncomeForm month={month} onDone={save} />
        ) : (
          <p>
            <button type="button" className="action-primary" onClick={() => setEditing('new')}>
              {copy.add}
            </button>
          </p>
        )}
      </GroupBlock>
    </section>
  );
}

/** Change, stop or delete an income; deleting asks first. */
function IncomeActions({
  income,
  month,
  onEdit,
}: {
  income: Income;
  month: string;
  onEdit: () => void;
}) {
  const { session } = useSession();
  const [confirming, setConfirming] = useState(false);
  if (!session) return null;
  const repos = session.repos;
  const name = nameOf(income);

  async function stop() {
    const endMonth = addMonthsTo(month, -1);
    if (endMonth < income.startMonth) setConfirming(true);
    else await repos.incomes.put({ ...income, endMonth });
  }

  if (confirming) {
    return (
      <div className="month-confirm" role="alert">
        <p>{copy.confirmRemove(name)}</p>
        <div className="month-actions">
          <button
            type="button"
            className="action-secondary danger"
            onClick={() => void repos.incomes.remove(income.id)}
          >
            {copy.confirm}
          </button>
          <button type="button" className="action-secondary" onClick={() => setConfirming(false)}>
            {copy.cancel}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="month-actions">
      <button type="button" className="action-secondary" onClick={onEdit}>
        {copy.edit}
      </button>
      {!income.oneOff && (
        <button
          type="button"
          className="action-secondary"
          aria-label={copy.stopLabel(name, formatMonth(month))}
          onClick={() => void stop()}
        >
          {copy.stop}
        </button>
      )}
      <button
        type="button"
        className="action-secondary danger"
        aria-label={`${copy.remove}: ${name}`}
        onClick={() => setConfirming(true)}
      >
        {copy.remove}
      </button>
    </div>
  );
}
