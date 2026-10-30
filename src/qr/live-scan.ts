/**
 * The loop behind the live camera: reads one frame at a time, so a slow phone
 * skips frames instead of piling them up, until a frame has what it looks for.
 */
import type { FoundQr } from './scan';

/** Rest between frames, so the reader does not keep a phone at full load. */
export const FRAME_PAUSE_MS = 150;

export interface LiveScanDeps {
  /** Null while the camera has no picture yet. */
  grabFrame(): ImageData | null;
  readFrame(frame: ImageData): Promise<FoundQr[]>;
  /** Whether these codes are what the scan is looking for. */
  accept(found: FoundQr[]): boolean;
  onFound(found: FoundQr[]): void;
  onFailed(): void;
  wait(ms: number): Promise<void>;
}

/** Starts reading frames; the returned function stops it, and nothing is reported after that. */
export function startLiveScan(deps: LiveScanDeps): () => void {
  let stopped = false;

  async function run() {
    while (!stopped) {
      const frame = deps.grabFrame();
      if (frame) {
        const found = await deps.readFrame(frame);
        if (stopped) return;
        if (deps.accept(found)) {
          deps.onFound(found);
          return;
        }
      }
      await deps.wait(FRAME_PAUSE_MS);
    }
  }

  run().catch(() => {
    if (!stopped) deps.onFailed();
  });
  return () => {
    stopped = true;
  };
}
