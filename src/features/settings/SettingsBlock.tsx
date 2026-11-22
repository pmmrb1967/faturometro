import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { GroupControls } from '../../components/GroupBlock';
import { useOpenGroups } from '../../components/group-state';
import '../../components/group-block.css';

const OPEN_BLOCKS_KEY = 'faturometro.settings.openBlocks';

type OpenBlocks = ReturnType<typeof useOpenGroups> & { ids: readonly string[] };
const OpenBlocksContext = createContext<OpenBlocks | null>(null);

/**
 * The settings page's blocks, closed until opened and remembered on this device,
 * with "Abrir todos" / "Fechar todos" above them.
 */
export function SettingsBlocks({ ids, children }: { ids: readonly string[]; children: ReactNode }) {
  const blocks = useOpenGroups(OPEN_BLOCKS_KEY, false);
  return (
    <OpenBlocksContext.Provider value={{ ...blocks, ids }}>
      <GroupControls onAll={(open) => blocks.setAll(ids, open)} />
      {children}
    </OpenBlocksContext.Provider>
  );
}

/**
 * One block of the settings page: its title and a line on its state, and the rest
 * once opened. It opens by itself when a link points at it (`#id`) or when
 * `attention` says there is something to see. Closed, its contents stay mounted
 * (only hidden), so what they are doing carries on.
 */
export function SettingsBlock({
  id,
  title,
  status,
  attention = false,
  children,
}: {
  id: string;
  title: string;
  status?: string;
  attention?: boolean;
  children: ReactNode;
}) {
  const blocks = useContext(OpenBlocksContext);
  const { hash } = useLocation();
  const targeted = hash === `#${id}`;
  const mustOpen = attention || targeted;

  useEffect(() => {
    if (mustOpen) blocks?.setOpen(id, true);
    if (targeted) document.getElementById(id)?.scrollIntoView();
    // Only when it becomes needed: closing it afterwards is the person's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mustOpen, targeted]);

  return (
    <section className="settings-section settings-block" id={id} aria-labelledby={`${id}-title`}>
      <details
        className="group-block"
        open={blocks ? blocks.isOpen(id) : true}
        onToggle={(event) => blocks?.setOpen(id, event.currentTarget.open)}
      >
        <summary>
          <h2 id={`${id}-title`} className="group-title">
            {title}
          </h2>
          {status && (
            <span
              className={attention ? 'group-summary settings-block-attention' : 'group-summary'}
            >
              {status}
            </span>
          )}
        </summary>
        <div className="settings-block-body">{children}</div>
      </details>
    </section>
  );
}
