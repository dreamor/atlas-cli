import { describe, it, expect } from 'vitest';
import {
  flattenManpowerTree,
  filterActualRows,
  pivotActualRows,
  summarizeActual,
  renderActualPivotTable,
  renderActualSummaryTable,
  type ActualStaffRow,
  type ActualStatusFilter,
} from '../adapters/atlas/commands/_actual_logic.js';
import type { ManpowerTreeNode } from '../adapters/atlas/schema/models.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// 2025-06-02 UTC Monday ≈ epoch 1748822400000
// 2025-06-09 UTC Monday ≈ 1749427200000
// 2025-06-16 UTC Monday ≈ 1750032000000
// 2025-04-01 UTC ≈ 1743465600000 (for month-based actuals)
const WEEK_JUN2 = 1748822400000;
const WEEK_JUN9 = 1749427200000;
const WEEK_JUN16 = 1750032000000;
const MONTH_APR = 1743465600000;

/** Build a leaf node (individual staff). */
function leaf(
  staffId: string,
  name: string,
  opts: {
    role?: string;
    total?: number;
    hc?: string;
    status?: number;
    weeklyActuals?: ManpowerTreeNode['weeklyActuals'];
  } = {},
): ManpowerTreeNode {
  return {
    d: staffId,
    n: `${name} - ${staffId}`,
    r: opts.role ?? '',
    t: opts.total ?? 0,
    h: opts.hc ?? '1',
    s: opts.status,
    weeklyActuals: opts.weeklyActuals ?? null,
  };
}

/** Build a monthly actuals entry — the real API format with month/cycle/manpower. */
function monthlyActual(month: number, cycle: number, manpower: number, remark?: string): import('../adapters/atlas/schema/models.js').ManpowerWeeklyActual {
  return {
    month,
    cycle,
    manpower,
    remark: remark ?? null,
    id: null,
    gmtCreate: null,
    gmtModified: null,
    staffId: null,
    realname: null,
    bossId: null,
    isDeleted: null,
    week: null,
    actualManpower: null,
    startDate: null,
    endDate: null,
    confirmDate: null,
    confirmStaffId: null,
    confirmStatus: null,
    departmentId: null,
    departmentName: null,
    projectId: null,
    projectName: null,
    category: null,
    subCategory: null,
    status: null,
    isConvert: null,
    refuseRemark: null,
    except: null,
  };
}

/** Build a group node with children. */
function group(
  leadId: string,
  leadName: string,
  children: ManpowerTreeNode[],
  opts: { total?: number; hc?: string; status?: number } = {},
): ManpowerTreeNode {
  return {
    d: leadId,
    n: `${leadName} - ${leadId}`,
    c: children,
    t: opts.total,
    h: opts.hc,
    s: opts.status,
  };
}

/** Two-level sample: team lead → 3 staff with monthly actuals. */
const sampleTree: ManpowerTreeNode[] = [
  group('065527', '范正斌', [
    leaf('527449', '王野平', {
      role: '产品',
      total: 15,
      hc: '1',
      status: 1,
      weeklyActuals: [
        monthlyActual(MONTH_APR, 1, 5, '产品规划'),
        monthlyActual(MONTH_APR, 3, 5, '需求评审'),
        monthlyActual(1746057600000, 1, 5, '迭代开发'),   // 2025-05-01
      ],
    }),
    leaf('527450', '李明', {
      role: '研发',
      total: 10,
      hc: '1',
      status: 1,
      weeklyActuals: [
        monthlyActual(MONTH_APR, 1, 3, '后端开发'),
        monthlyActual(MONTH_APR, 3, 4, '接口联调'),
        monthlyActual(1746057600000, 1, 3, '性能优化'),   // 2025-05-01
      ],
    }),
    leaf('527451', '张三', {
      role: '研发',
      total: 8,
      hc: '1',
      status: 0,
      weeklyActuals: [
        monthlyActual(MONTH_APR, 1, 2.5, '前端开发'),
        monthlyActual(MONTH_APR, 3, 3, 'Bug修复'),
        monthlyActual(1746057600000, 1, 2.5, '测试支持'),   // 2025-05-01
      ],
    }),
  ]),
];

