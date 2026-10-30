/** Reads camera frames away from the main thread, so the video does not stutter. */
import './zxing-browser';
import { scanFrameQrs } from './scan';

self.onmessage = async (event: MessageEvent<ImageData>) => {
  // An error in here would not reach the page: null tells it the reader failed.
  self.postMessage(await scanFrameQrs(event.data).catch(() => null));
};
