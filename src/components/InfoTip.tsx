import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './info-tip.css';

/**
 * "(i)" with an explanation: opens with a tap or a click (phones have no
 * hover), also while the mouse is over it; closes with a tap outside or Esc.
 * The text is in a live region, so screen readers read it when it opens.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const shown = open || hover;

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="info-tip"
      // Only a real mouse: a tap also sends "enter", and nothing would close it.
      onPointerEnter={(event) => event.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(event) => event.pointerType === 'mouse' && setHover(false)}
    >
      <button
        type="button"
        className="info-button"
        aria-label={label}
        aria-expanded={shown}
        aria-controls={id}
        onClick={() => setOpen((previous) => !previous)}
      >
        i
      </button>
      <span id={id} role="status">
        {shown && <span className="info-tip-text">{children}</span>}
      </span>
    </span>
  );
}
