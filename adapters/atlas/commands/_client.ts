import { loadSession } from '../auth/session.js';
import { createClient, type BanmaClient } from '../http/client.js';
import { SessionExpiredError } from '../util/errors.js';

export async function getClientOrExit(): Promise<BanmaClient> {
  const session = await loadSession();
  if (!session) {
    throw new SessionExpiredError('No session found');
  }
  return createClient(session);
}
