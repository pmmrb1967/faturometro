/**
 * pdf.js reads text with `for await (… of readableStream)`. Safari (iOS included) has no
 * async iterator on ReadableStream yet, so every PDF failed there: add one.
 */
export function installReadableStreamIterator(
  prototype: ReadableStream = ReadableStream.prototype,
): void {
  if (Symbol.asyncIterator in prototype) return;
  async function* iterate<T>(this: ReadableStream<T>): AsyncGenerator<T, void, undefined> {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  Object.defineProperty(prototype, Symbol.asyncIterator, {
    value: iterate,
    writable: true,
    configurable: true,
  });
}
