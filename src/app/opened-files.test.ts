import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addOpenedFiles,
  listenForOpenedFiles,
  onOpenedFiles,
  takeOpenedFiles,
} from './opened-files';

const file = (name: string) => new File(['x'], name, { type: 'application/pdf' });

afterEach(() => {
  takeOpenedFiles();
  delete (globalThis as { launchQueue?: unknown }).launchQueue;
});

describe('opened files', () => {
  it('queues files in memory until they are taken, and notifies listeners', () => {
    const listener = vi.fn();
    const stop = onOpenedFiles(listener);
    addOpenedFiles([file('a.pdf'), file('b.pdf')]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(takeOpenedFiles().map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(takeOpenedFiles()).toEqual([]);
    stop();
    addOpenedFiles([file('c.pdf')]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reads the files the operating system opened with the app', async () => {
    let consumer: ((params: unknown) => Promise<void>) | undefined;
    (globalThis as { launchQueue?: unknown }).launchQueue = {
      setConsumer: (fn: (params: unknown) => Promise<void>) => (consumer = fn),
    };
    listenForOpenedFiles();
    await consumer?.({
      files: [
        { kind: 'file', getFile: () => Promise.resolve(file('fatura.pdf')) },
        { kind: 'directory' },
      ],
    });
    expect(takeOpenedFiles().map((f) => f.name)).toEqual(['fatura.pdf']);
  });

  it('does nothing where the browser cannot open files with the app', () => {
    expect(() => listenForOpenedFiles()).not.toThrow();
  });
});
