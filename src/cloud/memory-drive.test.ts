import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CloudError, readJson, writeJson } from './drive';
import { MemoryDrive } from './memory-drive';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('MemoryDrive', () => {
  it('reads back what was written, and null for a missing file', async () => {
    const drive = new MemoryDrive();
    await drive.write('conta.json', bytes('{}'));
    expect(await drive.read('conta.json')).toEqual(bytes('{}'));
    expect(await drive.read('nada.json')).toBeNull();
  });

  it('lists only the files of one folder, with their size', async () => {
    const drive = new MemoryDrive();
    await drive.write('dispositivos/a/00000001.json', bytes('abc'));
    await drive.write('dispositivos/a/00000002.json', bytes('abcd'));
    await drive.write('dispositivos/b/00000001.json', bytes('x'));
    await drive.write('dispositivos/a/sub/ignorado.json', bytes('x'));
    const entries = await drive.list('dispositivos/a');
    expect(entries.map(({ name, size }) => ({ name, size }))).toEqual([
      { name: '00000001.json', size: 3 },
      { name: '00000002.json', size: 4 },
    ]);
    expect(await drive.list('nao-existe')).toEqual([]);
  });

  it('refuses a write with a stale etag or onto an existing file when asked', async () => {
    const drive = new MemoryDrive();
    const first = await drive.write('conta.json', bytes('1'));
    await drive.write('conta.json', bytes('2'), { ifMatch: first.etag });
    await expect(
      drive.write('conta.json', bytes('3'), { ifMatch: first.etag }),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(drive.write('conta.json', bytes('3'), { ifNoneMatch: '*' })).rejects.toMatchObject(
      {
        code: 'conflict',
      },
    );
  });

  it('fails the next call on request, then works again', async () => {
    const drive = new MemoryDrive();
    drive.failNext('quota_full');
    await expect(drive.write('a.json', bytes('1'))).rejects.toBeInstanceOf(CloudError);
    await drive.write('a.json', bytes('1'));
    expect(await drive.read('a.json')).toEqual(bytes('1'));
  });

  it('removes quietly, even a missing file', async () => {
    const drive = new MemoryDrive();
    await drive.write('a.json', bytes('1'));
    await drive.remove('a.json');
    await drive.remove('a.json');
    expect(await drive.read('a.json')).toBeNull();
  });
});

describe('JSON files', () => {
  const schema = z.object({ n: z.number() });

  it('writes and validates JSON', async () => {
    const drive = new MemoryDrive();
    await writeJson(drive, 'x.json', { n: 1 });
    expect(await readJson(drive, 'x.json', schema)).toEqual({ n: 1 });
    expect(await readJson(drive, 'y.json', schema)).toBeNull();
  });

  it('treats a file that does not match the schema as unexpected', async () => {
    const drive = new MemoryDrive();
    await drive.write('x.json', bytes('{"n":"um"}'));
    await expect(readJson(drive, 'x.json', schema)).rejects.toMatchObject({ code: 'unexpected' });
    await drive.write('x.json', bytes('não é json'));
    await expect(readJson(drive, 'x.json', schema)).rejects.toMatchObject({ code: 'unexpected' });
  });
});
