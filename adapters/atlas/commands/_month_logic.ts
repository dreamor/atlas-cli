import type { LinePlanMonth, LinePlanMonthDetail } from '../schema/models.js';

/** YYYY-MM key for grouping. */
export type MonthKey = string;

export interface MonthFilter {
  readonly from?: string; // 'YYYY-MM' inclusive
  readonly to?: string;   // 'YYYY-MM' inclusive
}

export interface RowFilter {
  readonly department?: string; // substring, case-insensitive, vs. resolved name + id
  readonly role?: string;       // substring, case-insensitive, vs. role + remark
  readonly areaCode?: string;   // substring, case-insensitive, vs. areaCode
  readonly mpType?: string;     // substring, case-insensitive, vs. mpType
}

/** Convert epoch-ms (number or numeric string) to 'YYYY-MM'. Returns null
 * if the value cannot be coerced to a finite date. */
export function epochMsToMonthKey(raw: unknown): MonthKey | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Coerce a manpower cell to number. Empty/invalid → null. */
export function toManpower(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Inclusive month-range filter. Strings compare lexicographically when
 * shape is YYYY-MM. */
export function isMonthInRange(month: MonthKey, range: MonthFilter): boolean {
  if (range.from && month < range.from) return false;
  if (range.to && month > range.to) return false;
  return true;
}

export interface PivotedRow {
  readonly id: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly role: string;
  readonly remark: string;
  readonly areaCode: string;
  readonly mpType: string;
  /** Map of YYYY-MM → manpower (excluding nulls). */
  readonly months: Record<MonthKey, number>;
}

export interface PivotResult {
  readonly rows: ReadonlyArray<PivotedRow>;
  readonly monthColumns: ReadonlyArray<MonthKey>;
}

export type DepartmentResolver = (id: unknown) => string;

const includesCi = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

/** Filter source rows by department / role / areaCode / mpType (substring, case-insensitive). */
export function applyRowFilter(
  rows: ReadonlyArray<LinePlanMonth>,
  filter: RowFilter,
  resolveDepartment: DepartmentResolver,
): ReadonlyArray<LinePlanMonth> {
  if (!filter.department && !filter.role && !filter.areaCode && !filter.mpType) return rows;
  return rows.filter((row) => {
    if (filter.department) {
      const id = String(row.departmentId ?? '');
      const name = resolveDepartment(row.departmentId);
      const blob = `${name} ${id}`;
      if (!includesCi(blob, filter.department)) return false;
    }
    if (filter.role) {
      const blob = `${row.role ?? ''} ${row.remark ?? ''}`;
      if (!includesCi(blob, filter.role)) return false;
    }
    if (filter.areaCode) {
      const area = String(row.areaCode ?? '');
      if (!includesCi(area, filter.areaCode)) return false;
    }
    if (filter.mpType) {
      const mp = String(row.mpType ?? '');
      if (!includesCi(mp, filter.mpType)) return false;
    }
    return true;
  });
}

/** Build a pivoted view: rows = (dept, role, remark), columns = months. */
export function pivotMonths(
  rows: ReadonlyArray<LinePlanMonth>,
  filter: MonthFilter,
  resolveDepartment: DepartmentResolver,
): PivotResult {
  const monthSet = new Set<MonthKey>();
  const pivoted: PivotedRow[] = rows.map((row) => {
    const months: Record<MonthKey, number> = {};
    const detailList: ReadonlyArray<LinePlanMonthDetail> =
      row.linePlanMonthDetailList ?? [];
    for (const detail of detailList) {
      const key = epochMsToMonthKey(detail.month);
      if (!key) continue;
      if (!isMonthInRange(key, filter)) continue;
      const mp = toManpower(detail.manpower);
      if (mp === null) continue;
      months[key] = (months[key] ?? 0) + mp;
      monthSet.add(key);
    }
    return {
      id: String(row.id),
      departmentId: row.departmentId === null || row.departmentId === undefined
        ? ''
        : String(row.departmentId),
      departmentName: resolveDepartment(row.departmentId),
      role: row.role ?? '',
      remark: row.remark ?? '',
      areaCode: row.areaCode ?? '',
      mpType: String(row.mpType ?? ''),
      months,
    };
  });
  const monthColumns = [...monthSet].sort();
  return { rows: pivoted, monthColumns };
}

const EPSILON = 1e-9;

/** Drop rows whose every month value is ≈0 and columns where every row is ≈0.
 * Empty cells are treated as 0. */
export function dropAllZero(p: PivotResult): PivotResult {
  const liveRows = p.rows.filter((r) =>
    p.monthColumns.some((m) => Math.abs(r.months[m] ?? 0) > EPSILON),
  );
  const liveColumns = p.monthColumns.filter((m) =>
    liveRows.some((r) => Math.abs(r.months[m] ?? 0) > EPSILON),
  );
  return { rows: liveRows, monthColumns: liveColumns };
}

export type SummaryAxis = 'month' | 'department' | 'role';

export interface SummaryEntry {
  readonly key: string;
  readonly label: string;
  readonly total: number;
}

export interface SummarizeOpts {
  readonly by: SummaryAxis;
  readonly filter: MonthFilter;
  readonly resolveDepartment: DepartmentResolver;
}

/** Aggregate total manpower across all rows by the chosen axis. */
export function summarizeMonths(
  rows: ReadonlyArray<LinePlanMonth>,
  opts: SummarizeOpts,
): ReadonlyArray<SummaryEntry> {
  const buckets = new Map<string, { label: string; total: number }>();

  for (const row of rows) {
    const detailList: ReadonlyArray<LinePlanMonthDetail> =
      row.linePlanMonthDetailList ?? [];
    for (const detail of detailList) {
      const key = epochMsToMonthKey(detail.month);
      if (!key) continue;
      if (!isMonthInRange(key, opts.filter)) continue;
      const mp = toManpower(detail.manpower);
      if (mp === null) continue;

      const bucketKey = bucketKeyFor(opts.by, row, key);
      const label = bucketLabelFor(opts.by, row, key, opts.resolveDepartment);
      const prev = buckets.get(bucketKey);
      if (prev) {
        buckets.set(bucketKey, { label: prev.label, total: prev.total + mp });
      } else {
        buckets.set(bucketKey, { label, total: mp });
      }
    }
  }

  const entries = [...buckets.entries()].map(
    ([key, { label, total }]): SummaryEntry => ({ key, label, total }),
  );

  // Stable ordering: month → asc, others → label asc
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return entries;
}

function bucketKeyFor(
  axis: SummaryAxis,
  row: LinePlanMonth,
  monthKey: MonthKey,
): string {
  if (axis === 'month') return monthKey;
  if (axis === 'department') return `dept:${String(row.departmentId ?? '')}`;
  return `role:${row.role ?? ''}`;
}

function bucketLabelFor(
  axis: SummaryAxis,
  row: LinePlanMonth,
  monthKey: MonthKey,
  resolveDepartment: DepartmentResolver,
): string {
  if (axis === 'month') return monthKey;
  if (axis === 'department') {
    const id = String(row.departmentId ?? '');
    const name = resolveDepartment(row.departmentId);
    return name ? (id ? `${name} (${id})` : name) : id;
  }
  return row.role ?? '(no role)';
}

/** Render a pivoted month table to plain text (no external deps).
 * Appends a per-row Total column and a column-totals footer row. */
export function renderPivotTable(pivot: PivotResult): string {
  if (pivot.rows.length === 0) return '(no rows)';
  if (pivot.monthColumns.length === 0) {
    return '(no months in range)';
  }
  const headerCols = ['department', 'role', 'area', 'mpType', 'remark', ...pivot.monthColumns, 'Total'];
  const rowTotals = pivot.rows.map((r) =>
    pivot.monthColumns.reduce((acc, m) => acc + (r.months[m] ?? 0), 0),
  );
  const colTotals = pivot.monthColumns.map((m) =>
    pivot.rows.reduce((acc, r) => acc + (r.months[m] ?? 0), 0),
  );
  const grandTotal = rowTotals.reduce((acc, n) => acc + n, 0);

  const cells: string[][] = pivot.rows.map((r, i) => [
    r.departmentName || r.departmentId || '',
    r.role,
    r.areaCode,
    r.mpType,
    r.remark,
    ...pivot.monthColumns.map((m) => formatNum(r.months[m])),
    formatNum(rowTotals[i]),
  ]);
  cells.push([
    'Total',
    '',
    '',
    '',
    '',
    ...colTotals.map((t) => formatNum(t)),
    formatNum(grandTotal),
  ]);
  return formatTable(headerCols, cells);
}

export function renderSummaryTable(
  axis: SummaryAxis,
  entries: ReadonlyArray<SummaryEntry>,
): string {
  if (entries.length === 0) return '(no data)';
  const headerLabel =
    axis === 'month' ? 'month' : axis === 'department' ? 'department' : 'role';
  const headerCols = [headerLabel, 'total manpower'];
  const cells = entries.map((e) => [e.label, formatNum(e.total)]);
  const grand = entries.reduce((acc, e) => acc + e.total, 0);
  cells.push(['Total', formatNum(grand)]);
  return formatTable(headerCols, cells);
}

function formatNum(n: number | undefined): string {
  if (n === undefined) return '';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatTable(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const widths = headers.map((h, i) =>
    Math.min(40, Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))),
  );
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const pad = (v: string, w: number): string =>
    v.length > w ? v.slice(0, w - 1) + '…' : v.padEnd(w);
  const headerLine = headers.map((h, i) => pad(h, widths[i] ?? h.length)).join(' | ');
  const body = rows
    .map((r) => r.map((c, i) => pad(c ?? '', widths[i] ?? (c ?? '').length)).join(' | '))
    .join('\n');
  return `${headerLine}\n${sep}\n${body}`;
}
