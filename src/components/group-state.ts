import { useState } from 'react';

/** Which blocks of a list are open; a block not in the map takes the page's default. */
export type OpenGroups = Record<string, boolean>;

/** Reads what a device remembered; anything else means every block open. */
export function parseOpenGroups(stored: string | null): OpenGroups {
  if (!stored) return {};
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    );
  } catch {
    return {};
  }
}

/** Whether `group` is open: what was remembered, else the page's default. */
export function isOpenIn(groups: OpenGroups, group: string, defaultOpen: boolean): boolean {
  return groups[group] ?? defaultOpen;
}

/** How many items to show after one more "show more". */
export function nextShown(shown: number, total: number, step: number): number {
  return Math.min(shown + step, total);
}

/**
 * Open or closed blocks of a page ("Faturas", "Contratos", "Definições"), remembered
 * on this device under `storageKey`. A block never opened or closed is `defaultOpen`.
 */
export function useOpenGroups(storageKey: string, defaultOpen = true) {
  const [open, setOpenGroups] = useState<OpenGroups>(() => {
    try {
      return parseOpenGroups(localStorage.getItem(storageKey));
    } catch {
      return {};
    }
  });
  // From the latest state: several blocks may open themselves in the same render.
  const update = (change: (current: OpenGroups) => OpenGroups) =>
    setOpenGroups((current) => {
      const next = change(current);
      if (next === current) return current;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Not remembered on this device; the choice still applies now.
      }
      return next;
    });
  return {
    isOpen: (group: string) => isOpenIn(open, group, defaultOpen),
    setOpen: (group: string, value: boolean) =>
      update((current) =>
        isOpenIn(current, group, defaultOpen) === value ? current : { ...current, [group]: value },
      ),
    setAll: (groups: readonly string[], value: boolean) =>
      update((current) => ({
        ...current,
        ...Object.fromEntries(groups.map((group) => [group, value])),
      })),
  };
}
