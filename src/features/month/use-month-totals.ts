import { useLiveQuery } from 'dexie-react-hooks';
import { forecastInvoices } from '../../domain/forecast';
import { incomeMonth } from '../../domain/income';
import { countedTransactions, monthSummary } from '../../domain/month';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';

/**
 * The month's totals (forecasts and what is still to pay included) and its
 * income: the same numbers above the tabs and in the chart's sentence.
 */
export function useMonthTotals(month: string) {
  const { session } = useSession();
  const data = useLiveQuery(async () => {
    if (!session) return null;
    const repos = session.repos;
    const [invoices, contracts, expenses, payments, transactions, incomes] = await Promise.all([
      repos.invoices.list(),
      repos.contracts.list(),
      repos.expenses.list(),
      repos.payments.list(),
      repos.transactions.list(),
      repos.incomes.list(),
    ]);
    return { invoices, contracts, expenses, payments, transactions, incomes };
  }, [session]);

  if (!data) return null;
  const date = today();
  const summary = monthSummary(
    month,
    data.invoices,
    data.expenses.filter((expense) => !expense.oneOff),
    data.payments,
    {
      today: date,
      contracts: data.contracts,
      forecasts: forecastInvoices(data.contracts, data.invoices, date),
      transactions: countedTransactions(data.transactions, data.invoices),
    },
  );
  return { summary, income: incomeMonth(month, data.incomes) };
}
