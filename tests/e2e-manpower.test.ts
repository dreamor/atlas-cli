/**
 * End-to-end integration tests for manpower data pipelines.
 *
 * Covers both baseline (计划) and actual (实际) data flows,
 * plus cross-validation between the two pipelines.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BanmaClient } from '../adapters/atlas/http/client.js';
import type { LinePlanMonth } from '../adapters/atlas/schema/models.js';

import { fetchLinePlanMonths } from '../adapters/atlas/commands/_lineplans.js';
import { fetchManpowerConfirm } from '../adapters/atlas/commands/_manhours.js';
import {
  flattenManpowerTree,
  filterActualRows,
  pivotActualRows,
  summarizeActual,
  renderActualPivotTable,
  renderActualSummaryTable,
  type ActualStaffRow,
} from '../adapters/atlas/commands/_actual_logic.js';
import {
  applyRowFilter,
  dropAllZero,
  epochMsToMonthKey,
  pivotMonths,
  renderPivotTable,
  summarizeMonths,
  type PivotResult,
} from '../adapters/atlas/commands/_month_logic.js';

// ---------------------------------------------------------------------------
// Mock cache module — use inline factory to avoid esbuild transform issues
// ---------------------------------------------------------------------------
vi.mock('../adapters/atlas/dict/cache.js', () => ({
  loadDictionary: vi.fn().mockResolvedValue([]),
  loadDepartments: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockClient(responseMap: Record<string, unknown>): BanmaClient {
  return {
    request: vi.fn().mockImplementation(async (opts: Record<string, unknown>) => {
      const path = opts.path as string;
      const data = responseMap[path] ?? { status: 0, errorMsg: `no mock for ${path}` };
      return { envelope: { success: true, data }, data };
    }),
    rawJson: vi.fn(),
  };
}

function captureConsole(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '));
  };
  try {
    return fn().then(() => chunks.join('\n'));
  } finally {
    console.log = origLog;
  }
}

// ---------------------------------------------------------------------------
// Epoch constants
// ---------------------------------------------------------------------------

/** 2025-04-01 00:00 UTC */
const EPOCH_2025_04 = 1743465600000;
/** 2025-05-01 00:00 UTC */
const EPOCH_2025_05 = 1746057600000;
/** 2025-06-01 00:00 UTC */
const EPOCH_2025_06 = 1748736000000;
/** 2026-06-02 Monday */
const WEEK_JUN2 = 1748822400000;
/** 2026-06-09 Monday */
const WEEK_JUN9 = 1749427200000;

// ---------------------------------------------------------------------------
// Baseline fixtures
// ---------------------------------------------------------------------------

const baselineMonthData: LinePlanMonth[] = [
  {
    id: '1001',
    projectId: '2548',
    departmentId: 'D001',
    role: '研发',
    remark: '后端',
    areaCode: 'BJ',
    mpType: '1',
    linePlanMonthDetailList: [
      { month: EPOCH_2025_04, manpower: 10 },
      { month: EPOCH_2025_05, manpower: 12 },
      { month: EPOCH_2025_06, manpower: 11 },
    ],
  },
  {
    id: '1002',
    projectId: '2548',
    departmentId: 'D001',
    role: '研发',
    remark: '前端',
    areaCode: 'BJ',
    mpType: '1',
    linePlanMonthDetailList: [
      { month: EPOCH_2025_04, manpower: 6 },
      { month: EPOCH_2025_05, manpower: 7 },
      { month: EPOCH_2025_06, manpower: 8 },
    ],
  },
  {
    id: '1003',
    projectId: '2548',
    departmentId: 'D002',
    role: '产品',
    remark: '产品经理',
    areaCode: 'BJ',
    mpType: '1',
    linePlanMonthDetailList: [
      { month: EPOCH_2025_04, manpower: 5 },
      { month: EPOCH_2025_05, manpower: 5 },
      { month: EPOCH_2025_06, manpower: 6 },
    ],
  },
  {
    id: '1004',
    projectId: '2548',
    departmentId: 'D002',
    role: '产品',
    remark: '产品经理',
    areaCode: 'SH',
    mpType: '2',
    linePlanMonthDetailList: [
      { month: EPOCH_2025_04, manpower: 4 },
      { month: EPOCH_2025_05, manpower: 4 },
      { month: EPOCH_2025_06, manpower: 5 },
    ],
  },
  // 空 detail 列表
  {
    id: '1005',
    projectId: '2548',
    departmentId: 'D003',
    role: '测试',
    remark: '',
    areaCode: 'GZ',
    mpType: '1',
    linePlanMonthDetailList: [],
  },
];

