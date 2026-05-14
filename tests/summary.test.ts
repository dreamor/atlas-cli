import { describe, it, expect } from 'vitest';
import { summarizeMonths, renderSummaryTable } from '../adapters/atlas/commands/_month_logic.js';
import type { LinePlanMonth } from '../adapters/atlas/schema/models.js';

const M = {
  jan: 1735689600000, // 2025-01-01 UTC
  feb: 1738368000000, // 2025-02-01 UTC
  mar: 1740787200000, // 2025-03-01 UTC
};

const rows: LinePlanMonth[] = [
  {
    id: 1,
    departmentId: '10',
    role: '产品',
    remark: 'r1',
    linePlanMonthDetailList: [
      { month: M.jan, manpower: 0.5 },
      { month: M.feb, manpower: 1.0 },
    ],
  },
  {
    id: 2,
    departmentId: '10',
    role: '产品',
    remark: 'r2',
    linePlanMonthDetailList: [
      { month: M.jan, manpower: 0.5 },
      { month: M.mar, manpower: 1.0 },
    ],
  },
  {
    id: 3,
    departmentId: '20',
    role: '研发',
    remark: 'r3',
    linePlanMonthDetailList: [
      { month: M.jan, manpower: 2 },
      { month: M.feb, manpower: 3 },
    ],
  },
];

const resolveDept = (id: unknown): string => {
  const map: Record<string, string> = { '10': 'PD', '20': 'R&D' };
  return map[String(id ?? '')] ?? '';
};

describe('summarizeMonths by month', () => {
  it('sums manpower per month across all rows', () => {
    // Act
    const got = summarizeMonths(rows, {
      by: 'month',
      filter: {},
      resolveDepartment: resolveDept,
    });

    // Assert
    expect(got).toEqual([
      { key: '2025-01', label: '2025-01', total: 3 },
      { key: '2025-02', label: '2025-02', total: 4 },
      { key: '2025-03', label: '2025-03', total: 1 },
    ]);
  });

  it('respects --from / --to filter', () => {
    const got = summarizeMonths(rows, {
      by: 'month',
      filter: { from: '2025-02', to: '2025-02' },
      resolveDepartment: resolveDept,
    });
    expect(got).toEqual([{ key: '2025-02', label: '2025-02', total: 4 }]);
  });

  it('returns empty array when no data in range', () => {
    const got = summarizeMonths(rows, {
      by: 'month',
      filter: { from: '2030-01' },
      resolveDepartment: resolveDept,
    });
    expect(got).toEqual([]);
  });
});

describe('summarizeMonths by department', () => {
  it('aggregates total manpower per department across months', () => {
    const got = summarizeMonths(rows, {
      by: 'department',
      filter: {},
      resolveDepartment: resolveDept,
    });
    const byKey = Object.fromEntries(got.map((e) => [e.key, e.total]));
    // dept 10: 0.5+1.0+0.5+1.0 = 3 ; dept 20: 2+3 = 5
    expect(byKey['dept:10']).toBe(3);
    expect(byKey['dept:20']).toBe(5);
  });

  it('uses resolved department name in label', () => {
    const got = summarizeMonths(rows, {
      by: 'department',
      filter: {},
      resolveDepartment: resolveDept,
    });
    const dept10 = got.find((e) => e.key === 'dept:10');
    expect(dept10?.label).toBe('PD (10)');
  });
});

describe('summarizeMonths by role', () => {
  it('aggregates total manpower per role', () => {
    const got = summarizeMonths(rows, {
      by: 'role',
      filter: {},
      resolveDepartment: resolveDept,
    });
    const byKey = Object.fromEntries(got.map((e) => [e.key, e.total]));
    // 产品: 0.5+1.0+0.5+1.0 = 3 ; 研发: 2+3 = 5
    expect(byKey['role:产品']).toBe(3);
    expect(byKey['role:研发']).toBe(5);
  });

  it('combines from/to range with role grouping', () => {
    const got = summarizeMonths(rows, {
      by: 'role',
      filter: { from: '2025-01', to: '2025-01' },
      resolveDepartment: resolveDept,
    });
    const byKey = Object.fromEntries(got.map((e) => [e.key, e.total]));
    expect(byKey['role:产品']).toBe(1);
    expect(byKey['role:研发']).toBe(2);
  });
});

describe('renderSummaryTable', () => {
  it('renders header and rows', () => {
    // Arrange
    const entries = [
      { key: '2025-01', label: '2025-01', total: 3 },
      { key: '2025-02', label: '2025-02', total: 4 },
    ];

    // Act
    const out = renderSummaryTable('month', entries);

    // Assert
    expect(out).toContain('month');
    expect(out).toContain('total manpower');
    expect(out).toContain('2025-01');
    expect(out).toContain('3');
  });

  it('reports empty state cleanly', () => {
    expect(renderSummaryTable('department', [])).toBe('(no data)');
  });
});
