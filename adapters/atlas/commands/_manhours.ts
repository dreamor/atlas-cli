/**
 * API fetch layer for /yuntu-service/yida/manpower/ endpoints.
 *
 * Recon: 2026-06-06 — discovered from SPA bundle analysis of
 * `/manpowers/confirm/projectWeek` page. See docs/recon/manhour.md.
 */
import type { BanmaClient } from '../http/client.js';
import {
  ManpowerConfirmResultSchema,
  type ManpowerConfirmResult,
} from '../schema/models.js';

/** Status filter for the confirm detail endpoint. */
export type ConfirmStatus = 0 | 1;
// 0 = pending (待审批), 1 = approved (已审批)

export interface FetchManpowerConfirmOpts {
  readonly projectId: string;
  readonly month: string; // YYYY-MM
  readonly staffId: string;
  readonly status?: ConfirmStatus;
}

export interface FetchTeamProjectConfirmOpts {
  readonly projectId: string;
  readonly month: string; // YYYY-MM
  readonly status?: number;
}

export interface FetchProjectManpowerDetailOpts {
  readonly month: string; // YYYY-MM
  readonly staffId: string;
}

/**
 * Fetch the primary actual-hours confirmation tree for a project.
 * Endpoint: GET /yuntu-service/yida/manpower/getProjMpConfirmDetail.json
 *
 * Returns `{ hc, mp, projMp[], teamMp[] }` where teamMp is a recursive
 * tree of teams → staff with weekly actual hours data.
 */
export async function fetchManpowerConfirm(
  client: BanmaClient,
  opts: FetchManpowerConfirmOpts,
): Promise<ManpowerConfirmResult> {
  // IMPORTANT: `status` must be a number in the URL, not a string.
  // The server uses Zod validation that expects `z.number()`.
  const query: Record<string, string> = {
    month: opts.month,
    projectList: String(opts.projectId),
    staff_ID: String(opts.staffId),
  };
  if (opts.status !== undefined) {
    query.status = String(opts.status);
  }

  const { data } = await client.request<unknown>({
    path: '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    method: 'GET',
    query,
  });

  const parsed = ManpowerConfirmResultSchema.safeParse(data);
  if (!parsed.success) {
    // Return a best-effort result even if validation partially fails
    return data as ManpowerConfirmResult;
  }
  return parsed.data;
}

/**
 * Fetch project-level confirmation list (team-view).
 * Endpoint: GET /yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json
 *
 * Note: Returns errors in testing — may need specific permission or
 * different parameter formatting. Provided as a forward-compat layer.
 */
export async function fetchTeamProjectConfirm(
  client: BanmaClient,
  opts: FetchTeamProjectConfirmOpts,
): Promise<unknown> {
  const query: Record<string, string> = {
    month: opts.month,
    projectId: String(opts.projectId),
  };
  if (opts.status !== undefined) {
    query.status = String(opts.status);
  }

  const { data } = await client.request<unknown>({
    path: '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
    method: 'GET',
    query,
  });

  return data;
}

/**
 * Fetch per-staff manpower detail for a given month.
 * Endpoint: GET /yuntu-service/yida/manpower/getProjectManpowerDetail.json
 *
 * Note: Returns errors in testing — may require specific permissions.
 */
export async function fetchProjectManpowerDetail(
  client: BanmaClient,
  opts: FetchProjectManpowerDetailOpts,
): Promise<unknown> {
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    method: 'GET',
    query: {
      month: opts.month,
      staff_ID: String(opts.staffId),
    },
  });

  return data;
}
