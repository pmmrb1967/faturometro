import type { ReactNode } from 'react';
import './group-block.css';

/** A collapsible block of a list ("Energia · 12 faturas…"), open by default. */
export function GroupBlock({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group-block" open>
      <summary>
        <span className="group-title">{title}</span>
        <span className="group-summary">{summary}</span>
      </summary>
      {children}
    </details>
  );
}