// ---------------------------------------------------------------------------
// Actual fixtures — tree nodes
// ---------------------------------------------------------------------------

function makeWeeklyActual(
  month: number,
  cycle: number,
  manpower: number,
  remark: string,
): Record<string, unknown> {
  return {
    month,
    cycle,
    manpower,
    remark,
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

const actualPendingTree = [
  {
    p: null,
    c: [
      {
        p: null,
        c: [
          {
            p: null,
            d: '527449',
            n: '王野平 - 527449',
            r: '产品',
            t: 10,
            h: '1',
            m: '0',
            weeklyActuals: [
              makeWeeklyActual(WEEK_JUN2, 1, 5, '需求评审'),
              makeWeeklyActual(WEEK_JUN9, 1, 5, '需求评审'),
            ],
          },
          {
            p: null,
            d: '527450',
            n: '李明 - 527450',
            r: '研发',
            t: 8,
            h: '1',
            m: '0',
            weeklyActuals: [
              makeWeeklyActual(WEEK_JUN2, 1, 4, '开发'),
              makeWeeklyActual(WEEK_JUN9, 1, 4, '开发'),
            ],
          },
        ],
        d: '065527',
        t: 18,
        h: '2',
        m: '0',
        n: '范正斌 - 065527',
      },
    ],
    d: '065527',
    t: 18,
    h: '2',
    m: '0',
    n: '范正斌 - 065527',
  },
] as unknown[];

const actualApprovedTree = [
  {
    p: null,
    c: [
      {
        p: null,
        c: [
          {
            p: null,
            d: '527449',
            n: '王野平 - 527449',
            r: '产品',
            t: 10,
            h: '1',
            m: '0',
            s: 1,
            weeklyActuals: [
              makeWeeklyActual(WEEK_JUN2, 1, 5, '需求评审'),
              makeWeeklyActual(WEEK_JUN9, 1, 5, '需求评审'),
            ],
          },
          {
            p: null,
            d: '527450',
            n: '李明 - 527450',
            r: '研发',
            t: 8,
            h: '1',
            m: '0',
            s: 1,
            weeklyActuals: [
              makeWeeklyActual(WEEK_JUN2, 1, 4, '开发'),
              makeWeeklyActual(WEEK_JUN9, 1, 4, '开发'),
            ],
          },
        ],
        d: '065527',
        t: 18,
        h: '2',
        m: '0',
        n: '范正斌 - 065527',
      },
      {
        p: null,
        c: [
          {
            p: null,
            d: '527451',
            n: '赵六 - 527451',
            r: '测试',
            t: 6,
            h: '1',
            m: '0',
            s: 1,
            weeklyActuals: [
              makeWeeklyActual(WEEK_JUN2, 1, 3, '测试'),
              makeWeeklyActual(WEEK_JUN9, 1, 3, '测试'),
            ],
          },
        ],
        d: '065530',
        t: 6,
        h: '1',
        m: '0',
        n: '赵经理 - 065530',
      },
    ],
    d: '065527',
    t: 24,
    h: '3',
    m: '0',
    n: '范正斌 - 065527',
  },
] as unknown[];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: 人力基线 (Baseline) 数据流', () => {
  const client = mockClient({
    '/yuntu-service/line/plan/month/select.json': baselineMonthData,
  });

  const resolveDept = (id: unknown) => {
    const map: Record<string, string> = { D001: '研发部', D002: '产品部', D003: '测试部' };
    return map[String(id)] ?? String(id);
  };

  it('从 month/select 端点获取并解析基线数据', async () => {
    const result = await fetchLinePlanMonths(client, { projectId: '2548' });
    expect(result.items).toHaveLength(5);
    expect(result.items[0]!.departmentId).toBe('D001');
    expect(result.items[0]!.linePlanMonthDetailList).toHaveLength(3);
  });

  it('基线数据透视：行=部门+角色，列=月份', () => {
    const pivot = pivotMonths(baselineMonthData, {}, resolveDept);
    expect(pivot.monthColumns).toEqual(['2025-04', '2025-05', '2025-06']);
    expect(pivot.rows).toHaveLength(5);

    const devRow = pivot.rows.find((r) => r.departmentName === '研发部' && r.remark === '后端');
    const devTotal = pivot.monthColumns.reduce((s, m) => s + (devRow?.months[m] ?? 0), 0);
    expect(devTotal).toBe(33);
    expect(devRow?.months['2025-04']).toBe(10);
    expect(devRow?.months['2025-05']).toBe(12);
  });

  it('按部门过滤基线', () => {
    const filtered = applyRowFilter(baselineMonthData, { department: '研发' }, resolveDept);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r) => String(r.departmentId) === 'D001')).toBe(true);
  });

  it('按角色和 mpType 过滤基线', () => {
    const filtered = applyRowFilter(baselineMonthData, { role: '产品', mpType: '1' }, resolveDept);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.role).toBe('产品');
  });

  it('dropAllZero 移除全零行', () => {
    let pivot = pivotMonths(baselineMonthData, {}, resolveDept);
    pivot = dropAllZero(pivot);
    expect(pivot.rows.every((r) => r.departmentId !== 'D003')).toBe(true);
  });

  it('基线按月汇总', () => {
    const entries = summarizeMonths(baselineMonthData, {
      by: 'month',
      filter: {},
      resolveDepartment: resolveDept,
    });
    const apr = entries.find((e) => e.key === '2025-04');
    expect(apr?.total).toBe(25);
  });

  it('基线按部门汇总', () => {
    const entries = summarizeMonths(baselineMonthData, {
      by: 'department',
      filter: {},
      resolveDepartment: resolveDept,
    });
    const dev = entries.find((e) => e.key === 'dept:D001');
    expect(dev?.total).toBe(54);
  });

  it('基线透视与汇总交叉验证', () => {
    const pivot = pivotMonths(baselineMonthData, {}, resolveDept);
    const totalFromPivot = pivot.rows.reduce(
      (sum, r) => sum + pivot.monthColumns.reduce((s, m) => s + (r.months[m] ?? 0), 0),
      0,
    );
    const summaryGrand = summarizeMonths(baselineMonthData, { by: 'month', filter: {}, resolveDepartment: resolveDept })
      .reduce((s, e) => s + e.total, 0);
    expect(totalFromPivot).toBeCloseTo(summaryGrand, 0.01);
  });
});

