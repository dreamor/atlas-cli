import type { BanmaClient } from '../http/client.js';
import {
  LinePlanSchema,
  LinePlanMonthSchema,
  type LinePlan,
  type LinePlanMonth,
} from '../schema/models.js';
import { normalizePaginated, type PaginatedResult } from '../schema/envelope.js';

export interface ListLinePlansOpts {
  readonly projectId: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export async function fetchLinePlans(
  client: BanmaClient,
  opts: ListLinePlansOpts,
): Promise<PaginatedResult<LinePlan>> {
  const body: Record<string, unknown> = { projectId: String(opts.projectId) };
  if (opts.page !== undefined) body.pageNum = opts.page;
  if (opts.pageSize !== undefined) body.pageSize = opts.pageSize;

  const { data } = await client.request<unknown>({
    path: '/yuntu-service/line/plan/select.json',
    method: 'POST',
    body,
  });

  // data is either an array (current behaviour) or { list, total, ... } (forward-compat)
  const rawArray: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { list?: unknown }).list)
      ? ((data as { list: unknown[] }).list ?? [])
      : [];

  const items: LinePlan[] = rawArray
    .map((row) => {
      const r = LinePlanSchema.safeParse(row);
      return r.success ? r.data : null;
    })
    .filter((x): x is LinePlan => x !== null);

  return normalizePaginated(data, items);
}

export interface SaveLinePlansOpts {
  readonly projectId: string;
}

export interface SaveLinePlansResult {
  readonly raw: unknown;
  readonly count: number;
}

/**
 * Upsert one or more LinePlan rows. Rows with `id` are updates, those without
 * are inserts. Body shape inferred from static recon (see docs/recon §10).
 *
 * IMPORTANT: This is a mutating endpoint. Callers MUST gate on `--apply` and
 * default to dry-run.
 */
export async function saveLinePlans(
  client: BanmaClient,
  opts: SaveLinePlansOpts,
  payload: ReadonlyArray<Record<string, unknown>>,
): Promise<SaveLinePlansResult> {
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/line/plan/save.json',
    method: 'POST',
    query: { projectId: String(opts.projectId) },
    body: payload,
  });
  return { raw: data, count: payload.length };
}

/**
 * Fetch the monthly aggregate view (人力基线汇总). Each row is a
 * (department, role, remark) tuple carrying a list of per-month manpower
 * entries in `linePlanMonthDetailList`.
 */
export async function fetchLinePlanMonths(
  client: BanmaClient,
  opts: ListLinePlansOpts,
): Promise<PaginatedResult<LinePlanMonth>> {
  const body: Record<string, unknown> = { projectId: String(opts.projectId) };
  if (opts.page !== undefined) body.pageNum = opts.page;
  if (opts.pageSize !== undefined) body.pageSize = opts.pageSize;

  const { data } = await client.request<unknown>({
    path: '/yuntu-service/line/plan/month/select.json',
    method: 'POST',
    body,
  });

  const rawArray: unknown[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { list?: unknown }).list)
      ? ((data as { list: unknown[] }).list ?? [])
      : [];

  const items: LinePlanMonth[] = rawArray
    .map((row) => {
      const r = LinePlanMonthSchema.safeParse(row);
      return r.success ? r.data : null;
    })
    .filter((x): x is LinePlanMonth => x !== null);

  return normalizePaginated(data, items);
}

/**
 * Upsert one or more LinePlanMonth rows. Mirrors `saveLinePlans` but posts
 * to `line/plan/month/save.json`. Callers MUST gate on `--apply`.
 */
export async function saveLinePlanMonths(
  client: BanmaClient,
  opts: SaveLinePlansOpts,
  payload: ReadonlyArray<Record<string, unknown>>,
): Promise<SaveLinePlansResult> {
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/line/plan/month/save.json',
    method: 'POST',
    query: { projectId: String(opts.projectId) },
    body: payload,
  });
  return { raw: data, count: payload.length };
}
