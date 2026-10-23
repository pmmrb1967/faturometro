import { useState, type ReactNode } from 'react';
import { t } from '../i18n/pt-PT';
import { nextShown } from './group-state';
import './group-block.css';

/**
 * A collapsible block of a list ("Energia · 12 faturas…"). Its contents are
 * only rendered while open, so a block opened again starts from its first items.
 */
export function GroupBlock({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="group-block"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>
        <span className="group-title">{title}</span>
        <span className="group-summary">{summary}</span>
      </summary>
      {open && children}
    </details>
  );
}

/** "Abrir todos" / "Fechar todos", for pages with more than one block. */
export function GroupControls({ onAll }: { onAll: (open: boolean) => void }) {
  return (
    <div className="group-controls">
      <button type="button" className="action-secondary" onClick={() => onAll(true)}>
        {t.groups.openAll}
      </button>
      <button type="button" className="action-secondary" onClick={() => onAll(false)}>
        {t.groups.closeAll}
      </button>
    </div>
  );
}

/**
 * The first items of a block and a button for the next ones (no scrolling box
 * inside the page: on a phone it traps the finger, and hides how many are left).
 */
export function LimitedList<T>({
  items,
  render,
  first = 5,
  step = 20,
}: {
  items: readonly T[];
  render: (item: T) => ReactNode;
  first?: number;
  step?: number;
}) {
  const [shown, setShown] = useState(first);
  const left = items.length - shown;
  return (
    <>
      <ul className="list">{items.slice(0, shown).map(render)}</ul>
      {left > 0 && (
        <p className="group-more">
          <button
            type="button"
            className="action-secondary"
            onClick={() => setShown(nextShown(shown, items.length, step))}
          >
            {t.groups.showMore(Math.min(step, left), left)}
          </button>
        </p>
      )}
    </>
  );
}
