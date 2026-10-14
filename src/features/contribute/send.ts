/** Sends a layout contribution, encrypted for the maintainer, to the project's server. */
import { DEFAULT_SYNC_URL } from '../../sync/config';
import { encryptContribution } from './envelope';
import { MAINTAINER_PUBLIC_KEY } from './maintainer-key';
import type { Contribution } from './skeleton';

export type SendError = 'too_large' | 'full' | 'offline' | 'failed';

export class ContributionError extends Error {
  readonly code: SendError;

  constructor(code: SendError) {
    super(code);
    this.name = 'ContributionError';
    this.code = code;
  }
}

/** Request body accepted by the server (characters). */
export const MAX_ENVELOPE_LENGTH = 400_000;

export async function sendContribution(
  contribution: Contribution,
  options: { serverUrl?: string; fetch?: typeof fetch; publicKey?: JsonWebKey } = {},
): Promise<void> {
  const envelope = await encryptContribution(
    contribution,
    options.publicKey ?? MAINTAINER_PUBLIC_KEY,
  );
  const body = JSON.stringify(envelope);
  if (body.length > MAX_ENVELOPE_LENGTH) throw new ContributionError('too_large');
  const send = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await send(`${options.serverUrl ?? DEFAULT_SYNC_URL}/v1/contributions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch {
    throw new ContributionError('offline');
  }
  if (response.status === 201) return;
  if (response.status === 503) throw new ContributionError('full');
  if (response.status === 413) throw new ContributionError('too_large');
  throw new ContributionError('failed');
}
