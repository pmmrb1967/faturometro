import { describe, expect, it } from 'vitest';
import { installReadableStreamIterator } from './polyfills';

type Iterate = (this: ReadableStream<number>) => AsyncIterator<number>;

describe('installReadableStreamIterator', () => {
  it('lets for await read a stream where the browser cannot (Safari)', async () => {
    // A prototype without the iterator, as in Safari.
    const prototype = {} as ReadableStream;
    installReadableStreamIterator(prototype);
    const iterate = (prototype as unknown as Record<symbol, Iterate>)[Symbol.asyncIterator]!;

    const stream = new ReadableStream<number>({
      start(controller) {
        [1, 2, 3].forEach((value) => controller.enqueue(value));
        controller.close();
      },
    });
    const read: number[] = [];
    for await (const value of { [Symbol.asyncIterator]: () => iterate.call(stream) }) {
      read.push(value);
    }
    expect(read).toEqual([1, 2, 3]);
    // The reader is released: the stream can be read again (now empty).
    expect(stream.locked).toBe(false);
  });

  it('keeps the browser iterator when there is one', () => {
    const native = ReadableStream.prototype[Symbol.asyncIterator];
    installReadableStreamIterator();
    expect(ReadableStream.prototype[Symbol.asyncIterator]).toBe(native);
  });
});
