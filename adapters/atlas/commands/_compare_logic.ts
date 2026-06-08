/**
 * Pure comparison logic: baseline (计划) vs actual (实际) manpower.
 *
 * Consumes the same data structures used by `_month_logic.ts` (baseline)
 * and `_actual_logic.ts` (actual), then merges them into a unified
 * comparison view grouped by a chosen axis (month / department / role).
 *
 * No I/O — fully testable.
 */
import type {
  ActualStaffRow,
  ActualSummaryAxis,
  ActualSummaryEntry,
} from './_actual_logic.js';
import {
  summarizeActual,
  type ActualFilter,
} from './_actual_logic.js';
import {
  summarizeMonths,
  type DepartmentResolver,
  type MonthFilter,
  type SummaryAxis,
  type SummaryEntry,
} from './_month_logic.js';
import { toManpower } from './_month_logic.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompareAxis = 'month' | 'department' | 'role';

export interface CompareEntry {
  readonly key: string;
  label: string;
  readonly baseline: number;
  readonly actual: number;
  readonly diff: number;
  readonly diffPercent: number;
  readonly flag: 'overrun' | 'within_threshold' | 'under_threshold';
}

export interface CompareResult {
  readonly axis: CompareAxis;
  readonly entries: ReadonlyArray<CompareEntry>;
  readonly baselineTotal: number;
  readonly actualTotal: number;
  readonly grandDiff: number;
  readonly grandDiffPercent: number;
}

// ---------------------------------------------------------------------------
// Comparison engine
// ---------------------------------------------------------------------------

/**
 * Build a map key → SummaryEntry[] from summarizeMonths output,
 * so we can fold multiple rows (e.g. same department, different roles)
 * into a single baseline number per key.
 */
function groupBaselineEntries(
  entries: ReadonlyArray<SummaryEntry>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    const prev = map.get(e.key) ?? 0;
    map.set(e.key, prev + e.total);
  }
  return map;
}

/**
 * Build a map key → number from summarizeActual output,
 * folding multiple rows into a single actual number per key.
 */
function groupActualEntries(
  entries: ReadonlyArray<ActualSummaryEntry>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    const prev = map.get(e.key) ?? 0;
    map.set(e.key, prev + e.total);
  }
  return map;
}

/**
 * Compare baseline vs actual, producing a unified list of entries.
 *
 * - Keys present only in baseline → diff = -baseline (under)
 * - Keys present only in actual  → baseline = 0, diff = +actual (overrun)
 * - Keys in both                → diff = actual - baseline
 *
 * `threshold` is the absolute diff (hours) above which a row is flagged.
 * `flagOverrun` when true marks actual > baseline rows with 'overrun'.
 */
export function compareBaselines(
  baselineEntries: ReadonlyArray<SummaryEntry>,
  actualEntries: ReadonlyArray<ActualSummaryEntry>,
  threshold: number,
  flagOverrun: boolean,
): CompareEntry[] {
  const baseMap = groupBaselineEntries(baselineEntries);
  const actualMap = groupActualEntries(actualEntries);

  const allKeys = new Set([...baseMap.keys(), ...actualMap.keys()]);
  const entries: CompareEntry[] = [];

  for (const key of allKeys) {
    const baseline = baseMap.get(key) ?? 0;
    const actual = actualMap.get(key) ?? 0;
    const diff = actual - baseline;
    const diffPercent = baseline !== 0 ? (diff / baseline) * 100 : 0;

    let flag: CompareEntry['flag'];
    if (flagOverrun && diff > 0 && Math.abs(diff) > threshold) {
      flag = 'overrun';
    } else if (Math.abs(diff) > threshold) {
      flag = 'under_threshold';
    } else {
      flag = 'within_threshold';
    }

    entries.push({
      key,
      label: '', // filled by caller via label maps
      baseline,
      actual,
      diff,
      diffPercent,
      flag,
    });
  }

  // Stable sort: by key (month → asc, others → label asc)
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return entries;
}

// ---------------------------------------------------------------------------
// Label resolution
// ---------------------------------------------------------------------------

/**
 * Build a key → display label map from baseline summary entries.
 * These already have human-readable labels from `bucketLabelFor`.
 */
export function baselineLabelMap(
  entries: ReadonlyArray<SummaryEntry>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) {
    map.set(e.key, e.label);
  }
  return map;
}

/**
 * Build a key → display label map from actual summary entries.
 */
export function actualLabelMap(
  entries: ReadonlyArray<ActualSummaryEntry>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of entries) {
    map.set(e.key, e.label);
  }
  return map;
}

/**
 * Assign labels to compare entries, preferring baseline labels and
 * falling back to actual labels.
 */
