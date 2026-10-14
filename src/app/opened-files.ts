/**
 * Files opened with "Open with → Faturómetro" on a computer (manifest
 * file_handlers, installed app in Chrome or Edge). Kept in memory only, until
 * the invoices page reads them; nothing is written to disk or sent anywhere.
 */

interface LaunchParams {
  files?: readonly { kind: string; getFile?: () => Promise<File> }[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void | Promise<void>): void;
}

const pending: File[] = [];
const listeners = new Set<() => void>();

export function addOpenedFiles(files: readonly File[]): void {
  if (files.length === 0) return;
  pending.push(...files);
  for (const listener of listeners) listener();
}

/** Takes every opened file still waiting (the queue is emptied). */
export function takeOpenedFiles(): File[] {
  return pending.splice(0, pending.length);
}

/** Called when new files are opened while the app is running; returns the unsubscribe. */
export function onOpenedFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Receives the files the operating system opened with the app (once, at start). */
export function listenForOpenedFiles(): void {
  const queue = (globalThis as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue) return;
  queue.setConsumer(async (params) => {
    const handles = (params.files ?? []).filter((handle) => handle.kind === 'file');
    const files = await Promise.all(handles.map((handle) => handle.getFile?.()));
    addOpenedFiles(files.filter((file): file is File => file !== undefined));
  });
}
