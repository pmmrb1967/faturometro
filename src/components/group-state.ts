import { useState } from 'react';

/** Which blocks of a list are open; a block not in the map is open. */
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

/** How many items to show after one more "show more". */
export function nextShown(shown: number, total: number, step: number): number {
  return Math.min(shown + step, total);
}

/**
 * Open or closed blocks of a page ("Faturas", "Contratos"), remembered on this
 * device under `storageKey`.
 */
export function useOpenGroups(storageKey: string) {
  const [open, setOpenGroups] = useState<OpenGroups>(() => {
    try {
      return parseOpenGroups(localStorage.getItem(storageKey));
    } catch {
      return {};
    }
  });
  const save = (next: OpenGroups) => {
    setOpenGroups(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Not remembered on this device; the choice still applies now.
    }
  };
  return {
    isOpen: (group: string) => open[group] ?? true,
    setOpen: (group: string, value: boolean) => {
      if ((open[group] ?? true) !== value) save({ ...open, [group]: value });
    },
    setAll: (groups: readonly string[], value: boolean) =>
      save({ ...open, ...Object.fromEntries(groups.map((group) => [group, value])) }),
  };
}