export function assignCompareLabels(
  entries: CompareEntry[],
  baseLabels: Map<string, string>,
  actualLabels: Map<string, string>,
): void {
  for (const entry of entries) {
    entry.label =
      baseLabels.get(entry.key) ??
      actualLabels.get(entry.key) ??
      entry.key;
  }
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export interface CompareTotals {
  readonly baselineTotal: number;
  readonly actualTotal: number;
  readonly grandDiff: number;
  readonly grandDiffPercent: number;
}

export function computeCompareTotals(entries: CompareEntry[]): CompareTotals {
  const baselineTotal = entries.reduce((s, e) => s + e.baseline, 0);
  const actualTotal = entries.reduce((s, e) => s + e.actual, 0);
  const grandDiff = actualTotal - baselineTotal;
  const grandDiffPercent =
    baselineTotal !== 0 ? (grandDiff / baselineTotal) * 100 : 0;
  return { baselineTotal, actualTotal, grandDiff, grandDiffPercent };
}

// ---------------------------------------------------------------------------
// Rendering (ASCII table)
// ---------------------------------------------------------------------------

/** Render the comparison as a human-readable table. */
export function renderCompareTable(
  axis: CompareAxis,
  entries: ReadonlyArray<CompareEntry>,
  totals: CompareTotals,
): string {
  if (entries.length === 0) return '(no data)';

  const headerLabel =
    axis === 'month' ? 'month' : axis === 'department' ? 'department' : 'role';

  const headerCols = [
    headerLabel,
    'baseline(h)',
    'actual(h)',
    'diff(h)',
    'diff%',
    'flag',
  ];

  const cells = entries.map((e) => [
    e.label,
    String(e.baseline),
    String(e.actual),
    formatDiff(e.diff),
    formatPercent(e.diffPercent),
    flagIcon(e.flag),
  ]);

  // Totals row
  cells.push([
    'Total',
    String(totals.baselineTotal),
    String(totals.actualTotal),
    formatDiff(totals.grandDiff),
    formatPercent(totals.grandDiffPercent),
    '',
  ]);

  return formatTable(headerCols, cells);
}

function formatDiff(n: number): string {
  const sign = n > 0 ? '+' : '';
  return Number.isInteger(n) ? `${sign}${n}` : `${sign}${n.toFixed(2)}`;
}

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function flagIcon(flag: CompareEntry['flag']): string {
  if (flag === 'overrun') return '⚠️';
  if (flag === 'under_threshold') return '↓';
  return '';
}

function formatTable(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const widths = headers.map((h, i) =>
    Math.min(40, Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))),
  );
  const sep = widths.map((w) => '─'.repeat(w)).join('─┼─');
  const pad = (v: string, w: number): string =>
    v.length > w ? v.slice(0, w - 1) + '…' : v.padEnd(w);
  const headerLine = headers.map((h, i) => pad(h, widths[i] ?? h.length)).join(' │ ');
  const body = rows
    .map((r) => r.map((c, i) => pad(c ?? '', widths[i] ?? (c ?? '').length)).join(' │ '))
    .join('\n');
  return `${headerLine}\n${sep}\n${body}`;
}

// ---------------------------------------------------------------------------
// High-level orchestration
// ---------------------------------------------------------------------------

/** Options for the compare command (already validated at CLI level). */
export interface CompareOptions {
  readonly axis: CompareAxis;
  readonly from?: string;
  readonly to?: string;
  readonly department?: string;
  readonly role?: string;
  readonly status?: 'pending' | 'approved' | 'all';
  readonly threshold: number;
  readonly flagOverrun: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface ComparePage {
  readonly entries: ReadonlyArray<CompareEntry>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

/**
 * Paginate compare entries.
 * Returns a slice of entries and pagination metadata.
 * Pages are 1-based; pageSize must be >= 1.
 */
export function paginateCompareEntries(
  entries: ReadonlyArray<CompareEntry>,
  page: number,
  pageSize: number,
): ComparePage {
  const total = entries.length;
  const totalPages = Math.ceil(total / pageSize);
  const clampedPage = Math.max(1, Math.min(page, totalPages || 1));
  const start = (clampedPage - 1) * pageSize;
  const end = start + pageSize;
  const pageEntries = entries.slice(start, end);

  return {
    entries: pageEntries,
    total,
    page: clampedPage,
    pageSize,
    totalPages,
  };
}

/**
 * Merge baseline & actual summaries into a CompareResult.
 * This is the main entry point used by `compareCmd`.
 */
export function buildCompareResult(
  baselineEntries: ReadonlyArray<SummaryEntry>,
  actualEntries: ReadonlyArray<ActualSummaryEntry>,
  opts: CompareOptions,
): CompareResult {
  const entries = compareBaselines(
    baselineEntries,
    actualEntries,
    opts.threshold,
    opts.flagOverrun,
  );

  const baseLabels = baselineLabelMap(baselineEntries);
  const actualLabels = actualLabelMap(actualEntries);
  assignCompareLabels(entries, baseLabels, actualLabels);

  const totals = computeCompareTotals(entries);

  return {
    axis: opts.axis,
    entries,
    baselineTotal: totals.baselineTotal,
    actualTotal: totals.actualTotal,
    grandDiff: totals.grandDiff,
    grandDiffPercent: totals.grandDiffPercent,
  };
}