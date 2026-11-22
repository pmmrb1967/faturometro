import { describe, expect, it } from 'vitest';
import { backupStatus, syncStatus } from './section-status';

describe('the sync line of the settings page', () => {
  it('says the guest needs an account', () => {
    expect(syncStatus({ guest: true })).toEqual({ text: 'Precisa de uma conta', attention: false });
  });

  it('says it is off', () => {
    expect(syncStatus({ guest: false })).toEqual({ text: 'Desligada', attention: false });
  });

  it('names the cloud it syncs through', () => {
    expect(syncStatus({ guest: false, cloud: 'gdrive' })).toEqual({
      text: 'Ligada ao Google Drive',
      attention: false,
    });
  });

  it('names the server', () => {
    expect(syncStatus({ guest: false, server: true })).toEqual({
      text: 'Ligada ao servidor do Faturómetro',
      attention: false,
    });
  });

  it('asks for attention when the cloud sign-in ended', () => {
    expect(syncStatus({ guest: false, cloud: 'onedrive', error: 'needs_reconnect' })).toEqual({
      text: 'A ligação ao OneDrive terminou',
      attention: true,
    });
  });

  it('asks for attention on other problems', () => {
    expect(syncStatus({ guest: false, server: true, error: 'locked' })).toEqual({
      text: 'Precisa de atenção',
      attention: true,
    });
  });

  it('does not open for being offline (it catches up by itself)', () => {
    expect(syncStatus({ guest: false, cloud: 'dropbox', error: 'offline' })).toEqual({
      text: 'Ligada ao Dropbox',
      attention: false,
    });
  });
});

describe('the backup line of the settings page', () => {
  it('says there are no copies', () => {
    expect(backupStatus({})).toEqual({ text: 'Sem cópias', attention: false });
  });

  it('gives the last export', () => {
    expect(backupStatus({ lastExport: '2026-11-20' })).toEqual({
      text: 'Última exportação: 20-11-2026',
      attention: false,
    });
  });

  it('gives the last automatic copy, before the last export', () => {
    expect(
      backupStatus({
        lastExport: '2026-10-01',
        auto: { lastRunAt: '2026-11-21T09:30:00.000Z' },
      }),
    ).toEqual({ text: 'Cópia automática · última 21-11-2026', attention: false });
  });

  it('says the automatic copy is on before its first run', () => {
    expect(backupStatus({ auto: {} })).toEqual({
      text: 'Cópia automática ligada',
      attention: false,
    });
  });

  it('asks for attention when the automatic copy failed', () => {
    expect(backupStatus({ auto: { lastError: 'permission_denied' } })).toEqual({
      text: 'A última cópia automática falhou',
      attention: true,
    });
  });
});
