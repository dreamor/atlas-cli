/**
 * API fetch layer for /yuntu-service/manpower/weekly/ endpoints.
 *
 * 新 API 直接返回人月 (person-months)，无需 /22 转换。
 */
import type { BanmaClient } from '../http/client.js';
import { WeeklySummaryResultSchema, type WeeklySummaryResult } from '../schema/models.js';
import { type ManpowerConfirmResult } from '../schema/models.js';

// ---------------------------------------------------------------------------
// 新 API: /yuntu-service/manpower/weekly/summaryByTeam.json
// ---------------------------------------------------------------------------

export interface FetchWeeklySummaryOpts {
  readonly month: string;          // YYYY-MM
  readonly staffId: string;        // 当前登录用户的 empId
  readonly projectIds?: readonly string[];
  readonly isConfirm?: boolean;    // false=全量, true=仅已确认
}

/**
 * Fetch actual manpower summary by team for a given month.
 * Returns data in 人月 (person-months) directly — no /22 conversion needed.
 */
export async function fetchWeeklySummary(
  client: BanmaClient,
  opts: FetchWeeklySummaryOpts,
): Promise<WeeklySummaryResult> {
  const body = {
    month: opts.month,
    staffIds: [],
    projectIds: opts.projectIds ?? [],
    isConfirm: opts.isConfirm ?? false,
    loginStaffId: opts.staffId,
  };
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/manpower/weekly/summaryByTeam.json',
    method: 'POST',
    body,
  });
  const parsed = WeeklySummaryResultSchema.safeParse(data);
  if (!parsed.success) return data as WeeklySummaryResult;
  return parsed.data;
}

// ---------------------------------------------------------------------------
// @deprecated 旧 API — 仅用于 E2E 测试 mock，勿在新代码中使用。
// 新命令应使用 fetchWeeklySummary 替代。
// ---------------------------------------------------------------------------

/** @deprecated 使用 fetchWeeklySummary */
export interface FetchManpowerConfirmOpts {
  readonly projectId: string;
  readonly month: string;
  readonly staffId: string;
  readonly status?: number;
}

/** @deprecated 使用 fetchWeeklySummary */
export async function fetchManpowerConfirm(
  client: BanmaClient,
  opts: FetchManpowerConfirmOpts,
): Promise<ManpowerConfirmResult> {
  const query: Record<string, string> = {
    month: opts.month,
    projectList: String(opts.projectId),
    staff_ID: String(opts.staffId),
  };
  if (opts.status !== undefined) query.status = String(opts.status);
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json',
    method: 'GET',
    query,
  });
  return data as ManpowerConfirmResult;
}

/** @deprecated 使用 fetchWeeklySummary */
export interface FetchTeamProjectConfirmOpts {
  readonly projectId: string;
  readonly month: string;
  readonly status?: number;
}

/** @deprecated 使用 fetchWeeklySummary */
export async function fetchTeamProjectConfirm(
  client: BanmaClient,
  opts: FetchTeamProjectConfirmOpts,
): Promise<unknown> {
  const query: Record<string, string> = { month: opts.month, projectId: String(opts.projectId) };
  if (opts.status !== undefined) query.status = String(opts.status);
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json',
    method: 'GET',
    query,
  });
  return data;
}

/** @deprecated 使用 fetchWeeklySummary */
export interface FetchProjectManpowerDetailOpts {
  readonly month: string;
  readonly staffId: string;
}

/** @deprecated 使用 fetchWeeklySummary */
export async function fetchProjectManpowerDetail(
  client: BanmaClient,
  opts: FetchProjectManpowerDetailOpts,
): Promise<unknown> {
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/yida/manpower/getProjectManpowerDetail.json',
    method: 'GET',
    query: { month: opts.month, staff_ID: String(opts.staffId) },
  });
  return data;
}