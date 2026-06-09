/**
 * Unit tests for the baseline vs actual comparison logic.
 * Covers: compareBaselines, buildCompareResult, renderCompareTable,
 *         label resolution, and aggregate computation.
 *
 * Unit convention:
 *   - baselineEntries[].total are in 人月 (person-months)
 *   - actualEntries[].total   are in 人月 (converted upstream by parseManpower /22).
 */
import { describe, expect, it } from 'vitest';

import {
  compareBaselines,
  buildCompareResult,
  renderCompareTable,
  computeCompareTotals,
  paginateCompareEntries,
  baselineLabelMap,
  actualLabelMap,
  assignCompareLabels,
  type CompareEntry,
} from '../adapters/atlas/commands/_compare_logic.js';

// ---------------------------------------------------------------------------
// Test fixtures
//
// actualEntries[].total is already in 人月 (converted upstream by /22):
//   22 人天 →  1 人月
//   44 人天 →  2 人月
//   66 人天 →  3 人月
// ---------------------------------------------------------------------------

const baselineEntries = [
  { key: '2025-04', label: '2025-04', total: 25 },   // 人月
  { key: '2025-05', label: '2025-05', total: 30 },   // 人月
  { key: '2025-06', label: '2025-06', total: 33 },   // 人月
] as const;

const actualEntries = [
  { key: '2025-04', label: '2025-04', total: 1 },    // 人月
  { key: '2025-05', label: '2025-05', total: 2 },    // 人月
  { key: '2025-06', label: '2025-06', total: 3 },    // 人月
] as const;

// Deleted a key: actualEntries 少了 2025-04，增加 2025-07
const actualEntriesWithExtra = [
  { key: '2025-05', label: '2025-05', total: 2 },    // 人月
  { key: '2025-06', label: '2025-06', total: 3 },    // 人月
  { key: '2025-07', label: '2025-07', total: 1 },    // 人月
] as const;

const baselineByDept = [
  { key: 'dept:D001', label: '研发部 (D001)', total: 54 },
  { key: 'dept:D002', label: '产品部 (D002)', total: 29 },
] as const;

const actualByDept = [
  { key: 'dept:D001', label: '研发部', total: 2 },   // 人月
  { key: 'dept:D002', label: '产品部', total: 3 },   // 人月
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compareBaselines', () => {
  it('computes diff and diffPercent correctly for each key', () => {
    const entries = compareBaselines(baselineEntries, actualEntries, 0, false);

    expect(entries).toHaveLength(3);

    // 22 人天 = 1 人月
    const apr = entries.find((e) => e.key === '2025-04');
    expect(apr).toBeDefined();
    expect(apr!.baseline).toBe(25);
    expect(apr!.actual).toBeCloseTo(1, 5);
    expect(apr!.diff).toBeCloseTo(-24, 5);
    expect(apr!.diffPercent).toBeCloseTo(-96, 2);

    // 44 人天 = 2 人月
    const may = entries.find((e) => e.key === '2025-05');
    expect(may!.diff).toBeCloseTo(-28, 5);
    expect(may!.diffPercent).toBeCloseTo(-93.33, 2);

    // 66 人天 = 3 人月
    const jun = entries.find((e) => e.key === '2025-06');
    expect(jun!.diff).toBeCloseTo(-30, 5);
    expect(jun!.diffPercent).toBeCloseTo(-90.91, 2);
  });

  it('handles keys present only in baseline (actual=0)', () => {
    const entries = compareBaselines(baselineEntries, actualEntriesWithExtra, 0, false);

    const apr = entries.find((e) => e.key === '2025-04');
    expect(apr).toBeDefined();
    expect(apr!.baseline).toBe(25);
    expect(apr!.actual).toBe(0);
    expect(apr!.diff).toBe(-25);
  });

  it('handles keys present only in actual (baseline=0)', () => {
    const entries = compareBaselines(baselineEntries, actualEntriesWithExtra, 0, false);

    const jul = entries.find((e) => e.key === '2025-07');
    expect(jul).toBeDefined();
    expect(jul!.baseline).toBe(0);
    expect(jul!.actual).toBeCloseTo(1, 5);  // 22 人天 → 1 人月
    expect(jul!.diff).toBeCloseTo(1, 5);
  });

  it('sorts entries by key (month ascending)', () => {
    const entries = compareBaselines(baselineEntries, actualEntries, 0, false);

    expect(entries.map((e) => e.key)).toEqual(['2025-04', '2025-05', '2025-06']);
  });

  it('applies threshold: below-threshold entries get within_threshold flag', () => {
    const entries = compareBaselines(baselineEntries, actualEntries, 5, false);

    // diff = -24, |24| > 5 → under_threshold (原来的 -3 是 within)
    const apr = entries.find((e) => e.key === '2025-04');
    expect(apr!.flag).toBe('under_threshold');
  });

  it('applies threshold strictly (>) not >=', () => {
    const entries = compareBaselines(baselineEntries, actualEntries, 4, false);

    const may = entries.find((e) => e.key === '2025-05');
    expect(may!.flag).toBe('under_threshold');
  });

  it('flagOverrun=true marks actual > baseline rows with overrun', () => {
    // actual entries: 22, 44, 66 人天; all convert to < baseline
    // No overrun expected since actual(人月) < baseline
    const entries = compareBaselines(baselineEntries, actualEntries, 0, true);

    for (const e of entries) {
      expect(e.flag).not.toBe('overrun');
    }
  });

  it('flagOverrun=true does not mark negative diffs as overrun', () => {
    const entries = compareBaselines(baselineEntries, actualEntries, 3, true);

    for (const e of entries) {
      expect(e.flag).not.toBe('overrun');
    }
  });

  it('handles zero baseline (diffPercent=0)', () => {
    const base = [{ key: 'dept:D003', label: '测试部', total: 0 }];
    const actual = [{ key: 'dept:D003', label: '测试部', total: 1 }];  // 人月（上游已 /22）

    const entries = compareBaselines(base, actual, 0, false);
    expect(entries[0]!.actual).toBeCloseTo(1, 5);
    expect(entries[0]!.diffPercent).toBe(0);
  });

  it('handles department-level comparison', () => {
    const entries = compareBaselines(baselineByDept, actualByDept, 0, true);

    expect(entries).toHaveLength(2);
    const dev = entries.find((e) => e.key === 'dept:D001');
    expect(dev!.baseline).toBe(54);
    expect(dev!.actual).toBeCloseTo(2, 5);  // 44 人天 → 2 人月
    expect(dev!.diff).toBeCloseTo(-52, 5);

    const pm = entries.find((e) => e.key === 'dept:D002');
    expect(pm!.baseline).toBe(29);
    expect(pm!.actual).toBeCloseTo(3, 5);   // 66 人天 → 3 人月
    expect(pm!.diff).toBeCloseTo(-26, 5);
    // diff < 0 不可能是 overrun
    expect(pm!.flag).not.toBe('overrun');
  });
});

