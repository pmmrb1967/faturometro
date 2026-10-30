import type { FoundQr } from './scan';

export interface FrameReader {
  /** One frame at a time; a failure of the reader rejects. The frame is handed over. */
  read(frame: ImageData): Promise<FoundQr[]>;
  close(): void;
}

export function createFrameReader(): FrameReader {
  const worker = new Worker(new URL('./frame-reader.worker.ts', import.meta.url), {
    type: 'module',
  });
  return {
    read: (frame) =>
      new Promise((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<FoundQr[] | null>) =>
          data ? resolve(data) : reject(new Error('QR reader failed'));
        worker.onerror = () => reject(new Error('QR reader failed'));
        worker.onmessageerror = () => reject(new Error('QR reader failed'));
        worker.postMessage(frame, [frame.data.buffer]);
      }),
    close: () => worker.terminate(),
  };
}
