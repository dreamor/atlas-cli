import type { LinePlan } from '../schema/models.js';
import type { Department, Dictionary } from '../schema/models.js';
import { resolveDept, resolveDict } from '../dict/resolve.js';

export interface DecoratedLinePlan {
  readonly id: string;
  readonly mp: string;
  readonly mpType: string;
  readonly linePlanType: string;
  readonly srcType: string;
  readonly department: string;
  readonly areaCode: string;
  readonly changeTime: string;
  readonly raw: LinePlan;
}

export function decorateLinePlan(
  item: LinePlan,
  dict: readonly Dictionary[],
  depts: readonly Department[],
): DecoratedLinePlan {
  const fmt = (label: string | undefined, code: unknown): string => {
    if (code === null || code === undefined || code === '') return '';
    return label ? `${label} (${code})` : String(code);
  };
  return {
    id: String(item.id),
    mp: item.mp === null || item.mp === undefined ? '' : String(item.mp),
    mpType: fmt(resolveDict(dict, 'mpType', item.mpType ?? null), item.mpType),
    linePlanType: fmt(
      resolveDict(dict, 'linePlanType', item.linePlanType ?? null),
      item.linePlanType,
    ),
    srcType: fmt(resolveDict(dict, 'srcType', item.srcType ?? null), item.srcType),
    department: fmt(resolveDept(depts, item.departmentId ?? null), item.departmentId),
    areaCode: item.areaCode ?? '',
    changeTime:
      item.changeTime === null || item.changeTime === undefined
        ? ''
        : String(item.changeTime),
    raw: item,
  };
}

export function renderTable(rows: readonly DecoratedLinePlan[]): string {
  if (rows.length === 0) return '(no items)';
  const cols: Array<{ key: keyof DecoratedLinePlan; header: string }> = [
    { key: 'id', header: 'ID' },
    { key: 'mp', header: 'MP' },
    { key: 'mpType', header: 'mpType' },
    { key: 'linePlanType', header: 'linePlanType' },
    { key: 'srcType', header: 'srcType' },
    { key: 'department', header: 'department' },
    { key: 'areaCode', header: 'area' },
    { key: 'changeTime', header: 'changeTime' },
  ];
  const widths = cols.map((c) =>
    Math.min(
      40,
      Math.max(c.header.length, ...rows.map((r) => String(r[c.key] ?? '').length)),
    ),
  );
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const header = cols
    .map((c, i) => String(c.header).padEnd(widths[i] ?? c.header.length))
    .join(' | ');
  const body = rows
    .map((r) =>
      cols
        .map((c, i) => {
          const v = String(r[c.key] ?? '');
          const w = widths[i] ?? v.length;
          return (v.length > w ? v.slice(0, w - 1) + '…' : v).padEnd(w);
        })
        .join(' | '),
    )
    .join('\n');
  return `${header}\n${sep}\n${body}`;
}