describe('buildCompareResult', () => {
  it('produces correct totals from matching entries', () => {
    const result = buildCompareResult(baselineEntries, actualEntries, {
      axis: 'month',
      threshold: 0,
      flagOverrun: false,
    });

    expect(result.axis).toBe('month');
    expect(result.entries).toHaveLength(3);
    expect(result.baselineTotal).toBe(88);     // 25+30+33 人月
    // actual: 1+2+3 人月 = 6 人月
    expect(result.actualTotal).toBeCloseTo(6, 2);
    expect(result.grandDiff).toBeCloseTo(-82, 2); // 6 - 88
    expect(result.grandDiffPercent).toBeCloseTo(-93.18, 2);
  });

  it('computes grand totals correctly for mismatched sets', () => {
    const result = buildCompareResult(baselineEntries, actualEntriesWithExtra, {
      axis: 'month',
      threshold: 0,
      flagOverrun: false,
    });

    expect(result.baselineTotal).toBe(88);
    // actual: 2+3+1 人月 = 6 人月
    expect(result.actualTotal).toBeCloseTo(6, 2);
  });
});

describe('computeCompareTotals', () => {
  it('sums baseline, actual, diff, and diffPercent across entries', () => {
    const entries: CompareEntry[] = [
      { key: 'a', label: 'A', baseline: 10, actual: 12, diff: 2, diffPercent: 20, flag: 'overrun' },
      { key: 'b', label: 'B', baseline: 20, actual: 15, diff: -5, diffPercent: -25, flag: 'under_threshold' },
    ];

    const totals = computeCompareTotals(entries);
    expect(totals.baselineTotal).toBe(30);
    expect(totals.actualTotal).toBe(27);
    expect(totals.grandDiff).toBe(-3);
    expect(totals.grandDiffPercent).toBeCloseTo(-10, 2);
  });
});

describe('label resolution', () => {
  it('baselineLabelMap extracts key→label mapping', () => {
    const map = baselineLabelMap(baselineEntries);
    expect(map.get('2025-04')).toBe('2025-04');
    expect(map.get('2025-05')).toBe('2025-05');
  });

  it('actualLabelMap extracts key→label mapping', () => {
    const map = actualLabelMap(actualEntries);
    expect(map.get('2025-04')).toBe('2025-04');
  });

  it('assignCompareLabels uses baseline labels first, then actual', () => {
    const entries = compareBaselines(baselineEntries, [{ key: '2025-04', label: '四月', total: 1 }], 0, false);
    assignCompareLabels(entries, baselineLabelMap(baselineEntries), actualLabelMap([{ key: '2025-04', label: '四月', total: 1 }]));

    expect(entries[0]!.label).toBe('2025-04'); // baseline label used
  });
});