describe('E2E: 实际工时 (Actual) 数据流', () => {
  const client = mockClient({
    '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json': {
      hc: 3,
      mp: 18,
      projMp: [],
      teamMp: actualPendingTree,
    },
  });

  it('从 getProjMpConfirmDetail 端点获取实际工时数据', async () => {
    const result = await fetchManpowerConfirm(client, {
      projectId: '2548',
      month: '2026-06',
      staffId: '527449',
      status: 0,
    });
    expect(result.hc).toBe(3);
    expect(result.mp).toBe(18);
    expect(result.teamMp).toHaveLength(1);
  });

  it('树形结构扁平化：团队→个人', () => {
    const rows = flattenManpowerTree(actualPendingTree as any, '', '', 0);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.staffId).toBe('527449');
    expect(rows[0]!.staffName).toBe('王野平');
    expect(rows[0]!.role).toBe('产品');
    expect(rows[0]!.teamLeadId).toBe('065527');
    expect(rows[0]!.teamLeadName).toBe('范正斌');
    expect(rows[0]!.total).toBeCloseTo(10/22, 4);
    expect(rows[0]!.status).toBe(0);

    expect(rows[1]!.staffId).toBe('527450');
    expect(rows[1]!.staffName).toBe('李明');
    expect(rows[1]!.role).toBe('研发');
    expect(rows[1]!.total).toBeCloseTo(8/22, 4);
  });

  it('扁平化：嵌套三级树', () => {
    const nestedTree = [
      {
        p: null,
        c: [
          {
            p: null,
            c: [
              {
                p: null,
                d: '527449',
                n: '王野平 - 527449',
                r: '产品',
                t: 5,
                h: '1',
                weeklyActuals: [makeWeeklyActual(WEEK_JUN2, 1, 5, '规划')],
              },
            ],
            d: '065527',
            n: '范正斌 - 065527',
            t: 5,
            h: '1',
          },
        ],
        d: '100001',
        n: '陈总 - 100001',
        t: 5,
        h: '1',
      },
    ];
    const rows = flattenManpowerTree(nestedTree as any, '', '', 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.teamLeadId).toBe('065527');
    expect(rows[0]!.teamLeadName).toBe('范正斌');
  });

  it('扁平化：空树返回空数组', () => {
    expect(flattenManpowerTree([] as any, '', '', 0)).toEqual([]);
  });

  it('扁平化：状态从父节点继承', () => {
    const tree = [
      {
        p: null,
        c: [{ p: null, c: [] as any[], d: '100', n: '员工 - 100', r: '', t: 0, h: '1', weeklyActuals: null }],
        d: '065527',
        n: '组长',
        s: 1,
        t: 0,
        h: '1',
      },
    ];
    const rows = flattenManpowerTree(tree as any, '', '', 0);
    expect(rows[0]!.status).toBe(1);
  });

  it('扁平化：叶子显式状态覆盖父节点', () => {
    const tree = [
      {
        p: null,
        c: [
          { p: null, c: [] as any[], d: '100', n: 'A', r: '', t: 0, h: '1', s: 0, weeklyActuals: null },
          { p: null, c: [] as any[], d: '101', n: 'B', r: '', t: 0, h: '1', weeklyActuals: null },
        ],
        d: '065527',
        n: '组长',
        s: 1,
        t: 0,
        h: '1',
      },
    ];
    const rows = flattenManpowerTree(tree as any, '', '', 0);
    expect(rows[0]!.status).toBe(0);
    expect(rows[1]!.status).toBe(1);
  });

  it('实际工时透视：按周展开', () => {
    const rows = flattenManpowerTree(actualPendingTree as any, '', '', 0);
    const pivot = pivotActualRows(rows, {});
    // WEEK_JUN2 = 1748822400000 = 2025-06-02，所以 period key 是 2025-06/c1
    expect(pivot.weekColumns).toContain('2025-06/c1');
    expect(pivot.rows[0]?.staffName).toBe('王野平');
    // Both WEEK_JUN2 and WEEK_JUN9 fall in June 2025 c1, so hours are summed
    expect(pivot.rows[0]?.weekHours['2025-06/c1']).toBeCloseTo(10/22, 4);
  });

  it('filterActualRows：按状态/姓名/角色/部门过滤', () => {
    const rows = flattenManpowerTree(actualPendingTree as any, '', '', 0);

    expect(filterActualRows(rows, { status: 'pending' })).toHaveLength(2);
    expect(filterActualRows(rows, { status: 'approved' })).toHaveLength(0);
    expect(filterActualRows(rows, { staffName: '野' })).toHaveLength(1);
    expect(filterActualRows(rows, { role: '研发' })).toHaveLength(1);
    expect(filterActualRows(rows, { department: '范正斌' })).toHaveLength(2);

    const combined = filterActualRows(rows, { status: 'pending', role: '产品' });
    expect(combined).toHaveLength(1);
    expect(combined[0]!.staffName).toBe('王野平');
  });

  it('实际工时按月/角色/部门汇总', () => {
    const rows = flattenManpowerTree(actualPendingTree as any, '', '', 0);

    const monthSummary = summarizeActual(rows, 'month', {});
    expect(monthSummary[0]!.total).toBeCloseTo(18/22, 4);

    const roleSummary = summarizeActual(rows, 'role', {});
    expect(roleSummary.find((e) => e.key === 'role:产品')?.total).toBeCloseTo(10/22, 4);
    expect(roleSummary.find((e) => e.key === 'role:研发')?.total).toBeCloseTo(8/22, 4);

    const deptSummary = summarizeActual(rows, 'department', {});
    expect(deptSummary.find((e) => e.key === 'dept:065527')?.total).toBeCloseTo(18/22, 4);
  });

  it('实际工时表格渲染含正确状态符号', () => {
    const rows = flattenManpowerTree(actualPendingTree as any, '', '', 0);
    const output = renderActualPivotTable(pivotActualRows(rows, {}));
    expect(output).toContain('⏳');
    expect(output).not.toContain('✓');
  });

  it('renderActualSummaryTable 无数据返回 (no data)', () => {
    expect(renderActualSummaryTable('month', [])).toBe('(no data)');
  });
});

