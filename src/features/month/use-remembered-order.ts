import { useState } from 'react';

/** Per-device choice of how a list is sorted; the first of `orders` is the default. */
export function useRememberedOrder<T extends string>(
  key: string,
  orders: readonly [T, ...T[]],
): [T, (order: T) => void] {
  const [order, setOrder] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return orders.find((candidate) => candidate === stored) ?? orders[0];
    } catch {
      return orders[0];
    }
  });

  function choose(next: T) {
    setOrder(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Not remembered on this device; the choice still applies now.
    }
  }

  return [order, choose];
}
