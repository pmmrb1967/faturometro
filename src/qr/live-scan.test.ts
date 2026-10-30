import { describe, expect, it, vi } from 'vitest';
import { FRAME_PAUSE_MS, startLiveScan, type LiveScanDeps } from './live-scan';
import type { FoundQr } from './scan';

const FRAME = { width: 1, height: 1 } as ImageData;
const RECEIPT: FoundQr[] = [{ text: 'A:123456789' }];

function deps(extra: Partial<LiveScanDeps> = {}): LiveScanDeps {
  return {
    grabFrame: () => FRAME,
    readFrame: async () => RECEIPT,
    accept: (found) => found.length > 0,
    onFound: vi.fn(),
    onFailed: vi.fn(),
    wait: async () => undefined,
    ...extra,
  };
}

const settled = () => new Promise((resolve) => setTimeout(resolve));

describe('startLiveScan', () => {
  it('stops at the first frame with what it looks for', async () => {
    const readFrame = vi.fn(async () => RECEIPT);
    const scan = deps({ readFrame });
    startLiveScan(scan);
    await settled();
    expect(scan.onFound).toHaveBeenCalledOnce();
    expect(scan.onFound).toHaveBeenCalledWith(RECEIPT);
    expect(readFrame).toHaveBeenCalledOnce();
  });

  it('keeps reading past frames without it, resting between them', async () => {
    const readFrame = vi
      .fn<LiveScanDeps['readFrame']>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ text: 'loyalty card' }])
      .mockResolvedValue(RECEIPT);
    const wait = vi.fn(async () => undefined);
    const scan = deps({
      readFrame,
      wait,
      accept: (found) => found === RECEIPT,
    });
    startLiveScan(scan);
    await settled();
    expect(readFrame).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(FRAME_PAUSE_MS);
    expect(scan.onFound).toHaveBeenCalledOnce();
  });

  it('waits for the camera to have a picture', async () => {
    const grabFrame = vi
      .fn<LiveScanDeps['grabFrame']>()
      .mockReturnValueOnce(null)
      .mockReturnValue(FRAME);
    const readFrame = vi.fn(async () => RECEIPT);
    startLiveScan(deps({ grabFrame, readFrame }));
    await settled();
    expect(grabFrame).toHaveBeenCalledTimes(2);
    expect(readFrame).toHaveBeenCalledOnce();
  });

  it('never reads two frames at once', async () => {
    let finish: (found: FoundQr[]) => void = () => undefined;
    const readFrame = vi.fn(
      () =>
        new Promise<FoundQr[]>((resolve) => {
          finish = resolve;
        }),
    );
    startLiveScan(deps({ readFrame }));
    await settled();
    await settled();
    expect(readFrame).toHaveBeenCalledOnce();
    finish(RECEIPT);
  });

  it('reports nothing once stopped, even with a frame still being read', async () => {
    let finish: (found: FoundQr[]) => void = () => undefined;
    const scan = deps({
      readFrame: () =>
        new Promise<FoundQr[]>((resolve) => {
          finish = resolve;
        }),
    });
    const stop = startLiveScan(scan);
    await settled();
    stop();
    finish(RECEIPT);
    await settled();
    expect(scan.onFound).not.toHaveBeenCalled();
  });

  it('says so when the reader fails', async () => {
    const scan = deps({ readFrame: () => Promise.reject(new Error('worker')) });
    startLiveScan(scan);
    await settled();
    expect(scan.onFailed).toHaveBeenCalledOnce();
    expect(scan.onFound).not.toHaveBeenCalled();
  });
});
