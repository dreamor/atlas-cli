/**
 * Pure logic for actual manpower (工时) data: tree flattening, filtering,
 * pivoting, and rendering. No I/O — fully testable.
 *
 * The API returns a nested tree (`teamMp`) where group nodes have `c[]`
 * children and leaf nodes have `weeklyActuals`. We flatten this into rows
 * suitable for tabular display and JSON output.
 */
import type {
  ManpowerTreeNode,
  ManpowerWeeklyActual,
} from '../schema/models.js';
import {
  epochMsToMonthKey,
  toManpower,
  type MonthKey,
  type MonthFilter,
} from './_month_logic.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A flattened staff row extracted from the teamMp tree. */
export interface ActualStaffRow {
  /** Staff ID (工号). */
  readonly staffId: string;
  /** Display name (姓名). */
  readonly staffName: string;
  /** Role / remark. */
  readonly role: string;
  /** Team leader staff ID (from nearest ancestor group node with a `d`). */
  readonly teamLeadId: string;
  /** Team leader display name. */
  readonly teamLeadName: string;
  /** Approval status: 0=pending, 1=approved, or unknown. */
  readonly status: number;
  /** Total hours for the month. */
  readonly total: number;
  /** Headcount. */
  readonly headcount: number;
  /** Weekly actuals map: YYYY-MM-DD (week start) → hours. */
  readonly weeks: ReadonlyArray<ManpowerWeeklyActual>;
}

/** Pivoted view: rows = staff, columns = weeks + total. */
export interface ActualPivotResult {
  readonly rows: ReadonlyArray<ActualPivotRow>;
  readonly weekColumns: ReadonlyArray<string>;
}

export interface ActualPivotRow {
  readonly staffId: string;
  readonly staffName: string;
  readonly role: string;
  readonly teamLeadId: string;
  readonly teamLeadName: string;
  readonly status: number;
  readonly weekHours: Record<string, number>;
  readonly total: number;
  readonly headcount: number;
}

/** Status filter for actual manhour queries. */
export type ActualStatusFilter = 'pending' | 'approved' | 'all';

// ---------------------------------------------------------------------------
// Tree flattening
// ---------------------------------------------------------------------------

/** Flatten the teamMp tree into a list of staff rows.
 * Walks the tree recursively, collecting leaf nodes (those with
 * weeklyActuals or no children). */
export function flattenManpowerTree(
  nodes: ReadonlyArray<ManpowerTreeNode>,
  parentLeadId: string = '',
  parentLeadName: string = '',
  status: number = 0,
): ReadonlyArray<ActualStaffRow> {
  const rows: ActualStaffRow[] = [];

  for (const node of nodes) {
    const d = String(node.d ?? '');
    const n = String(node.n ?? '');

    // If this node has children, recurse with this node as the team lead.
    if (node.c && node.c.length > 0) {
      const leadId = d || parentLeadId;
      const leadName = parseName(n) || parentLeadName;
      const childRows = flattenManpowerTree(node.c, leadId, leadName, node.s ?? status);
      rows.push(...childRows);
    } else {
      // Leaf node — this is an individual staff entry.
      rows.push({
        staffId: d,
        staffName: parseName(n),
        role: parseRole(node.r),
        teamLeadId: parentLeadId,
        teamLeadName: parentLeadName,
        status: node.s ?? status,
        total: node.t ?? 0,
        headcount: Number(node.h ?? 0),
        weeks: node.weeklyActuals ?? [],
      });
    }
  }

  return rows;
}

/** Parse display name from "姓名 - 工号" format. */
function parseName(raw: string): string {
  const sep = raw.indexOf(' - ');
  if (sep >= 0) return raw.substring(0, sep).trim();
  return raw.trim();
}

/** Parse role/remark field. The API returns `r` as either a string or
 * an object like `{ "2027": "" }` mapping projectId to role name.
 * When object, extract the first non-empty value. */
