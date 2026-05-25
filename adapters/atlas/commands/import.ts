import { request, FormData } from 'undici';
import { getClientOrExit } from './_client.js';
import { loadWorkbook, type WorkbookSummary } from './_import_validate.js';
import { resolveProjectIdAsync } from '../util/projectId.js';
import { ConfigError, NotImplementedError } from '../util/errors.js';
import { loadSession, buildCookieHeader, type Session } from '../auth/session.js';
import { BASE_URL, DEFAULT_USER_AGENT } from '../util/paths.js';
import { SessionExpiredError } from '../util/errors.js';
import { printResult } from '../util/output.js';

export type ImportTarget = 'lineplan' | 'month';

const VALID_IMPORT_TARGETS = new Set<ImportTarget>(['lineplan', 'month']);

export function parseImportTarget(raw: string | undefined): ImportTarget {
  // Default to month — the only currently-wired endpoint.
  const v = (raw ?? 'month') as ImportTarget;
  if (!VALID_IMPORT_TARGETS.has(v)) {
    throw new ConfigError(`--target must be lineplan|month (got "${raw}")`);
  }
  return v;
}

export interface ImportCmdOpts {
  readonly projectId?: string;
  readonly file: string;
  readonly apply?: boolean;
  readonly json?: boolean;
  readonly target?: string;
  readonly refreshProjects?: boolean;
}

interface ImportOutcome {
  readonly projectId: string;
  readonly projectName?: string;
  readonly mode: 'dry-run' | 'apply';
  readonly file: string;
  readonly summary: WorkbookSummary;
  readonly serverResponse?: unknown;
}

export async function importCmd(opts: ImportCmdOpts): Promise<void> {
  if (!opts.file) throw new ConfigError('--file <path> is required.');
  const target = parseImportTarget(opts.target);
  if (target === 'lineplan') {
    throw new NotImplementedError(
      'Import target "lineplan" is not yet wired. Use --target month (default) for the monthly manpower import.',
    );
  }

  const client = await getClientOrExit();
  const resolved = await resolveProjectIdAsync(opts.projectId, client, {
    refresh: opts.refreshProjects,
  });
  const projectId = resolved.id;

  const loaded = await loadWorkbook(opts.file);
  const summary = loaded.summary;
  const hasMissing = summary.missingColumns.length > 0;

  if (!opts.apply) {
    emit({
      projectId,
      ...(resolved.name ? { projectName: resolved.name } : {}),
      mode: 'dry-run',
      file: opts.file,
      summary,
    }, opts);
    if (hasMissing) {
      // eslint-disable-next-line no-console
      console.warn(
        `[import] Missing expected columns: ${summary.missingColumns.join(', ')}. ` +
          'Server may reject. Re-run with --apply if you accept the risk.',
      );
    }
    return;
  }

  if (hasMissing) {
    throw new ConfigError(
      `Refusing to --apply: missing required columns: ${summary.missingColumns.join(', ')}. ` +
        'Fix the file or drop --apply for a dry-run.',
    );
  }

  const session = await loadSession();
  if (!session) throw new SessionExpiredError('No session found');

  const serverResponse = await postMultipart(session, projectId, loaded.buffer, opts.file);

  emit({
    projectId,
    ...(resolved.name ? { projectName: resolved.name } : {}),
    mode: 'apply',
    file: opts.file,
    summary,
    serverResponse,
  }, opts);
}

async function postMultipart(
  session: Session,
  projectId: string,
  buffer: Buffer,
  originalFileName: string,
): Promise<unknown> {
  const form = new FormData();
  form.set('projectId', projectId);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  // FormData typings in undici allow passing a filename string as the 3rd arg.
  form.set('file', blob, originalFileName.split('/').pop() ?? 'upload.xlsx');

  const url = `${BASE_URL}/yuntu-service/line/plan/month/import.json`;
  const cookieHeader = buildCookieHeader(session.cookies);
  const res = await request(url, {
    method: 'POST',
    body: form,
    headers: {
      token: session.bucToken,
      'x-banma-token': session.bucToken,
      'x-banma-staff-id': String(session.empId),
      'x-banma-user': session.account,
      'x-banma-company-id': session.companyId ?? '',
      'user-agent': session.userAgent || DEFAULT_USER_AGENT,
      cookie: cookieHeader,
      accept: 'application/json, text/plain, */*',
    },
  });

  if (res.statusCode === 401 || res.statusCode === 403) {
    throw new SessionExpiredError(`HTTP ${res.statusCode}`);
  }
  const text = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`Import failed: HTTP ${res.statusCode}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function emit(outcome: ImportOutcome, opts: ImportCmdOpts): void {
  const s = outcome.summary;
  const projLine = outcome.projectName
    ? `projectId: ${outcome.projectId} ("${outcome.projectName}")`
    : `projectId: ${outcome.projectId}`;
  printResult(outcome, {
    json: opts.json,
    meta: { mode: outcome.mode },
    renderHuman: () => {
      // eslint-disable-next-line no-console
      console.log(
        [
          `mode: ${outcome.mode}`,
          projLine,
          `file: ${outcome.file}`,
          `sheet: ${s.sheetName}`,
          `data rows: ${s.rowCount}`,
          `headers (${s.headerRow.length}): ${s.headerRow.join(', ') || '(none)'}`,
          s.missingColumns.length > 0
            ? `missing columns: ${s.missingColumns.join(', ')}`
            : 'missing columns: (none)',
          s.extraColumns.length > 0
            ? `extra columns: ${s.extraColumns.join(', ')}`
            : 'extra columns: (none)',
          outcome.mode === 'dry-run' ? 'Re-run with --apply to upload.' : 'Upload complete.',
        ].join('\n'),
      );
    },
  });
}
