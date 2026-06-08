/**
 * 对比验证：网页端直接处理 API 原始数据 vs CLI 数据管道处理结果
 * 确保两条路径对同一份数据产生一致的汇总结果。
 */
import { describe, expect, it } from 'vitest';

import type { LinePlanMonth } from '../adapters/atlas/schema/models.js';
import {
  flattenManpowerTree,
  pivotActualRows,
  summarizeActual,
  type ActualStaffRow,
} from '../adapters/atlas/commands/_actual_logic.js';
import {
  pivotMonths,
  summarizeMonths,
  type PivotResult,
} from '../adapters/atlas/commands/_month_logic.js';

// ---------------------------------------------------------------------------
// 共享的基准数据（模拟 API 原始响应）
// ---------------------------------------------------------------------------

const EPOCH_2025_04 = 1743465600000;
const EPOCH_2025_05 = 1746057600000;
const EPOCH_2025_06 = 1748736000000;
const WEEK_JUN2 = 1748822400000;
const WEEK_JUN9 = 1749427200000;

// 基线原始数据 — 来自 line/plan/select.json
const baselineRaw: LinePlanMonth[] = [
  { id: '1001', projectId: '2548', departmentId: 'D001', role: '研发', remark: '后端', areaCode: 'BJ', mpType: '1',
    linePlanMonthDetailList: [{ month: EPOCH_2025_04, manpower: 10 }, { month: EPOCH_2025_05, manpower: 12 }, { month: EPOCH_2025_06, manpower: 11 }] },
  { id: '1002', projectId: '2548', departmentId: 'D001', role: '研发', remark: '前端', areaCode: 'BJ', mpType: '1',
    linePlanMonthDetailList: [{ month: EPOCH_2025_04, manpower: 6 }, { month: EPOCH_2025_05, manpower: 7 }, { month: EPOCH_2025_06, manpower: 8 }] },
  { id: '1003', projectId: '2548', departmentId: 'D002', role: '产品', remark: '产品经理', areaCode: 'BJ', mpType: '1',
    linePlanMonthDetailList: [{ month: EPOCH_2025_04, manpower: 5 }, { month: EPOCH_2025_05, manpower: 5 }, { month: EPOCH_2025_06, manpower: 6 }] },
  { id: '1004', projectId: '2548', departmentId: 'D002', role: '产品', remark: '产品经理', areaCode: 'SH', mpType: '2',
    linePlanMonthDetailList: [{ month: EPOCH_2025_04, manpower: 4 }, { month: EPOCH_2025_05, manpower: 4 }, { month: EPOCH_2025_06, manpower: 5 }] },
];

// 实际工时原始数据 — 来自 getProjMpConfirmDetail.json
const actualTree = [
  {
    p: null,
    c: [
      {
        p: null,
        c: [
          { p: null, d: '527449', n: '王野平 - 527449', r: '产品', t: 10, h: '1', m: '0', s: 1,
            weeklyActuals: [{ month: WEEK_JUN2, cycle: 1, manpower: 5 }, { month: WEEK_JUN9, cycle: 1, manpower: 5 }] },
          { p: null, d: '527450', n: '李明 - 527450', r: '研发', t: 8, h: '1', m: '0', s: 1,
            weeklyActuals: [{ month: WEEK_JUN2, cycle: 1, manpower: 4 }, { month: WEEK_JUN9, cycle: 1, manpower: 4 }] },
        ],
        d: '065527', t: 18, h: '2', m: '0', n: '范正斌 - 065527',
      },
    ],
    d: '065527', t: 18, h: '2', m: '0', n: '范正斌 - 065527',
  },
] as any[];

// ---------------------------------------------------------------------------
// 路径 A：网页端直接处理原始数据（SPA 逻辑）
// ---------------------------------------------------------------------------

interface WebBaselineResult {
  months: string[];
  deptDetails: Record<string, { deptId: string; role: string; remark: string; months: Record<string, number> }>;
}

function webProcessBaseline(raw: LinePlanMonth[]): WebBaselineResult {
  const months = new Set<string>();
  const deptDetails: Record<string, { deptId: string; role: string; remark: string; months: Record<string, number> }> = {};

  for (const row of raw) {
    const did = String(row.departmentId ?? '');
    for (const detail of (row.linePlanMonthDetailList ?? [])) {
      const key = new Date(Number(detail.month)).toISOString().slice(0, 7);
      months.add(key);
      if (!deptDetails[did]) {
        deptDetails[did] = { deptId: did, role: row.role ?? '', remark: row.remark ?? '', months: {} };
      }
      deptDetails[did].months[key] = (deptDetails[did].months[key] || 0) + (Number(detail.manpower) || 0);
    }
  }
  return { months: [...months].sort(), deptDetails };
}

interface WebStaffRow {
  staffId: string;
  name: string;
  role: string;
  total: number;
  weekCount: number;
}

function webProcessActual(tree: any[]): WebStaffRow[] {
  const results: WebStaffRow[] = [];

  function walk(node: any): void {
    if (!node.c || node.c.length === 0) {
      let total = 0;
      let weekCount = 0;
      if (node.weeklyActuals) {
        for (const wa of node.weeklyActuals) {
          total += wa.manpower ?? 0;
          weekCount++;
        }
      }
      const name = node.n ? String(node.n).split(' - ')[0] ?? '' : '';
      results.push({ staffId: node.d, name, role: node.r || '', total, weekCount });
    } else {
      for (const child of node.c) walk(child);
    }
  }

  for (const root of tree) walk(root);
  return results;
}