/** Nested tree: org lead → team lead → staff. */
const nestedTree: ManpowerTreeNode[] = [
  group('100001', '陈总', [
    group('065527', '范正斌', [
      leaf('527449', '王野平', {
        role: '产品',
        total: 5,
        weeklyActuals: [
          monthlyActual(MONTH_APR, 1, 5, '规划'),
        ],
      }),
      leaf('527450', '李明', {
        role: '研发',
        total: 4,
        weeklyActuals: [
          monthlyActual(MONTH_APR, 1, 4, '开发'),
        ],
      }),
    ]),
    group('065530', '赵经理', [
      leaf('527460', '刘工', {
        role: '测试',
        total: 3,
        weeklyActuals: [
          monthlyActual(MONTH_APR, 1, 3, '测试'),
        ],
      }),
    ]),
  ]),
];

// ---------------------------------------------------------------------------
// flattenManpowerTree
// ---------------------------------------------------------------------------

describe('flattenManpowerTree', () => {
  it('flattens a single-level tree into staff rows', () => {
    const rows = flattenManpowerTree(sampleTree, '', '', 0);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.staffId).toBe('527449');
    expect(rows[0]?.staffName).toBe('王野平');
    expect(rows[0]?.teamLeadId).toBe('065527');
    expect(rows[0]?.teamLeadName).toBe('范正斌');
  });

  it('extracts name from "姓名 - 工号" format', () => {
    const rows = flattenManpowerTree(sampleTree, '', '', 0);
    expect(rows[1]?.staffName).toBe('李明');
    expect(rows[2]?.staffName).toBe('张三');
  });

  it('preserves role, total, headcount, and status from leaf nodes', () => {
    const rows = flattenManpowerTree(sampleTree, '', '', 0);
    const wyp = rows[0]!;
    expect(wyp.role).toBe('产品');
    expect(wyp.total).toBeCloseTo(15, 4);
    expect(wyp.headcount).toBe(1);
    expect(wyp.status).toBe(1);
  });

  it('inherits status from parent group when leaf has no status', () => {
    const tree: ManpowerTreeNode[] = [
      group('001', '组长', [leaf('100', '员工', { total: 0 })], { status: 1 }),
    ];
    const rows = flattenManpowerTree(tree, '', '', 0);
    expect(rows[0]?.status).toBe(1);
  });

  it('falls back to inherited status when leaf status is undefined', () => {
    const tree: ManpowerTreeNode[] = [
      group('001', '组长', [leaf('100', '员工A', { status: 0 }), leaf('101', '员工B')], {
        status: 1,
      }),
    ];
    const rows = flattenManpowerTree(tree, '', '', 0);
    // 员工A has explicit status 0, 员工B inherits 1 from group
    expect(rows[0]?.status).toBe(0);
    expect(rows[1]?.status).toBe(1);
  });

  it('handles nested tree with org lead → team lead → staff', () => {
    const rows = flattenManpowerTree(nestedTree, '', '', 0);
    expect(rows).toHaveLength(3);
    // All should inherit their immediate team lead, not the org lead
    expect(rows[0]?.teamLeadId).toBe('065527');
    expect(rows[0]?.teamLeadName).toBe('范正斌');
    expect(rows[2]?.teamLeadId).toBe('065530');
    expect(rows[2]?.teamLeadName).toBe('赵经理');
  });

  it('returns empty array for empty tree', () => {
    expect(flattenManpowerTree([], '', '', 0)).toEqual([]);
  });

  it('handles leaf node with empty weeklyActuals', () => {
    const tree: ManpowerTreeNode[] = [
      leaf('100', '空数据', { weeklyActuals: [] }),
    ];
    const rows = flattenManpowerTree([tree[0]!], '', '', 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.weeks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// filterActualRows
// ---------------------------------------------------------------------------

describe('filterActualRows', () => {
  const rows: ActualStaffRow[] = [
    {
      staffId: '100',
      staffName: '王野平',
      role: '产品',
      teamLeadId: '065527',
      teamLeadName: '范正斌',
      status: 1,
      total: 15,
      headcount: 1,
      weeks: [],
    },
    {
      staffId: '101',
      staffName: '李明',
      role: '研发',
      teamLeadId: '065527',
      teamLeadName: '范正斌',
      status: 0,
      total: 10,
      headcount: 1,
      weeks: [],
    },
    {
      staffId: '102',
      staffName: '张三',
      role: '研发',
      teamLeadId: '065530',
      teamLeadName: '赵经理',
      status: 0,
      total: 8,
      headcount: 1,
      weeks: [],
    },
  ];

  it('returns all rows when no filters are set', () => {
    expect(filterActualRows(rows, {})).toHaveLength(3);
  });

  it('filters by status=pending', () => {
    const got = filterActualRows(rows, { status: 'pending' });
    expect(got).toHaveLength(2);
    expect(got.every((r) => r.status === 0)).toBe(true);
  });

  it('filters by status=approved', () => {
    const got = filterActualRows(rows, { status: 'approved' });
    expect(got).toHaveLength(1);
    expect(got[0]?.staffId).toBe('100');
  });

  it('status=all returns everything', () => {
    expect(filterActualRows(rows, { status: 'all' })).toHaveLength(3);
  });

  it('filters by staffName (substring, case-insensitive)', () => {
    const got = filterActualRows(rows, { staffName: '野' });
    expect(got).toHaveLength(1);
    expect(got[0]?.staffName).toBe('王野平');
  });

  it('filters by staffId as substring', () => {
    const got = filterActualRows(rows, { staffName: '102' });
    expect(got).toHaveLength(1);
    expect(got[0]?.staffName).toBe('张三');
  });

  it('filters by role (substring, case-insensitive)', () => {
    const got = filterActualRows(rows, { role: '研发' });
    expect(got).toHaveLength(2);
  });

  it('filters by department (matches teamLead name + id)', () => {
    const got = filterActualRows(rows, { department: '范正斌' });
    expect(got).toHaveLength(2);
  });

  it('AND-combines multiple filters', () => {
    const got = filterActualRows(rows, { status: 'pending', role: '研发' });
    expect(got).toHaveLength(2);
    // Both pending and role=研发 are 李明 and 张三
    expect(got.map((r) => r.staffId).sort()).toEqual(['101', '102']);
  });

  it('AND-combines department and status', () => {
    const got = filterActualRows(rows, { department: '065527', status: 'approved' });
    expect(got).toHaveLength(1);
    expect(got[0]?.staffId).toBe('100');
  });
});

// ---------------------------------------------------------------------------
// pivotActualRows
// ---------------------------------------------------------------------------

describe('pivotActualRows', () => {
  const rows: ActualStaffRow[] = [
    {
      staffId: '100',
      staffName: '王野平',
      role: '产品',
      teamLeadId: '065527',
      teamLeadName: '范正斌',
      status: 1,
      total: 15,
      headcount: 1,
      weeks: [
        monthlyActual(MONTH_APR, 1, 5, '规划'),
        monthlyActual(MONTH_APR, 3, 5, '评审'),
        monthlyActual(1746057600000, 1, 5, '开发'),   // 2025-05
      ],
    },
    {
      staffId: '101',
      staffName: '李明',
      role: '研发',
      teamLeadId: '065527',
      teamLeadName: '范正斌',
      status: 1,
      total: 10,
      headcount: 1,
      weeks: [
        monthlyActual(MONTH_APR, 1, 3, '后端'),
        monthlyActual(MONTH_APR, 3, 4, '联调'),
        monthlyActual(1746057600000, 1, 3, '优化'),   // 2025-05
      ],
    },
  ];

  it('pivots entries into period columns (YYYY-MM/cN)', () => {
    const pivot = pivotActualRows(rows, {});
    // Should have columns for 2025-04/c1, 2025-04/c3, 2025-05/c1
    expect(pivot.weekColumns).toContain('2025-04/c1');
    expect(pivot.weekColumns).toContain('2025-04/c3');
    expect(pivot.weekColumns).toContain('2025-05/c1');
    expect(pivot.rows).toHaveLength(2);
    // Row 0: 2025-04/c1=5, 2025-04/c3=5, 2025-05/c1=5 → total=15
    const row0 = pivot.rows[0]!;
    expect(row0.total).toBeCloseTo(15, 4);
  });

  it('computes total from monthly actuals', () => {
    const pivot = pivotActualRows(rows, {});
    expect(pivot.rows[0]?.total).toBeCloseTo(15, 4);
    expect(pivot.rows[1]?.total).toBeCloseTo(10, 4);
  });

  it('respects --from filter', () => {
    const pivot = pivotActualRows(rows, { from: '2025-05' });
    // Only 2025-05/c1 should remain
    expect(pivot.weekColumns).toEqual(['2025-05/c1']);
    expect(pivot.rows[0]?.total).toBeCloseTo(5, 4);
    expect(pivot.rows[1]?.total).toBeCloseTo(3, 4);
  });

  it('respects --to filter', () => {
    const pivot = pivotActualRows(rows, { to: '2025-04' });
    // Only 2025-04 entries should remain
    expect(pivot.rows[0]?.total).toBeCloseTo(10, 4); // 5+5
    expect(pivot.rows[1]?.total).toBeCloseTo(7, 4);  // 3+4
  });

  it('handles rows with empty weeklyActuals', () => {
    const emptyRows: ActualStaffRow[] = [
      {
        staffId: '200',
        staffName: '无数据',
        role: '',
        teamLeadId: '',
        teamLeadName: '',
        status: 0,
        total: 0,
        headcount: 0,
        weeks: [],
      },
    ];
    const pivot = pivotActualRows(emptyRows, {});
    expect(pivot.rows).toHaveLength(1);
    expect(pivot.rows[0]?.total).toBe(0);
    expect(pivot.weekColumns).toEqual([]);
  });

  it('handles string-valued manpower', () => {
    const stringRows: ActualStaffRow[] = [
      {
        staffId: '300',
        staffName: '字符串值',
        role: '',
        teamLeadId: '',
        teamLeadName: '',
        status: 0,
        total: 0,
        headcount: 0,
        weeks: [
          { manpower: '7.5', month: MONTH_APR, cycle: 1 } as import('../adapters/atlas/schema/models.js').ManpowerWeeklyActual,
        ],
      },
    ];
    const pivot = pivotActualRows(stringRows, {});
    expect(pivot.rows[0]?.total).toBeCloseTo(7.5, 4);
  });

  it('skips null/zero/negative manpower', () => {
    const sparseRows: ActualStaffRow[] = [
      {
        staffId: '400',
        staffName: '空值',
        role: '',
        teamLeadId: '',
        teamLeadName: '',
        status: 0,
        total: 0,
        headcount: 0,
        weeks: [
          { manpower: null, month: MONTH_APR, cycle: 1 } as import('../adapters/atlas/schema/models.js').ManpowerWeeklyActual,
          { manpower: 0, month: MONTH_APR, cycle: 3 } as import('../adapters/atlas/schema/models.js').ManpowerWeeklyActual,
          { manpower: 3, month: 1746057600000, cycle: 1 } as import('../adapters/atlas/schema/models.js').ManpowerWeeklyActual,
        ],
      },
    ];
    const pivot = pivotActualRows(sparseRows, {});
    expect(pivot.rows[0]?.total).toBeCloseTo(3, 4);
  });
});

// ---------------------------------------------------------------------------
// summarizeActual
// ---------------------------------------------------------------------------

describe('summarizeActual', () => {
  const rows: ActualStaffRow[] = [
    {
      staffId: '100',
      staffName: '王野平',
      role: '产品',
      teamLeadId: '065527',
      teamLeadName: '范正斌',
      status: 1,
      total: 15,
      headcount: 1,
      weeks: [
        monthlyActual(MONTH_APR, 1, 5, '规划'),
        monthlyActual(MONTH_APR, 3, 5, '评审'),
        monthlyActual(1746057600000, 1, 5, '开发'),   // 2025-05
      ],
    },
    {
      staffId: '101',
      staffName: '李明',
      role: '研发',
      teamLeadId: '065527',
      teamLeadName: '范正斌',
      status: 1,
      total: 10,
      headcount: 1,
      weeks: [
        monthlyActual(MONTH_APR, 1, 3, '后端'),
        monthlyActual(MONTH_APR, 3, 4, '联调'),
        monthlyActual(1746057600000, 1, 3, '优化'),   // 2025-05
      ],
    },
    {
      staffId: '102',
      staffName: '张三',
      role: '研发',
      teamLeadId: '065530',
      teamLeadName: '赵经理',
      status: 0,
      total: 8,
      headcount: 1,
      weeks: [
        monthlyActual(MONTH_APR, 1, 2.5, '前端'),
        monthlyActual(MONTH_APR, 3, 3, 'Bug修复'),
        monthlyActual(1746057600000, 1, 2.5, '测试'),   // 2025-05
      ],
    },
  ];

  it('summarizes by month', () => {
    const entries = summarizeActual(rows, 'month', {});
    // Two months: 2025-04 and 2025-05
    expect(entries).toHaveLength(2);
    const apr = entries.find((e) => e.key === '2025-04');
    const may = entries.find((e) => e.key === '2025-05');
    expect(apr?.total).toBeCloseTo(22.5, 4); // (5+3+2.5) + (5+4+3) in Apr
    expect(may?.total).toBeCloseTo(10.5, 4); // 5+3+2.5 in May
  });

  it('summarizes by role', () => {
    const entries = summarizeActual(rows, 'role', {});
    expect(entries).toHaveLength(2);
    const product = entries.find((e) => e.key === 'role:产品');
    const dev = entries.find((e) => e.key === 'role:研发');
    expect(product?.total).toBeCloseTo(15, 4);
    expect(dev?.total).toBeCloseTo(18, 4); // 10+8
  });

  it('summarizes by department (team lead)', () => {
    const entries = summarizeActual(rows, 'department', {});
    expect(entries).toHaveLength(2);
    const fan = entries.find((e) => e.key === 'dept:065527');
    const zhao = entries.find((e) => e.key === 'dept:065530');
    expect(fan?.total).toBeCloseTo(25, 4); // 15+10
    expect(zhao?.total).toBeCloseTo(8, 4);
  });

  it('respects --from filter in summary', () => {
    const entries = summarizeActual(rows, 'month', { from: '2025-05' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.key).toBe('2025-05');
    expect(entries[0]?.total).toBeCloseTo(10.5, 4);
  });

  it('returns empty for empty rows', () => {
    expect(summarizeActual([], 'month', {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderActualPivotTable
// ---------------------------------------------------------------------------

describe('renderActualPivotTable', () => {
  it('renders (no rows) for empty data', () => {
    expect(renderActualPivotTable({ rows: [], weekColumns: [] })).toBe('(no rows)');
  });

  it('renders (no week data in range) when no week columns', () => {
    expect(
      renderActualPivotTable({
        rows: [{ staffId: '1', staffName: 'X', role: '', teamLeadId: '', teamLeadName: '', status: 0, weekHours: {}, total: 0, headcount: 0 }],
        weekColumns: [],
      }),
    ).toBe('(no week data in range)');
  });

  it('includes table headers and data rows', () => {
    const pivot = {
      rows: [
        {
          staffId: '100',
          staffName: '王野平',
          role: '产品',
          teamLeadId: '065527',
          teamLeadName: '范正斌',
          status: 1,
          weekHours: { '2025-04/c1': 10, '2025-04/c3': 5 },
          total: 15,
          headcount: 1,
        },
      ],
      weekColumns: ['2025-04/c1', '2025-04/c3'],
    };
    const out = renderActualPivotTable(pivot);
    expect(out).toContain('范正斌');
    expect(out).toContain('王野平');
    expect(out).toContain('2025-04/c1');
    expect(out).toContain('15');
    expect(out).toContain('Total');
    expect(out).toContain('✓'); // approved status
  });

  it('shows ⏳ for pending status', () => {
    const pivot = {
      rows: [
        {
          staffId: '200',
          staffName: '待审批',
          role: '',
          teamLeadId: '',
          teamLeadName: '',
          status: 0,
          weekHours: { '2025-04/c1': 5 },
          total: 5,
          headcount: 1,
        },
      ],
      weekColumns: ['2025-04/c1'],
    };
    const out = renderActualPivotTable(pivot);
    expect(out).toContain('⏳');
  });

  it('adds a total row at the bottom', () => {
    const pivot = {
      rows: [
        { staffId: '1', staffName: 'A', role: '', teamLeadId: '', teamLeadName: '', status: 1, weekHours: { '2025-04/c1': 10 }, total: 10, headcount: 1 },
        { staffId: '2', staffName: 'B', role: '', teamLeadId: '', teamLeadName: '', status: 1, weekHours: { '2025-04/c1': 5 }, total: 5, headcount: 1 },
      ],
      weekColumns: ['2025-04/c1'],
    };
    const out = renderActualPivotTable(pivot);
    expect(out).toContain('Total');
    // 10 + 5 = 15
    expect(out).toMatch(/15(\.00)?/);
  });
});

// ---------------------------------------------------------------------------
// renderActualSummaryTable
// ---------------------------------------------------------------------------

describe('renderActualSummaryTable', () => {
  it('renders (no data) for empty entries', () => {
    expect(renderActualSummaryTable('month', [])).toBe('(no data)');
  });

  it('renders month summary with total row', () => {
    const entries = [
      { key: '2025-06', label: '2025-06', total: 33 },
    ];
    const out = renderActualSummaryTable('month', entries);
    expect(out).toContain('month');
    expect(out).toContain('人月');
    expect(out).toContain('2025-06');
    expect(out).toContain('33');
    expect(out).toContain('Total');
  });

  it('renders department summary with team lead name', () => {
    const entries = [
      { key: 'dept:065527', label: '范正斌 (065527)', total: 25 },
    ];
    const out = renderActualSummaryTable('department', entries);
    expect(out).toContain('department');
    expect(out).toContain('范正斌');
  });

  it('renders role summary', () => {
    const entries = [
      { key: 'role:产品', label: '产品', total: 15 },
      { key: 'role:研发', label: '研发', total: 18 },
    ];
    const out = renderActualSummaryTable('role', entries);
    expect(out).toContain('role');
    expect(out).toContain('产品');
    expect(out).toContain('研发');
  });
});

// ---------------------------------------------------------------------------
// Integration: flatten → filter → pivot (full pipeline)
// ---------------------------------------------------------------------------

describe('full pipeline: flatten → filter → pivot', () => {
  it('end-to-end with sampleTree, no filter', () => {
    const rows = flattenManpowerTree(sampleTree, '', '', 0);
    const filtered = filterActualRows(rows, {});
    const pivot = pivotActualRows(filtered, {});

    expect(pivot.rows).toHaveLength(3);
    expect(pivot.rows[0]?.staffName).toBe('王野平');
    // Period keys: 2025-04/c1, 2025-04/c3, 2025-05/c1
    expect(pivot.rows[0]?.total).toBeCloseTo(15, 4);
    expect(pivot.rows[1]?.total).toBeCloseTo(10, 4);
    expect(pivot.rows[2]?.total).toBeCloseTo(8, 4);
  });

  it('end-to-end with status filter', () => {
    const rows = flattenManpowerTree(sampleTree, '', '', 0);
    const pending = filterActualRows(rows, { status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.staffName).toBe('张三');
  });

  it('end-to-end with role filter', () => {
    const rows = flattenManpowerTree(sampleTree, '', '', 0);
    const devs = filterActualRows(rows, { role: '研发' });
    expect(devs).toHaveLength(2);
  });

  it('pipeline with nested tree', () => {
    const rows = flattenManpowerTree(nestedTree, '', '', 0);
    expect(rows).toHaveLength(3);
    // First two under 范正斌, third under 赵经理
    expect(rows[0]?.teamLeadName).toBe('范正斌');
    expect(rows[2]?.teamLeadName).toBe('赵经理');

    const pivot = pivotActualRows(rows, {});
    expect(pivot.rows.reduce((sum, r) => sum + r.total, 0)).toBeCloseTo(12, 4); // 5+4+3
  });
});