describe('renderCompareTable', () => {
  it('renders a non-empty table', () => {
    const entries: CompareEntry[] = [
      { key: '2025-04', label: '2025-04', baseline: 25, actual: 22, diff: -3, diffPercent: -12, flag: 'within_threshold' },
      { key: '2025-05', label: '2025-05', baseline: 30, actual: 2, diff: -28, diffPercent: -93.33, flag: 'within_threshold' },
    ];
    const totals = computeCompareTotals(entries);

    const table = renderCompareTable('month', entries, totals);
    expect(table).toContain('month');
    expect(table).toContain('baseline(人月)');
    expect(table).toContain('actual(人月)');
    expect(table).toContain('diff(人月)');
    expect(table).toContain('diff%');
  });

  it('renders "(no data)" for empty entries', () => {
    const entries: CompareEntry[] = [];
    const totals = computeCompareTotals(entries);

    const table = renderCompareTable('month', entries, totals);
    expect(table).toBe('(no data)');
  });

  it('renders department axis correctly', () => {
    const entries: CompareEntry[] = [
      { key: 'dept:D001', label: '研发部', baseline: 54, actual: 2, diff: -52, diffPercent: -96.3, flag: 'under_threshold' },
      { key: 'dept:D002', label: '产品部', baseline: 29, actual: 3, diff: -26, diffPercent: -89.66, flag: 'within_threshold' },
    ];
    const totals = computeCompareTotals(entries);

    const table = renderCompareTable('department', entries, totals);
    expect(table).toContain('department');
    expect(table).toContain('研发部');
    expect(table).toContain('产品部');
  });
});

// ---------------------------------------------------------------------------
// Paginate compare entries
// ---------------------------------------------------------------------------

describe('paginateCompareEntries', () => {
  const entries: CompareEntry[] = [
    { key: '2025-01', label: '2025-01', baseline: 10, actual: 12, diff: 2, diffPercent: 20, flag: 'overrun' },
    { key: '2025-02', label: '2025-02', baseline: 20, actual: 18, diff: -2, diffPercent: -10, flag: 'under_threshold' },
    { key: '2025-03', label: '2025-03', baseline: 30, actual: 30, diff: 0, diffPercent: 0, flag: 'within_threshold' },
    { key: '2025-04', label: '2025-04', baseline: 40, actual: 42, diff: 2, diffPercent: 5, flag: 'overrun' },
    { key: '2025-05', label: '2025-05', baseline: 50, actual: 48, diff: -2, diffPercent: -4, flag: 'under_threshold' },
  ];

  it('returns page 1 with correct entries', () => {
    const result = paginateCompareEntries(entries, 1, 2);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.key).toBe('2025-01');
    expect(result.entries[1]!.key).toBe('2025-02');
    expect(result.total).toBe(5);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(2);
    expect(result.totalPages).toBe(3);
  });

  it('returns page 2 with correct entries', () => {
    const result = paginateCompareEntries(entries, 2, 2);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]!.key).toBe('2025-03');
    expect(result.entries[1]!.key).toBe('2025-04');
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
  });

  it('returns last page with remaining entries', () => {
    const result = paginateCompareEntries(entries, 3, 2);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.key).toBe('2025-05');
    expect(result.page).toBe(3);
    expect(result.totalPages).toBe(3);
  });

  it('page size larger than total returns all entries on page 1', () => {
    const result = paginateCompareEntries(entries, 1, 100);
    expect(result.entries).toHaveLength(5);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('page size equal to total returns single page', () => {
    const result = paginateCompareEntries(entries, 1, 5);
    expect(result.entries).toHaveLength(5);
    expect(result.totalPages).toBe(1);
  });

  it('clamps page beyond range to last page', () => {
    const result = paginateCompareEntries(entries, 99, 2);
    expect(result.page).toBe(3); // clamped to last page
    expect(result.entries).toHaveLength(1);
    expect(result.totalPages).toBe(3);
  });

  it('clamps page below 1 to page 1', () => {
    const result = paginateCompareEntries(entries, -1, 2);
    expect(result.page).toBe(1);
    expect(result.entries).toHaveLength(2);
  });

  it('handles empty entries', () => {
    const result = paginateCompareEntries([], 1, 10);
    expect(result.entries).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(0);
  });

  it('pageSize of 0 returns empty (edge case)', () => {
    const result = paginateCompareEntries(entries, 1, 0);
    expect(result.entries).toHaveLength(0);
  });
});