describe('E2E: 待审批/已审批合并逻辑', () => {
  const pendingRows = flattenManpowerTree(actualPendingTree as any, '', '', 0);
  const approvedRows = flattenManpowerTree(actualApprovedTree as any, '', '', 1);

  function merge(pending: ReadonlyArray<ActualStaffRow>, approved: ReadonlyArray<ActualStaffRow>): ActualStaffRow[] {
    const map = new Map<string, ActualStaffRow>();
    for (const r of pending) map.set(r.staffId, r);
    for (const r of approved) map.set(r.staffId, r);
    return [...map.values()];
  }

  const merged = merge(pendingRows, approvedRows);

  it('同一 staffId 已审批覆盖待审批', () => {
    expect(merged.length).toBe(3);
    expect(merged.find((r) => r.staffId === '527449')?.status).toBe(1);
    expect(merged.find((r) => r.staffId === '527451')?.status).toBe(1);
  });

  it('filter approved 只返回已审批', () => {
    const filtered = filterActualRows(merged, { status: 'approved' });
    expect(filtered).toHaveLength(3);
  });

  it('filter pending 返回空（全部被覆盖）', () => {
    expect(filterActualRows(merged, { status: 'pending' })).toHaveLength(0);
  });
});

describe('E2E: 基线 ↔ 实际数据交叉校验', () => {
  const baselineClient = mockClient({
    '/yuntu-service/line/plan/month/select.json': baselineMonthData,
  });

  const actualClient = mockClient({
    '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json': {
      hc: 2,
      mp: 22,
      projMp: [],
      teamMp: [
        {
          p: null,
          c: [
            {
              p: null,
              c: [
                {
                  p: null,
                  d: '527449',
                  n: '王野平 - 527449',
                  r: '产品',
                  t: 10,
                  h: '1',
                  m: '0',
                  s: 1,
                  weeklyActuals: [
                    makeWeeklyActual(EPOCH_2025_04, 1, 5, '规划'),
                    makeWeeklyActual(EPOCH_2025_04, 3, 5, '规划'),
                  ],
                },
                {
                  p: null,
                  d: '527450',
                  n: '李明 - 527450',
                  r: '研发',
                  t: 12,
                  h: '1',
                  m: '0',
                  s: 1,
                  weeklyActuals: [
                    makeWeeklyActual(EPOCH_2025_04, 1, 6, '开发'),
                    makeWeeklyActual(EPOCH_2025_04, 3, 6, '开发'),
                  ],
                },
              ],
              d: '065527',
              t: 22,
              h: '2',
              m: '0',
              n: '范正斌 - 065527',
            },
          ],
          d: '065527',
          t: 22,
          h: '2',
          m: '0',
          n: '范正斌 - 065527',
        },
      ],
    },
  });

  it('2025-04 实际(22) ≤ 基线(25)', async () => {
    const baselineItems = await fetchLinePlanMonths(baselineClient, { projectId: '2548' });
    const baselineApr = summarizeMonths(baselineItems.items, {
      by: 'month',
      filter: { from: '2025-04', to: '2025-04' },
      resolveDepartment: () => '',
    });
    const baselineTotal = baselineApr.find((e) => e.key === '2025-04')?.total ?? 0;
    expect(baselineTotal).toBe(25);

    const actualResult = await fetchManpowerConfirm(actualClient, {
      projectId: '2548',
      month: '2025-04',
      staffId: '527449',
      status: 1,
    });
    const actualRows = flattenManpowerTree(actualResult.teamMp ?? [], '', '', 1);
    const actualSummary = summarizeActual(actualRows, 'month', { from: '2025-04', to: '2025-04' });
    const actualTotal = actualSummary.find((e) => e.key === '2025-04')?.total ?? 0;
    expect(actualTotal).toBeCloseTo(1, 4);
    expect(actualTotal).toBeLessThanOrEqual(baselineTotal);
  });

  it('实际数据的月份在基线范围内', async () => {
    const baselineItems = await fetchLinePlanMonths(baselineClient, { projectId: '2548' });
    const baselineMonths = new Set(
      baselineItems.items.flatMap((r) =>
        (r.linePlanMonthDetailList ?? [])
          .map((d) => epochMsToMonthKey(d.month as number))
          .filter((k): k is string => k !== null),
      ),
    );

    const actualResult = await fetchManpowerConfirm(actualClient, {
      projectId: '2548',
      month: '2025-04',
      staffId: '527449',
      status: 1,
    });
    const actualRows = flattenManpowerTree(actualResult.teamMp ?? [], '', '', 1);
    const actualMonths = new Set(
      actualRows.flatMap((r) =>
        (r.weeks as any[])
          .map((w) => {
            const ms = w.month ?? w.startDate ?? w.week;
            return epochMsToMonthKey(ms);
          })
          .filter((k): k is string => k !== null),
      ),
    );

    for (const m of [...actualMonths]) {
      expect(baselineMonths.has(m)).toBe(true);
    }
  });
});