// ---------------------------------------------------------------------------
// 路径 B：CLI 数据管道处理（Zod → pivot → summarize）
// ---------------------------------------------------------------------------

function cliProcessBaseline(raw: LinePlanMonth[]): {
  monthColumns: string[];
  rowTotals: Record<string, number>;
  grandTotal: number;
  monthSummary: { key: string; total: number }[];
} {
  const resolveDept = () => '';
  const pivot: PivotResult = pivotMonths(raw, {}, resolveDept);

  const rowTotals: Record<string, number> = {};
  for (const row of pivot.rows) {
    const did = row.departmentId || '';
    rowTotals[did] = (rowTotals[did] || 0) + pivot.monthColumns.reduce((s, m) => s + (row.months[m] || 0), 0);
  }

  const grandTotal = pivot.rows.reduce(
    (s, r) => s + pivot.monthColumns.reduce((ss, m) => ss + (r.months[m] || 0), 0), 0,
  );

  const monthSummary = summarizeMonths(raw, { by: 'month', filter: {}, resolveDepartment: resolveDept });

  return {
    monthColumns: [...pivot.monthColumns],
    rowTotals,
    grandTotal,
    monthSummary: monthSummary.map((e) => ({ key: e.key, total: e.total })),
  };
}

function cliProcessActual(tree: any[]): {
  staffRows: { staffId: string; name: string; total: number; weekCount: number }[];
  pivotGrandTotal: number;
  monthSummary: { key: string; total: number }[];
} {
  const rows = flattenManpowerTree(tree, '', '', 0);
  const pivot = pivotActualRows(rows, {});
  const summary = summarizeActual(rows, 'month', {});

  return {
    staffRows: rows.map((r) => ({
      staffId: r.staffId,
      name: r.staffName,
      total: r.total,
      weekCount: r.weeks.length,
    })),
    pivotGrandTotal: pivot.rows.reduce((s, r) => {
      const t = pivot.weekColumns.reduce((ss, w) => ss + (r.weekHours[w] || 0), 0);
      return s + t;
    }, 0),
    monthSummary: summary.map((e) => ({ key: e.key, total: e.total })),
  };
}

// ---------------------------------------------------------------------------
// 对比测试
// ---------------------------------------------------------------------------

describe('🔍 网页端 vs CLI：基线数据一致性', () => {
  const webResult = webProcessBaseline(baselineRaw);
  const cliResult = cliProcessBaseline(baselineRaw);

  it('月份列表一致', () => {
    expect(cliResult.monthColumns).toEqual(webResult.months);
  });

  it('D001 部门总计一致', () => {
    const webD001 = webResult.deptDetails['D001'];
    const webTotal = webResult.months.reduce((s, m) => s + (webD001?.months[m] || 0), 0);
    expect(cliResult.rowTotals['D001']).toBe(webTotal);
  });

  it('D002 部门总计一致', () => {
    const webD002 = webResult.deptDetails['D002'];
    const webTotal = webResult.months.reduce((s, m) => s + (webD002?.months[m] || 0), 0);
    expect(cliResult.rowTotals['D002']).toBe(webTotal);
  });

  it('Grand Total 一致', () => {
    const webGrand = Object.values(webResult.deptDetails).reduce(
      (s, d) => s + webResult.months.reduce((ss, m) => ss + (d.months[m] || 0), 0), 0,
    );
    expect(cliResult.grandTotal).toBe(webGrand);
  });

  it('逐月汇总一致', () => {
    for (const month of webResult.months) {
      const webMonthTotal = Object.values(webResult.deptDetails).reduce(
        (s, d) => s + (d.months[month] || 0), 0,
      );
      const cliEntry = cliResult.monthSummary.find((e) => e.key === month);
      expect(cliEntry?.total).toBe(webMonthTotal);
    }
  });
});

describe('🔍 网页端 vs CLI：实际工时一致性', () => {
  const webResult = webProcessActual(actualTree);
  const cliResult = cliProcessActual(actualTree);

  it('总人数一致', () => {
    expect(cliResult.staffRows.length).toBe(webResult.length);
  });

  it('每人总工时一致', () => {
    for (const ws of webResult) {
      const cs = cliResult.staffRows.find((r) => r.staffId === ws.staffId);
      expect(cs, `缺少 staffId=${ws.staffId}`).toBeDefined();
      expect(cs!.total).toBe(ws.total);
    }
  });

  it('每人周数一致', () => {
    for (const ws of webResult) {
      const cs = cliResult.staffRows.find((r) => r.staffId === ws.staffId);
      expect(cs!.weekCount).toBe(ws.weekCount);
    }
  });

  it('Grand Total 一致', () => {
    const webGrand = webResult.reduce((s, w) => s + w.total, 0);
    expect(cliResult.pivotGrandTotal).toBe(webGrand);
  });
});

describe('🔍 网页端 vs CLI：月度汇总交叉校验', () => {
  const cliResult = cliProcessActual(actualTree);

  it('2025-06 月汇总 = 各人当月总和', () => {
    const cliJune = cliResult.monthSummary.find((e) => e.key === '2025-06');
    const webStaffs = webProcessActual(actualTree);
    const webJune = webStaffs.reduce((s, w) => s + w.total, 0);
    expect(cliJune?.total).toBe(webJune);
  });

  it('周列总数与人员周数求和一致', () => {
    const totalWeeksFromStaff = webProcessActual(actualTree).reduce((s, w) => s + w.weekCount, 0);
    expect(cliResult.staffRows.reduce((s, r) => s + r.weekCount, 0)).toBe(totalWeeksFromStaff);
  });
});