function parseRole(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object') {
    // Object like { "2027": "产品" } or { "2027": "" }
    const obj = raw as Record<string, unknown>;
    for (const val of Object.values(obj)) {
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return '';
  }
  return String(raw).trim();
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface ActualFilter {
  readonly department?: string;
  readonly role?: string;
  readonly staffName?: string;
  readonly status?: ActualStatusFilter;
}

/** Filter flattened rows by the given criteria (substring, case-insensitive). */
export function filterActualRows(
  rows: ReadonlyArray<ActualStaffRow>,
  filter: ActualFilter,
): ReadonlyArray<ActualStaffRow> {
  if (!filter.department && !filter.role && !filter.staffName && (!filter.status || filter.status === 'all')) {
    return rows;
  }

  return rows.filter((row) => {
    if (filter.status && filter.status !== 'all') {
      const want = filter.status === 'approved' ? 1 : 0;
      if (row.status !== want) return false;
    }
    if (filter.staffName) {
      const haystack = `${row.staffName} ${row.staffId}`.toLowerCase();
      if (!haystack.includes(filter.staffName.toLowerCase())) return false;
    }
    if (filter.role) {
      const haystack = `${row.role}`.toLowerCase();
      if (!haystack.includes(filter.role.toLowerCase())) return false;
    }
    if (filter.department) {
      // "department" in actual data maps to team lead; match against
      // team lead name + team lead ID.
      const haystack = `${row.teamLeadName} ${row.teamLeadId}`.toLowerCase();
      if (!haystack.includes(filter.department.toLowerCase())) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Pivoting
// ---------------------------------------------------------------------------

/** Pivot flat staff rows into a table: rows=staff, columns=weeks + total. */
export function pivotActualRows(
  rows: ReadonlyArray<ActualStaffRow>,
  filter: MonthFilter,
): ActualPivotResult {
  const weekSet = new Set<string>();

  const pivoted: ActualPivotRow[] = rows.map((row) => {
    const weekHours: Record<string, number> = {};
    let total = 0;

    for (const wa of row.weeks) {
      // Determine the period key from month+cycle or legacy startDate/week fields
      const periodKey = parsePeriodKey(wa);
      if (!periodKey) continue;

      // Apply month-range filter: extract YYYY-MM from the period key
      const monthPart = periodKey.includes('/')
        ? (periodKey.split('/')[0] ?? periodKey.substring(0, 7))
        : periodKey.substring(0, 7);
      if (filter.from && monthPart < filter.from) continue;
      if (filter.to && monthPart > filter.to) continue;

      const hours = parseManpower(wa);
      if (hours !== null && hours > 0) {
        weekHours[periodKey] = (weekHours[periodKey] ?? 0) + hours;
        total += hours;
        weekSet.add(periodKey);
      }
    }

    return {
      staffId: row.staffId,
      staffName: row.staffName,
      role: row.role,
      teamLeadId: row.teamLeadId,
      teamLeadName: row.teamLeadName,
      status: row.status,
      weekHours,
      total,
      headcount: row.headcount,
    };
  });

  const weekColumns = [...weekSet].sort();
  return { rows: pivoted, weekColumns };
}

/** Parse a key from a weeklyActuals entry for pivoting.
 * Uses `month` (epoch ms) + `cycle` to construct a unique period key like
 * "2026-05/c1" (first half) or "2026-05/c3" (second half).
 * Falls back to `startDate`/`week` for legacy data formats. */
function parsePeriodKey(wa: ManpowerWeeklyActual): string | null {
  // Primary: month + cycle (confirmed working format)
  if (wa.month !== null && wa.month !== undefined) {
    const monthKey = epochMsToMonthKey(wa.month);
    if (monthKey) {
      const cycle = wa.cycle ?? 1;
      return `${monthKey}/c${cycle}`;
    }
  }
  // Fallback: startDate (legacy)
  if (wa.startDate !== null && wa.startDate !== undefined) {
    const key = epochMsToWeekKey(wa.startDate);
    if (key) return key;
  }
  // Fallback: week field (legacy)
  if (wa.week !== null && wa.week !== undefined) {
    const key = epochMsToWeekKey(wa.week);
    if (key) return key;
  }
  return null;
}

/** Convert epoch ms to YYYY-MM-DD (week start date key). */
function epochMsToWeekKey(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Parse the manpower value from a weeklyActuals entry.
 * Prefers `manpower` field (confirmed format); falls back to `actualManpower`. */
function parseManpower(wa: ManpowerWeeklyActual): number | null {
  // Primary: `manpower` field (confirmed working format)
  if (wa.manpower !== null && wa.manpower !== undefined) {
    return toManpower(wa.manpower);
  }
  // Fallback: `actualManpower` (legacy field)
  if (wa.actualManpower !== null && wa.actualManpower !== undefined) {
    return toManpower(wa.actualManpower);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Render a pivoted actual-hours table to plain text. */
export function renderActualPivotTable(pivot: ActualPivotResult): string {
  if (pivot.rows.length === 0) return '(no rows)';
  if (pivot.weekColumns.length === 0) {
    return '(no week data in range)';
  }

  const headerCols = ['team lead', 'staff name', 'role', 'status', ...pivot.weekColumns, 'Total'];
  const rowTotals = pivot.rows.map((r) =>
    pivot.weekColumns.reduce((acc, w) => acc + (r.weekHours[w] ?? 0), 0),
  );
  const colTotals = pivot.weekColumns.map((w) =>
    pivot.rows.reduce((acc, r) => acc + (r.weekHours[w] ?? 0), 0),
  );
  const grandTotal = rowTotals.reduce((acc, n) => acc + n, 0);

  const cells: string[][] = pivot.rows.map((r, i) => [
    r.teamLeadName || r.teamLeadId || '',
    r.staffName || r.staffId || '',
    r.role,
    r.status === 1 ? '✓' : '⏳',
    ...pivot.weekColumns.map((w) => formatNum(r.weekHours[w])),
    formatNum(rowTotals[i]),
  ]);
  cells.push([
    'Total', '', '', '',
    ...colTotals.map((t) => formatNum(t)),
    formatNum(grandTotal),
  ]);

  return formatTable(headerCols, cells);
}

function formatNum(n: number | undefined): string {
  if (n === undefined || n === null) return '';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function formatTable(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
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

// ---------------------------------------------------------------------------
// Summary (by month / department / role)
// ---------------------------------------------------------------------------

export type ActualSummaryAxis = 'month' | 'department' | 'role';

export interface ActualSummaryEntry {
  readonly key: string;
  readonly label: string;
  readonly total: number;
}

/** Aggregate actual hours across all rows by the chosen axis. */
export function summarizeActual(
  rows: ReadonlyArray<ActualStaffRow>,
  axis: ActualSummaryAxis,
  filter: MonthFilter,
): ReadonlyArray<ActualSummaryEntry> {
  const buckets = new Map<string, { label: string; total: number }>();

  for (const row of rows) {
    for (const wa of row.weeks) {
      const periodKey = parsePeriodKey(wa);
      if (!periodKey) continue;

      const monthPart = periodKey.includes('/')
        ? (periodKey.split('/')[0] ?? periodKey.substring(0, 7))
        : periodKey.substring(0, 7);
      if (filter.from && monthPart < filter.from) continue;
      if (filter.to && monthPart > filter.to) continue;

      const hours = parseManpower(wa);
      if (hours === null || hours <= 0) continue;

      const bucketKey = actualBucketKeyFor(axis, row, monthPart);
      const label = actualBucketLabelFor(axis, row, monthPart);
      const prev = buckets.get(bucketKey);
      if (prev) {
        buckets.set(bucketKey, { label: prev.label, total: prev.total + hours });
      } else {
        buckets.set(bucketKey, { label, total: hours });
      }
    }
  }

  const entries = [...buckets.entries()].map(
    ([key, { label, total }]): ActualSummaryEntry => ({ key, label, total }),
  );
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return entries;
}

function actualBucketKeyFor(
  axis: ActualSummaryAxis,
  row: ActualStaffRow,
  weekKey: string,
): string {
  if (axis === 'month') return weekKey;
  if (axis === 'department') return `dept:${row.teamLeadId}`;
  return `role:${row.role}`;
}

function actualBucketLabelFor(
  axis: ActualSummaryAxis,
  row: ActualStaffRow,
  weekKey: string,
): string {
  if (axis === 'month') return weekKey;
  if (axis === 'department') {
    const id = row.teamLeadId;
    const name = row.teamLeadName;
    return name ? (id ? `${name} (${id})` : name) : id;
  }
  return row.role || '(no role)';
}

/** Render summary table to plain text. */
export function renderActualSummaryTable(
  axis: ActualSummaryAxis,
  entries: ReadonlyArray<ActualSummaryEntry>,
): string {
  if (entries.length === 0) return '(no data)';
  const headerLabel =
    axis === 'month' ? 'month' : axis === 'department' ? 'department' : 'role';
  const headerCols = [headerLabel, 'actual hours'];
  const cells = entries.map((e) => [e.label, formatNum(e.total)]);
  const grand = entries.reduce((acc, e) => acc + e.total, 0);
  cells.push(['Total', formatNum(grand)]);
  return formatTable(headerCols, cells);
}
