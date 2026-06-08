import { z } from 'zod';

/**
 * Standard Banma envelope:
 *   { status: 1, code: 1, errCode: "1", errorMsg: null, success: true, data: ... }
 * Slim envelope:
 *   { status: 1, data: ... }
 *
 * We use a permissive schema and unwrap in `unwrapEnvelope`.
 */
export const EnvelopeSchema = z
  .object({
    status: z.union([z.number(), z.string()]).optional(),
    code: z.number().optional(),
    errCode: z.union([z.string(), z.number()]).optional().nullable(),
    errorMsg: z.string().optional().nullable(),
    success: z.boolean().optional(),
    data: z.unknown().optional(),
  })
  .passthrough();

export type Envelope = z.infer<typeof EnvelopeSchema>;

export function isEnvelopeSuccess(env: Envelope): boolean {
  // Standard envelope: success === true && code === 1
  if (env.success === true && env.code === 1) return true;
  // Slim envelope: status === 1 with no `success` field present
  if (env.success === undefined && env.status === 1) return true;
  return false;
}

/** Forward-compat paginated wrapper: server may return either an array OR
 * `{ list, total, pageNum, pageSize, hasMore }`.
 */
export const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.union([
    z.array(item),
    z
      .object({
        list: z.array(item).default([]),
        total: z.number().optional(),
        pageNum: z.number().optional(),
        pageSize: z.number().optional(),
        hasMore: z.boolean().optional(),
      })
      .passthrough(),
  ]);

export interface PaginatedResult<T> {
  items: T[];
  total: number | undefined;
  pageNum: number | undefined;
  pageSize: number | undefined;
  hasMore: boolean | undefined;
}

export function normalizePaginated<T>(raw: unknown, items: T[]): PaginatedResult<T> {
  if (Array.isArray(raw)) {
    return {
      items,
      total: items.length,
      pageNum: undefined,
      pageSize: undefined,
      hasMore: false,
    };
  }
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    items,
    total: typeof obj.total === 'number' ? obj.total : undefined,
    pageNum: typeof obj.pageNum === 'number' ? obj.pageNum : undefined,
    pageSize: typeof obj.pageSize === 'number' ? obj.pageSize : undefined,
    hasMore: typeof obj.hasMore === 'boolean' ? obj.hasMore : undefined,
  };
}
