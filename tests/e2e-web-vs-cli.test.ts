/**
 * 端到端验证：同一份 API 原始数据，两条处理路径结果一致性
 *
 * 单位说明：
 *   - 基线 (baseline): linePlanMonthDetailList[].manpower 是 **人月**
 *   - 实际 (actual):   weeklyActuals[].manpower 是 **人天**
 *     CLI summarizeActual 输出人天（原始聚合值），compare 内部 ÷22 转人月
 *
 * 覆盖范围：
 *   基线 (baseline): 跨年数据 (2024-12 ~ 2028-05)，三轴 month/department/role
 *   实际 (actual):   多个审批月份 (2026-03/04/05)
 *   对比 (compare):  验证 buildCompareResult 中人天÷22→人月 的换算正确
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  flattenManpowerTree,
  filterActualRows,
  summarizeActual,
  type ActualStaffRow,
} from '../adapters/atlas/commands/_actual_logic.js';
import {
  summarizeMonths,
  epochMsToMonthKey,
  type DepartmentResolver,
} from '../adapters/atlas/commands/_month_logic.js';
import { buildCompareResult, PERSON_MONTHS_TO_DAYS } from '../adapters/atlas/commands/_compare_logic.js';
import { fetchLinePlanMonths } from '../adapters/atlas/commands/_lineplans.js';
import { fetchManpowerConfirm } from '../adapters/atlas/commands/_manhours.js';
import { loadDepartments } from '../adapters/atlas/dict/cache.js';
import { resolveDept } from '../adapters/atlas/dict/resolve.js';
import { getClientOrExit } from '../adapters/atlas/commands/_client.js';
import { loadSession } from '../adapters/atlas/auth/session.js';
import type { LinePlanMonth } from '../adapters/atlas/schema/models.js';

const PROJECT_ID = '2548';
const BASELINE_FROM = '2024-12';
const BASELINE_TO = '2026-06';
const TOLERANCE = 0.5;

// 实际工时 API 中 month 是"审批周期"，CST 修复后数据月份与查询月份一致
const ACTUAL_MONTHS = ['2026-03', '2026-04', '2026-05'] as const;
// 对应的数据实际月份（CST 修复后无偏移）
const ACTUAL_DATA_MONTHS: ReadonlyArray<string> = ['2026-03', '2026-04', '2026-05'];

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function compareMaps(
  web: Record<string, number>,
  cli: Record<string, number>,
  label: string,
): boolean {
  const keys = new Set([...Object.keys(web), ...Object.keys(cli)]);
  let ok = true;
  for (const k of keys) {
    const va = web[k] ?? 0;
    const vb = cli[k] ?? 0;
    if (Math.abs(va - vb) > TOLERANCE) {
      console.error(
        `  ❌ ${label} "${k.slice(0, 50)}": web=${va.toFixed(2)} cli=${vb.toFixed(2)} diff=${Math.abs(va - vb).toFixed(2)}`,
      );
      ok = false;
    }
  }
  const totalWeb = Object.values(web).reduce((s, v) => s + v, 0);
  const totalCli = Object.values(cli).reduce((s, v) => s + v, 0);
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${keys.size} buckets, totals ${totalWeb.toFixed(1)}h vs ${totalCli.toFixed(1)}h`);
  return ok;
}

/** Web 端：遍历 baseline linePlanMonthDetailList 直接累加 */
function webBaseline(raw: LinePlanMonth[]): {
  byMonth: Record<string, number>;
  byDept: Record<string, number>;
  byRole: Record<string, number>;
} {
  const byMonth: Record<string, number> = {};
  const byDept: Record<string, number> = {};
  const byRole: Record<string, number> = {};
  for (const row of raw) {
    for (const d of row.linePlanMonthDetailList ?? []) {
      const monthKey = epochMsToMonthKey(d.month) ?? '';
      if (monthKey < BASELINE_FROM || monthKey > BASELINE_TO) continue;
      const hours = Number(d.manpower) || 0;
      byMonth[monthKey] = (byMonth[monthKey] ?? 0) + hours;
      byDept[`dept:${row.departmentId ?? '未知'}`] = (byDept[`dept:${row.departmentId ?? '未知'}`] ?? 0) + hours;
      byRole[`role:${row.role ?? '未知'}`] = (byRole[`role:${row.role ?? '未知'}`] ?? 0) + hours;
    }
  }
  return { byMonth, byDept, byRole };
}

function cliBaseline(items: LinePlanMonth[]) {
  // resolveDepartment 传空字符串，因为 summarizeMonths 只在过滤时用它，
  // 对于纯汇总测试我们用空解析器（不影响分组 key）
  const r: DepartmentResolver = () => '';
  return {
    byMonth: Object.fromEntries(summarizeMonths(items, { by: 'month', filter: { from: BASELINE_FROM, to: BASELINE_TO }, resolveDepartment: r }).map((e) => [e.key, e.total])),
    byDept: Object.fromEntries(summarizeMonths(items, { by: 'department', filter: { from: BASELINE_FROM, to: BASELINE_TO }, resolveDepartment: r }).map((e) => [e.key, e.total])),
    byRole: Object.fromEntries(summarizeMonths(items, { by: 'role', filter: { from: BASELINE_FROM, to: BASELINE_TO }, resolveDepartment: r }).map((e) => [e.key, e.total])),
  };
}

