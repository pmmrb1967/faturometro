/** Test helper: a fetch that records each request and answers from a list, in order. */
export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | string;
}

export type Reply = (call: Call) => Response;

/** A fetch that records each request and answers from a list, in order. */
export function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const body =
      init.body instanceof Uint8Array || typeof init.body === 'string' ? init.body : undefined;
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers,
      ...(body !== undefined ? { body } : {}),
    };
    calls.push(call);
    const reply = replies.shift();
    if (!reply) throw new Error(`unexpected request ${call.method} ${call.url}`);
    return reply(call);
  };
  return { calls, impl };
}

export const json =
  (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
export const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response(code === 204 ? null : JSON.stringify({ error: { code: 'x' } }), {
      status: code,
      headers,
    });
