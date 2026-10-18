import { FeedbackLinks } from '../../components/FeedbackLinks';
import { KNOWN_WITHOUT_READER } from '../../data/known-providers';
import { groupOf, SECTOR_GROUPS } from '../../domain/grouping';
import { t } from '../../i18n/pt-PT';
import { formatIsoDate } from '../../lib/dates';
import { PARSERS } from '../../parsers/registry';

const copy = t.providerCoverage;

/** Which suppliers' invoices the app reads by itself, and what happens with the others. */
export function ProviderCoverage() {
  return (
    <details className="provider-coverage">
      <summary>{copy.title}</summary>
      <p className="muted">{copy.intro}</p>
      <div className="coverage-scroll">
        <table className="coverage-table provider-table">
          <thead>
            <tr>
              <th scope="col">{copy.provider}</th>
              <th scope="col">{copy.type}</th>
              <th scope="col">{copy.documents}</th>
              <th scope="col">{copy.updated}</th>
            </tr>
          </thead>
          <tbody>
            {PARSERS.map((parser) => (
              <tr key={parser.id}>
                <th scope="row">{parser.name}</th>
                <td data-label={copy.type} className="is-short">
                  {[...new Set(parser.sectors.map((sector) => t.groups[groupOf(sector)]))].join(
                    ', ',
                  )}
                </td>
                <td data-label={copy.documents}>
                  {copy.documentsOf[parser.id as keyof typeof copy.documentsOf] ?? copy.invoices}
                </td>
                <td data-label={copy.updated} className="is-short">
                  {formatIsoDate(parser.updated)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>{copy.withoutTitle}</h3>
      <p className="muted">{copy.withoutIntro}</p>
      <ul>
        {SECTOR_GROUPS.map(({ id }) => (
          <li key={id}>
            <strong>{t.groups[id]}:</strong>{' '}
            {KNOWN_WITHOUT_READER[id].length > 0
              ? `${KNOWN_WITHOUT_READER[id].join(', ')}${copy.andOthers}`
              : copy.waterNote}
          </li>
        ))}
      </ul>

      <h3>{copy.requestTitle}</h3>
      <p className="muted">{copy.request}</p>
      <FeedbackLinks kinds={['parser']} />
    </details>
  );
}
