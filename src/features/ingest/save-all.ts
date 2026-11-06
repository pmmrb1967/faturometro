/**
 * "Guardar todas": saves the documents of one file one after the other (the
 * first may create the contract the next ones go to), and stops at the first
 * one that needs something from the user, leaving it and the rest open.
 */
export async function saveInOrder(
  steps: readonly (() => Promise<boolean>)[],
): Promise<{ saved: number; stopped: boolean }> {
  let saved = 0;
  for (const step of steps) {
    if (!(await step())) return { saved, stopped: true };
    saved++;
  }
  return { saved, stopped: false };
}
