import { describe, it, expect } from 'vitest';
import {
  applyRowFilter,
  epochMsToMonthKey,
  isMonthInRange,
  pivotMonths,
  renderPivotTable,
  toManpower,
} from '../adapters/atlas/commands/_month_logic.js';
import type { LinePlanMonth } from '../adapters/atlas/schema/models.js';

// 2025-01-01 UTC = 1735689600000, 2025-02-01 = 1738368000000,
// 2025-03-01 = 1740787200000, 2025-04-01 = 1743465600000
const M = {
  jan: 1735689600000,
  feb: 1738368000000,
  mar: 1740787200000,
  apr: 1743465600000,
};

const sampleRows: LinePlanMonth[] = [
  {
    id: 1,
    departmentId: '10',
    role: '产品',
    remark: '大模型产品',
    linePlanMonthDetailList: [
      { id: 100, linePlanMonthId: 1, month: M.jan, manpower: 0.4 },
      { id: 101, linePlanMonthId: 1, month: M.feb, manpower: 1.0 },
      { id: 102, linePlanMonthId: 1, month: M.apr, manpower: 0.5 },
    ],
  },
  {
    id: 2,
    departmentId: '20',
    role: '研发',
    remark: '后端',
    linePlanMonthDetailList: [
      { id: 200, linePlanMonthId: 2, month: M.jan, manpower: 2 },
      { id: 201, linePlanMonthId: 2, month: M.feb, manpower: '3' },
      { id: 202, linePlanMonthId: 2, month: M.mar, manpower: null },
    ],
  },
  {
    id: 3,
    departmentId: '20',
    role: '研发',
    remark: '前端',
    linePlanMonthDetailList: [
      { id: 300, linePlanMonthId: 3, month: M.feb, manpower: 1.5 },
    ],
  },
];

const resolveDept = (id: unknown): string => {
  const map: Record<string, string> = { '10': 'PD', '20': 'R&D' };
  return map[String(id ?? '')] ?? '';
};

describe('epochMsToMonthKey', () => {
  it('converts epoch ms to YYYY-MM', () => {
    // Arrange + Act + Assert
    expect(epochMsToMonthKey(M.jan)).toBe('2025-01');
    expect(epochMsToMonthKey(M.feb)).toBe('2025-02');
  });

  it('accepts numeric strings', () => {
    expect(epochMsToMonthKey(String(M.mar))).toBe('2025-03');
  });

  it('returns null on invalid input', () => {
    expect(epochMsToMonthKey(null)).toBeNull();
    expect(epochMsToMonthKey(undefined)).toBeNull();
    expect(epochMsToMonthKey('')).toBeNull();
    expect(epochMsToMonthKey('nope')).toBeNull();
  });
});

describe('isMonthInRange', () => {
  it('returns true with empty range', () => {
    expect(isMonthInRange('2025-03', {})).toBe(true);
  });

  it('respects inclusive lower bound', () => {
    expect(isMonthInRange('2025-01', { from: '2025-02' })).toBe(false);
    expect(isMonthInRange('2025-02', { from: '2025-02' })).toBe(true);
  });

  it('respects inclusive upper bound', () => {
    expect(isMonthInRange('2025-04', { to: '2025-03' })).toBe(false);
    expect(isMonthInRange('2025-03', { to: '2025-03' })).toBe(true);
  });
});

describe('toManpower', () => {
  it('coerces numbers and numeric strings', () => {
    expect(toManpower(1.5)).toBe(1.5);
    expect(toManpower('2')).toBe(2);
  });

  it('returns null for empty/invalid', () => {
    expect(toManpower(null)).toBeNull();
    expect(toManpower(undefined)).toBeNull();
    expect(toManpower('')).toBeNull();
    expect(toManpower('NaN')).toBeNull();
  });
});

describe('applyRowFilter', () => {
  it('returns all rows when no filters set', () => {
    // Act
    const got = applyRowFilter(sampleRows, {}, resolveDept);

    // Assert
    expect(got).toHaveLength(3);
  });

  it('filters by department name (case-insensitive)', () => {
    const got = applyRowFilter(sampleRows, { department: 'r&d' }, resolveDept);
    expect(got.map((r) => r.id)).toEqual([2, 3]);
  });

  it('filters by department id', () => {
    const got = applyRowFilter(sampleRows, { department: '10' }, resolveDept);
    expect(got.map((r) => r.id)).toEqual([1]);
  });

  it('filters by role/remark substring', () => {
    const got = applyRowFilter(sampleRows, { role: '前端' }, resolveDept);
    expect(got.map((r) => r.id)).toEqual([3]);
  });

  it('AND-combines department and role', () => {
    const got = applyRowFilter(
      sampleRows,
      { department: 'R&D', role: '后端' },
      resolveDept,
    );
    expect(got.map((r) => r.id)).toEqual([2]);
  });
});

describe('pivotMonths', () => {
  it('produces one row per source row with month columns sorted asc', () => {
    // Act
    const pivot = pivotMonths(sampleRows, {}, resolveDept);

    // Assert
    expect(pivot.rows).toHaveLength(3);
    // 2025-03 entry had null manpower → dropped, so it does not appear as a column
    expect(pivot.monthColumns).toEqual(['2025-01', '2025-02', '2025-04']);
  });

  it('omits months outside --from / --to range', () => {
    const pivot = pivotMonths(
      sampleRows,
      { from: '2025-02', to: '2025-03' },
      resolveDept,
    );
    expect(pivot.monthColumns).toEqual(['2025-02']);
    // Note: 2025-03 had null manpower → no contribution
    expect(pivot.rows[0]?.months).toEqual({ '2025-02': 1.0 });
  });

  it('drops manpower entries with null / unparseable values', () => {
    const pivot = pivotMonths(sampleRows, {}, resolveDept);
    const row2 = pivot.rows.find((r) => r.id === '2');
    expect(row2?.months).toEqual({ '2025-01': 2, '2025-02': 3 });
  });

  it('resolves department name', () => {
    const pivot = pivotMonths(sampleRows, {}, resolveDept);
    const row1 = pivot.rows.find((r) => r.id === '1');
    expect(row1?.departmentName).toBe('PD');
    expect(row1?.departmentId).toBe('10');
  });
});

describe('renderPivotTable', () => {
  it('renders a header and one line per row', () => {
    // Arrange
    const pivot = pivotMonths(sampleRows, {}, resolveDept);

    // Act
    const out = renderPivotTable(pivot);

    // Assert
    expect(out).toContain('department');
    expect(out).toContain('2025-01');
    expect(out).toContain('PD');
    expect(out).toContain('R&D');
  });

  it('reports empty state cleanly', () => {
    const out = renderPivotTable({ rows: [], monthColumns: [] });
    expect(out).toBe('(no rows)');
  });
});
