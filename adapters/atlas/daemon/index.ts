import { startDaemon } from './server.js';

export interface DaemonCmdOpts {
  readonly port?: string;
}

export async function daemonCmd(opts: DaemonCmdOpts): Promise<void> {
  const port = opts.port ? parseInt(opts.port, 10) : 8765;
  await startDaemon(port);
}