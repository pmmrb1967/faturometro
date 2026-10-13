/** Files received through "Share → Faturómetro" (see public/share-target.js). */
const SHARE_CACHE = 'shared-files';

export interface SharedFile {
  name: string;
  mime: string;
  bytes: Uint8Array<ArrayBuffer>;
}

async function cache(): Promise<Cache | undefined> {
  if (typeof caches === 'undefined' || !(await caches.has(SHARE_CACHE))) return undefined;
  return caches.open(SHARE_CACHE);
}

export async function countSharedFiles(): Promise<number> {
  return (await (await cache())?.keys())?.length ?? 0;
}

/** Takes the oldest shared file out of the queue (it is deleted from the browser's cache). */
export async function takeSharedFile(): Promise<SharedFile | undefined> {
  const store = await cache();
  if (!store) return undefined;
  const [request] = [...(await store.keys())].sort((a, b) => a.url.localeCompare(b.url));
  if (!request) return undefined;
  const response = await store.match(request);
  await store.delete(request);
  if (!response) return undefined;
  return {
    name: decodeURIComponent(response.headers.get('X-File-Name') ?? ''),
    mime: response.headers.get('Content-Type') ?? '',
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}
