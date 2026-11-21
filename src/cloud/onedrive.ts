/**
 * The app's folder in the user's OneDrive (Apps/Faturómetro), through
 * Microsoft Graph. With the `Files.ReadWrite.AppFolder` permission the app
 * sees only this folder, never the rest of the user's files.
 */
import {
  CloudError,
  type CloudDrive,
  type CloudEntry,
  type CloudFile,
  type CloudWriteOptions,
} from './drive';

const GRAPH = 'https://graph.microsoft.com/v1.0';
export const GRAPH_APP_FOLDER = `${GRAPH}/me/drive/special/approot`;
/** Above this, Graph needs an upload session. */
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
/** Upload session pieces must be multiples of 320 KiB. */
export const UPLOAD_CHUNK_BYTES = 10 * 320 * 1024;
/** Waits up to this long when Graph asks to slow down; longer ones fail as `throttled`. */
const MAX_WAIT_SECONDS = 30;

export interface OneDriveOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const itemUrl = (path: string) => `${GRAPH_APP_FOLDER}:/${encodePath(path)}:`;

interface GraphItem {
  name?: string;
  size?: number;
  eTag?: string;
  file?: unknown;
  '@microsoft.graph.downloadUrl'?: string;
}

async function errorFor(response: Response): Promise<CloudError> {
  const { status } = response;
  if (status === 401) return new CloudError('needs_reconnect');
  if (status === 409 || status === 412) return new CloudError('conflict');
  if (status === 507) return new CloudError('quota_full');
  if (status === 429 || status === 503) {
    const seconds = Number(response.headers.get('retry-after'));
    return new CloudError('throttled', Number.isFinite(seconds) && seconds > 0 ? seconds : 60);
  }
  try {
    const body = (await response.json()) as { error?: { code?: string } };
    if (body.error?.code === 'quotaLimitReached') return new CloudError('quota_full');
  } catch {
    // No JSON body.
  }
  return new CloudError('unexpected');
}

export class OneDrive implements CloudDrive {
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(getToken: () => Promise<string>, options: OneDriveOptions = {}) {
    this.getToken = getToken;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * One request, waiting and trying once more when asked to slow down. 404 comes back as
   * null; any other failure as a `CloudError`. `auth: false` for upload and download links.
   */
  private async request(
    url: string,
    init: RequestInit = {},
    auth = true,
  ): Promise<Response | null> {
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers);
      if (auth) headers.set('Authorization', `Bearer ${await this.getToken()}`);
      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, headers });
      } catch (error) {
        if (error instanceof CloudError) throw error;
        throw new CloudError('offline');
      }
      if (response.ok) return response;
      if (response.status === 404) return null;
      const error = await errorFor(response);
      const wait = error.retryAfterSeconds;
      if (
        error.code === 'throttled' &&
        attempt === 0 &&
        wait !== undefined &&
        wait <= MAX_WAIT_SECONDS
      ) {
        await this.sleep(wait * 1000);
        continue;
      }
      throw error;
    }
  }

  private async item(response: Response): Promise<GraphItem> {
    try {
      return (await response.json()) as GraphItem;
    } catch {
      throw new CloudError('unexpected');
    }
  }

  async read(path: string): Promise<CloudFile | null> {
    const found = await this.request(itemUrl(path));
    if (!found) return null;
    const item = await this.item(found);
    const link = item['@microsoft.graph.downloadUrl'];
    if (!link || !item.eTag) throw new CloudError('unexpected');
    const contents = await this.request(link, {}, false);
    if (!contents) return null;
    return { bytes: new Uint8Array(await contents.arrayBuffer()), etag: item.eTag };
  }

  async write(
    path: string,
    bytes: Uint8Array,
    options: CloudWriteOptions = {},
  ): Promise<{ etag: string }> {
    const headers: Record<string, string> = {};
    if (options.ifMatch !== undefined) headers['If-Match'] = options.ifMatch;
    const conflict = options.ifNoneMatch === '*' ? 'fail' : 'replace';

    if (bytes.length <= SIMPLE_UPLOAD_MAX) {
      const query = conflict === 'fail' ? '?@microsoft.graph.conflictBehavior=fail' : '';
      const response = await this.request(`${itemUrl(path)}/content${query}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(bytes),
      });
      return this.etagOf(response);
    }

    const session = await this.request(`${itemUrl(path)}/createUploadSession`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': conflict } }),
    });
    if (!session) throw new CloudError('unexpected');
    const { uploadUrl } = (await session.json()) as { uploadUrl?: string };
    if (!uploadUrl) throw new CloudError('unexpected');
    let last: Response | null = null;
    for (let start = 0; start < bytes.length; start += UPLOAD_CHUNK_BYTES) {
      const end = Math.min(start + UPLOAD_CHUNK_BYTES, bytes.length);
      last = await this.request(
        uploadUrl,
        {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}` },
          body: new Uint8Array(bytes.subarray(start, end)),
        },
        false,
      );
      if (!last) throw new CloudError('unexpected');
    }
    return this.etagOf(last);
  }

  private async etagOf(response: Response | null): Promise<{ etag: string }> {
    if (!response) throw new CloudError('unexpected');
    const { eTag } = await this.item(response);
    if (!eTag) throw new CloudError('unexpected');
    return { etag: eTag };
  }

  async list(folder: string): Promise<CloudEntry[]> {
    const entries: CloudEntry[] = [];
    let url: string | undefined =
      `${itemUrl(folder)}/children?$select=name,size,eTag,file&$top=200`;
    while (url) {
      const response = await this.request(url);
      if (!response) return entries;
      const page = (await response.json()) as {
        value?: GraphItem[];
        '@odata.nextLink'?: string;
      };
      for (const item of page.value ?? []) {
        if (!item.file || !item.name) continue;
        entries.push({ name: item.name, size: item.size ?? 0, etag: item.eTag ?? '' });
      }
      url = page['@odata.nextLink'];
    }
    return entries;
  }

  async remove(path: string): Promise<void> {
    await this.request(itemUrl(path), { method: 'DELETE' });
  }

  async account(): Promise<{ label: string }> {
    const response = await this.request(`${GRAPH}/me/drive?$select=owner`);
    if (!response) throw new CloudError('unexpected');
    const drive = (await response.json()) as { owner?: { user?: { displayName?: string } } };
    return { label: drive.owner?.user?.displayName ?? 'OneDrive' };
  }
}