describe('E2E: 多维度汇总一致性', () => {
  const allRows = [
    ...flattenManpowerTree(actualPendingTree as any, '', '', 0),
    ...flattenManpowerTree(actualApprovedTree as any, '', '', 1),
  ];

  function merge(pending: ReadonlyArray<ActualStaffRow>, approved: ReadonlyArray<ActualStaffRow>): ActualStaffRow[] {
    const map = new Map<string, ActualStaffRow>();
    for (const r of pending) map.set(r.staffId, r);
    for (const r of approved) map.set(r.staffId, r);
    return [...map.values()];
  }

  const merged = merge(
    flattenManpowerTree(actualPendingTree as any, '', '', 0),
    flattenManpowerTree(actualApprovedTree as any, '', '', 1),
  );

  it('按月汇总 = 透视表各月列总和', () => {
    const pivot = pivotActualRows(merged, {});
    const summary = summarizeActual(merged, 'month', {});
    for (const entry of summary) {
      const fromPivot = pivot.rows.reduce(
        (sum, r) => sum + (r.weekHours[entry.key + '/c1'] ?? 0) + (r.weekHours[entry.key + '/c3'] ?? 0),
        0,
      );
      expect(fromPivot).toBeCloseTo(entry.total, 0.01);
    }
  });

  it('按部门汇总 = 按角色汇总之和', () => {
    const deptTotal = summarizeActual(merged, 'department', {}).reduce((s, e) => s + e.total, 0);
    const roleTotal = summarizeActual(merged, 'role', {}).reduce((s, e) => s + e.total, 0);
    expect(deptTotal).toBeCloseTo(roleTotal, 0.01);
  });

  it('四种维度 grand total 一致', () => {
    const monthTotal = summarizeActual(merged, 'month', {}).reduce((s, e) => s + e.total, 0);
    const deptTotal = summarizeActual(merged, 'department', {}).reduce((s, e) => s + e.total, 0);
    const roleTotal = summarizeActual(merged, 'role', {}).reduce((s, e) => s + e.total, 0);
    const pivotTotal = pivotActualRows(merged, {}).rows.reduce((s, r) => s + r.total, 0);
    expect(monthTotal).toBeCloseTo(deptTotal, 0.01);
    expect(deptTotal).toBeCloseTo(roleTotal, 0.01);
    expect(roleTotal).toBeCloseTo(pivotTotal, 0.01);
  });
});