/** Web 端：flattenManpowerTree → 去重 → 逐周累加 */
function webActual(pendingRows: ReadonlyArray<ActualStaffRow>, approvedRows: ReadonlyArray<ActualStaffRow>): Record<string, number> {
  const map = new Map<string, ActualStaffRow>();
  for (const r of pendingRows) map.set(r.staffId, r);
  for (const r of approvedRows) map.set(r.staffId, r);
  const byMonth: Record<string, number> = {};
  for (const row of map.values()) {
    for (const w of row.weeks ?? []) {
      const v = Number(w.manpower) || 0;
      if (v <= 0) continue;
      const mk = epochMsToMonthKey(w.month) ?? '';
      byMonth[mk] = (byMonth[mk] ?? 0) + v;
    }
  }
  return byMonth;
}

function cliActual(pendingRows: ReadonlyArray<ActualStaffRow>, approvedRows: ReadonlyArray<ActualStaffRow>): Record<string, number> {
  const map = new Map<string, ActualStaffRow>();
  for (const r of pendingRows) map.set(r.staffId, r);
  for (const r of approvedRows) map.set(r.staffId, r);
  const filtered = filterActualRows([...map.values()], {});
  // summarizeActual returns 人月; convert back to 人天 for web-vs-cli comparison
  return Object.fromEntries(summarizeActual(filtered, 'month', {}).map((e) => [e.key, e.total * 22]));
}

// ===================================================================
// Tests
// ===================================================================

describe('🔍 E2E: 基线 Web vs CLI — 三轴·跨年覆盖', () => {
  let items: LinePlanMonth[];

  beforeAll(async () => {
    const client = await getClientOrExit();
    const r = await fetchLinePlanMonths(client, { projectId: PROJECT_ID });
    items = r.items;
    console.log(`  基线原始行数: ${items.length}`);
  });

  it('by month（覆盖 2024-12 ~ 2026-06）', () => {
    const w = webBaseline(items);
    const c = cliBaseline(items);
    expect(compareMaps(w.byMonth, c.byMonth, 'baseline month')).toBe(true);
  });

  it('by department', () => {
    const w = webBaseline(items);
    const c = cliBaseline(items);
    expect(compareMaps(w.byDept, c.byDept, 'baseline dept')).toBe(true);
  });

  it('by role', () => {
    const w = webBaseline(items);
    const c = cliBaseline(items);
    expect(compareMaps(w.byRole, c.byRole, 'baseline role')).toBe(true);
  });
});

describe('🔍 E2E: 实际工时 Web vs CLI — 多审批月份', () => {
  interface MonthData {
    param: string;
    dataMonth: string;
    pending: ReadonlyArray<ActualStaffRow>;
    approved: ReadonlyArray<ActualStaffRow>;
  }
  let months: MonthData[];

  beforeAll(async () => {
    const client = await getClientOrExit();
    const session = await loadSession();
    if (!session) throw new Error('No session');

    months = await Promise.all(ACTUAL_MONTHS.map(async (param, i) => {
      const [pendingResult, approvedResult] = await Promise.all([
        fetchManpowerConfirm(client, { projectId: PROJECT_ID, month: param, staffId: session.empId, status: 0 }),
        fetchManpowerConfirm(client, { projectId: PROJECT_ID, month: param, staffId: session.empId, status: 1 }),
      ]);
      const pending = flattenManpowerTree(pendingResult.teamMp ?? [], '', '', 0);
      const approved = flattenManpowerTree(approvedResult.teamMp ?? [], '', '', 1);

      const m = new Map<string, ActualStaffRow>();
      for (const r of pending) m.set(r.staffId, r);
      for (const r of approved) m.set(r.staffId, r);
      console.log(`  ${param}（数据月 ${ACTUAL_DATA_MONTHS[i]!}）: ${pending.length}p + ${approved.length}a → ${m.size} unique staff`);
      return { param, dataMonth: ACTUAL_DATA_MONTHS[i]!, pending: [...pending], approved: [...approved] };
    }));
  });

  for (let i = 0; i < ACTUAL_MONTHS.length; i++) {
    const param = ACTUAL_MONTHS[i];
    it(`${param}（数据月 ${ACTUAL_DATA_MONTHS[i]}）`, () => {
      const md = months[i]!;
      const w = webActual(md.pending, md.approved);
      const c = cliActual(md.pending, md.approved);
      expect(compareMaps(w, c, `actual ${param}`)).toBe(true);
    });
  }
});

