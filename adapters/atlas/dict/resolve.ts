import type { Department, Dictionary } from '../schema/models.js';

/** Resolve dictionary code for a given `type` and `attrValue` to its `attrName`. */
export function resolveDict(
  dict: readonly Dictionary[],
  type: string | number,
  attrValue: string | number | null | undefined,
): string | undefined {
  if (attrValue === null || attrValue === undefined) return undefined;
  const t = String(type);
  const v = String(attrValue);
  for (const row of dict) {
    if (String(row.type) === t && String(row.attrValue ?? '') === v) {
      return row.attrName ?? undefined;
    }
  }
  return undefined;
}

/** Resolve a departmentId → deptName. Matches against `id` (numeric pk),
 * `deptCode` (e.g. "P3459") and `buCode` so callers can pass whichever
 * identifier the upstream payload happened to carry. */
export function resolveDept(
  depts: readonly Department[],
  id: string | number | null | undefined,
): string | undefined {
  if (id === null || id === undefined || id === '') return undefined;
  const target = String(id);
  for (const d of depts) {
    if (String(d.id) === target) return d.deptName ?? undefined;
    if (d.deptCode && String(d.deptCode) === target) return d.deptName ?? undefined;
    if (d.buCode && String(d.buCode) === target) return d.deptName ?? undefined;
  }
  return undefined;
}