describe('E2E: 特殊边界情况', () => {
  it('string 类型 manpower 被正确解析', () => {
    const rows: ActualStaffRow[] = [
      {
        staffId: '300',
        staffName: '字符串值',
        role: '',
        teamLeadId: '',
        teamLeadName: '',
        status: 1,
        total: 0,
        headcount: 0,
        weeks: [{ manpower: '7.5' as any, month: EPOCH_2025_04, cycle: 1 } as any],
      },
    ];
    expect(pivotActualRows(rows, {}).rows[0]?.total).toBeCloseTo(7.5/22, 4);
  });

  it('null/zero/negative manpower 被跳过', () => {
    const rows: ActualStaffRow[] = [
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
          { manpower: null, month: EPOCH_2025_04, cycle: 1 } as any,
          { manpower: 0, month: EPOCH_2025_04, cycle: 3 } as any,
          { manpower: -5, month: EPOCH_2025_05, cycle: 1 } as any,
          { manpower: 3, month: EPOCH_2025_05, cycle: 3 } as any,
        ],
      },
    ];
    expect(pivotActualRows(rows, {}).rows[0]?.total).toBeCloseTo(3/22, 4);
  });

  it('legacy week 字段正确转换', () => {
    const rows: ActualStaffRow[] = [
      {
        staffId: '500',
        staffName: '旧格式',
        role: '',
        teamLeadId: '',
        teamLeadName: '',
        status: 1,
        total: 5,
        headcount: 0,
        weeks: [{ manpower: 5, week: EPOCH_2025_04, startDate: null } as any],
      },
    ];
    const pivot = pivotActualRows(rows, {});
    expect(pivot.weekColumns.length).toBeGreaterThan(0);
    // epochMsToWeekKey returns YYYY-MM-DD, check it starts with 2025-04
    expect(pivot.weekColumns.some((c) => c.startsWith('2025-04'))).toBe(true);
    expect(pivot.rows[0]?.total).toBeCloseTo(5/22, 4);
  });

  it('空树不产生行', () => {
    expect(flattenManpowerTree([] as any, '', '', 0)).toEqual([]);
    expect(pivotActualRows([], {})).toEqual({ rows: [], weekColumns: [] });
  });

  it('月份范围 from > to 返回空', () => {
    const rows = flattenManpowerTree(actualApprovedTree as any, '', '', 1);
    expect(summarizeActual(rows, 'month', { from: '2026-12', to: '2025-01' })).toEqual([]);
  });

  it('API 返回 null teamMp 不崩溃', async () => {
    const nullClient = mockClient({
      '/yuntu-service/yida/manpower/getProjMpConfirmDetail.json': {
        hc: 0,
        mp: 0,
        projMp: null,
        teamMp: null,
      },
    });
    const result = await fetchManpowerConfirm(nullClient, {
      projectId: '2548',
      month: '2026-06',
      staffId: '527449',
      status: 0,
    });
    expect(result.hc).toBe(0);
    const rows = flattenManpowerTree(result.teamMp ?? ([] as any), '', '', 0);
    expect(rows).toEqual([]);
  });
});