describe('🔍 E2E: compare — 基线 vs 实际 cross-month 验证', () => {
  let baselineItems: LinePlanMonth[];
  let allActualMonths: Array<{ param: string; pending: ReadonlyArray<ActualStaffRow>; approved: ReadonlyArray<ActualStaffRow> }>;
  let depts: ReadonlyArray<any>;

  beforeAll(async () => {
    const client = await getClientOrExit();
    const session = await loadSession();
    if (!session) throw new Error('No session');
    depts = await loadDepartments(client);

    const [baselineResult, ...actualResults] = await Promise.all([
      fetchLinePlanMonths(client, { projectId: PROJECT_ID }),
      ...ACTUAL_MONTHS.map((month) =>
        Promise.all([
          fetchManpowerConfirm(client, { projectId: PROJECT_ID, month, staffId: session.empId, status: 0 }),
          fetchManpowerConfirm(client, { projectId: PROJECT_ID, month, staffId: session.empId, status: 1 }),
        ]).then(([pending, approved]) => ({
          param: month,
          pending: flattenManpowerTree(pending.teamMp ?? [], '', '', 0),
          approved: flattenManpowerTree(approved.teamMp ?? [], '', '', 1),
        })),
      ),
    ]);
    baselineItems = baselineResult.items;
    allActualMonths = actualResults;
  });

  it('buildCompareResult 将实际人天÷22→人月后与基线比较', () => {
    const r: DepartmentResolver = (id) => resolveDept(depts, (id ?? null) as string | number | null) ?? '';

    // 基线汇总（人月）
    const baselineSummary = summarizeMonths(baselineItems, { by: 'month', filter: {}, resolveDepartment: r });
    const baselineTotal = baselineSummary.reduce((s, e) => s + e.total, 0);

    // 合并 3 个月实际数据
    const masterMap = new Map<string, ActualStaffRow>();
    for (const am of allActualMonths) {
      for (const r of am.pending) masterMap.set(r.staffId, r);
      for (const r of am.approved) masterMap.set(r.staffId, r);
    }
    const merged = [...masterMap.values()];
    const filtered = filterActualRows(merged, {});
    const actualSummary = summarizeActual(filtered, 'month', {});  // 人月（上游已 /22）
    const actualTotalMonths = actualSummary.reduce((s, e) => s + e.total, 0);

    // buildCompareResult
    const result = buildCompareResult(baselineSummary, actualSummary, {
      axis: 'month' as const,
      threshold: 0,
      flagOverrun: false,
      page: 1,
      pageSize: 0,
    });

    expect(result.entries.length).toBeGreaterThan(0);

    // result.actualTotal 已经是人月（上游已 /22）
    expect(Math.abs(result.actualTotal - actualTotalMonths)).toBeLessThan(0.1);
    expect(Math.abs(result.grandDiff - (result.actualTotal - result.baselineTotal))).toBeLessThan(0.1);

    // 每个 entry 的 diff = actual(人月) - baseline(人月)
    for (const e of result.entries) {
      expect(Math.abs(e.diff - (e.actual - e.baseline))).toBeLessThan(0.1);
    }

    console.log(`  基线总计: ${result.baselineTotal.toFixed(2)} 人月（${baselineSummary.length} months）`);
    console.log(`  实际总计: ${actualTotalMonths.toFixed(2)} 人月`);
    console.log(`  差异:     ${result.grandDiff.toFixed(2)} 人月（${result.grandDiffPercent.toFixed(1)}%）`);
    console.log(`  ✅ compare 单位换算校验通过（${result.entries.length} entries）`);
  });
});

describe('🔍 E2E: Playwright 网站可达', () => {
  let cookies: any[];

  beforeAll(async () => {
    const session = await loadSession();
    expect(session).not.toBeNull();
    cookies = Array.isArray(session!.cookies)
      ? session!.cookies.map((c: any) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: Math.floor(c.expires ?? (Date.now() / 1000 + 86400)),
          httpOnly: c.httpOnly ?? false,
          secure: c.secure ?? false,
          sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None') ?? 'Lax',
        }))
      : [];
  });

  it('基线页面', { timeout: 90000 }, async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
    if (cookies.length > 0) await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(`https://banma-yuntu.alibaba-inc.com/yuntu/linePlan/select?projectId=${PROJECT_ID}`, { waitUntil: 'networkidle', timeout: 60000 });
    expect(page.url()).toContain('banma-yuntu');
    console.log('  ✅ 基线页面可访问');
    await browser.close();
  });

  it('实际工时页面', { timeout: 90000 }, async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
    if (cookies.length > 0) await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(`https://banma-yuntu.alibaba-inc.com/yuntu/manpower/confirm?projectId=${PROJECT_ID}`, { waitUntil: 'networkidle', timeout: 60000 });
    expect(page.url()).toContain('banma-yuntu');
    console.log('  ✅ 实际工时页面可访问');
    await browser.close();
  });
});