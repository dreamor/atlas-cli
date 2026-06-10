import { z } from 'zod';

/** LinePlan from `/yuntu-service/line/plan/select.json`. Permissive — backend
 * may add fields. */
export const LinePlanSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    gmtCreate: z.union([z.number(), z.string()]).optional().nullable(),
    gmtModified: z.union([z.number(), z.string()]).optional().nullable(),
    isDeleted: z.union([z.number(), z.boolean()]).optional().nullable(),
    projectId: z.union([z.number(), z.string()]).optional().nullable(),
    departmentId: z.union([z.number(), z.string()]).optional().nullable(),
    mpType: z.union([z.number(), z.string()]).optional().nullable(),
    areaCode: z.string().optional().nullable(),
    mp: z.union([z.number(), z.string()]).optional().nullable(),
    linePlanType: z.union([z.number(), z.string()]).optional().nullable(),
    changeTime: z.union([z.number(), z.string()]).optional().nullable(),
    createAt: z.union([z.number(), z.string()]).optional().nullable(),
    srcType: z.union([z.number(), z.string()]).optional().nullable(),
    projectIds: z.union([z.string(), z.array(z.unknown())]).optional().nullable(),
  })
  .passthrough();

export type LinePlan = z.infer<typeof LinePlanSchema>;

/** A single (linePlanMonthId, month) → manpower entry from
 * `/yuntu-service/line/plan/month/select.json`. */
export const LinePlanMonthDetailSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional().nullable(),
    gmtCreate: z.union([z.number(), z.string()]).optional().nullable(),
    gmtModified: z.union([z.number(), z.string()]).optional().nullable(),
    linePlanMonthId: z.union([z.number(), z.string()]).optional().nullable(),
    month: z.union([z.number(), z.string()]).optional().nullable(),
    manpower: z.union([z.number(), z.string()]).optional().nullable(),
  })
  .passthrough();

export type LinePlanMonthDetail = z.infer<typeof LinePlanMonthDetailSchema>;

/** Monthly aggregate row (人力基线汇总) from
 * `/yuntu-service/line/plan/month/select.json`. Permissive — backend
 * may add fields. */
export const LinePlanMonthSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    gmtCreate: z.union([z.number(), z.string()]).optional().nullable(),
    gmtModified: z.union([z.number(), z.string()]).optional().nullable(),
    isDeleted: z.union([z.number(), z.boolean()]).optional().nullable(),
    projectId: z.union([z.number(), z.string()]).optional().nullable(),
    departmentId: z.union([z.number(), z.string()]).optional().nullable(),
    mpType: z.union([z.number(), z.string()]).optional().nullable(),
    areaCode: z.string().optional().nullable(),
    role: z.string().optional().nullable(),
    remark: z.string().optional().nullable(),
    linePlanMonthDetailList: z.array(LinePlanMonthDetailSchema).optional().nullable(),
  })
  .passthrough();

export type LinePlanMonth = z.infer<typeof LinePlanMonthSchema>;

/** Project (from `selectHasPermisValidProject.json`). */
export const ProjectSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
  })
  .passthrough();

export type Project = z.infer<typeof ProjectSchema>;

/** Dictionary entry from `dictionary/select.json`. */
export const DictionarySchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    type: z.union([z.number(), z.string()]),
    typeDesc: z.string().optional().nullable(),
    attrName: z.string().optional().nullable(),
    attrValue: z.union([z.string(), z.number()]).optional().nullable(),
    ids: z.unknown().optional(),
    extendValue: z.unknown().optional(),
  })
  .passthrough();

export type Dictionary = z.infer<typeof DictionarySchema>;

/** Department from `department/tree/select.json`. */
export const DepartmentSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    deptCode: z.string().optional().nullable(),
    deptName: z.string().optional().nullable(),
    buCode: z.string().optional().nullable(),
    buCorpCode: z.string().optional().nullable(),
    parentDepartmentNode: z.unknown().optional(),
  })
  .passthrough();

export type Department = z.infer<typeof DepartmentSchema>;

// ---------------------------------------------------------------------------
// Manpower (Actual Hours) — 旧 API 类型保留（测试 fixture 仍使用）
// ---------------------------------------------------------------------------

/**
 * @deprecated 仅用于旧测试 fixture 中模拟 `flattenManpowerTree` 输入。
 * 新命令使用 `WeeklySummaryNode` / `WeeklySummaryDetail` 及 `flattenWeeklySummary`。
 */

export interface ManpowerWeeklyActual {
  id?: number | string | null;
  gmtCreate?: number | string | null;
  gmtModified?: number | string | null;
  staffId?: number | string | null;
  realname?: string | null;
  bossId?: string | null;
  manpower?: number | string | null;
  cycle?: number | string | null;
  month?: number | string | null;
  week?: number | string | null;
  actualManpower?: number | string | null;
  startDate?: number | string | null;
  endDate?: number | string | null;
  confirmDate?: number | string | null;
  confirmStaffId?: string | null;
  confirmStatus?: number | string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  projectId?: number | string | null;
  projectName?: string | null;
  category?: string | null;
  subCategory?: string | null;
  status?: number | string | null;
  isConvert?: number | boolean | string | null;
  remark?: string | null;
  refuseRemark?: string | null;
  except?: boolean | null;
  [key: string]: unknown;
}

export interface ManpowerTreeNode {
  p?: unknown;
  c?: ManpowerTreeNode[] | null;
  d?: string | null;
  n?: string | null;
  r?: string | null;
  t?: number | null;
  h?: string | null;
  m?: string | null;
  s?: number | null;
  weeklyActuals?: ManpowerWeeklyActual[] | null;
  historyManpower?: string | null;
  [key: string]: unknown;
}

export interface ManpowerConfirmResult {
  hc?: number | null;
  mp?: number | null;
  projMp?: unknown[] | null;
  teamMp?: ManpowerTreeNode[] | null;
  [key: string]: unknown;
}

/** /user/info data shape. */
export const UserInfoSchema = z
  .object({
    account: z.string(),
    account_id: z.union([z.string(), z.number()]).optional(),
    emp_id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    locale: z.string().optional(),
    token: z.string(),
  })
  .passthrough();

export type UserInfo = z.infer<typeof UserInfoSchema>;

// ---------------------------------------------------------------------------
// Weekly Summary (新 API) — /yuntu-service/manpower/weekly/summaryByTeam.json
// ---------------------------------------------------------------------------

/** 明细条目：人员在某项目某周期的实际投入。 */
export const WeeklySummaryDetailSchema = z.object({
  id: z.number().optional().nullable(),
  gmtCreate: z.union([z.number(), z.string()]).optional().nullable(),
  gmtModified: z.union([z.number(), z.string()]).optional().nullable(),
  staffId: z.string().optional().nullable(),
  realname: z.string().optional().nullable(),
  bossId: z.string().optional().nullable(),
  manpower: z.number(),             // 人月
  cycle: z.number(),                // 1-4
  month: z.number(),                // epoch ms
  isDeleted: z.union([z.number(), z.boolean(), z.string()]).optional().nullable(),
  projectId: z.number().optional().nullable(),
  projectName: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  subCategory: z.string().optional().nullable(),
  status: z.number().optional().nullable(),  // 0=已填, 2=已确认
  isConvert: z.union([z.number(), z.boolean(), z.string()]).optional().nullable(),
  remark: z.string().optional().nullable(),
  refuseRemark: z.string().optional().nullable(),
  confirmStaffId: z.string().optional().nullable(),
  confirmStatus: z.union([z.number(), z.string()]).optional().nullable(),
  except: z.boolean().optional().nullable(),
}).passthrough();

export type WeeklySummaryDetail = z.infer<typeof WeeklySummaryDetailSchema>;

/** 团队/成员节点（递归树）。 */
export const WeeklySummaryNodeSchema: z.ZodType<WeeklySummaryNode> = z.lazy(() =>
  z.object({
    staffId: z.string(),
    realname: z.string(),
    manpower: z.number(),           // 团队合计人月
    status: z.unknown().optional().nullable(),
    detail: z.array(WeeklySummaryDetailSchema).optional().nullable(),
    isExcept: z.boolean().optional(),
    hc: z.number().optional().nullable(),
    cycleHc: z.record(z.number()).optional().nullable(),
    children: z.array(WeeklySummaryNodeSchema).optional().nullable(),
    role: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    locationDesc: z.string().optional().nullable(),
  }).passthrough(),
);

export interface WeeklySummaryNode {
  staffId: string;
  realname: string;
  manpower: number;
  status?: unknown;
  detail?: WeeklySummaryDetail[] | null;
  isExcept?: boolean;
  hc?: number | null;
  cycleHc?: Record<string, number> | null;
  children?: WeeklySummaryNode[] | null;
  role?: string | null;
  department?: string | null;
  locationDesc?: string | null;
  [key: string]: unknown;
}

/** 顶层响应。 */
export const WeeklySummaryResultSchema = z.object({
  status: z.union([z.number(), z.string()]).optional(),
  code: z.union([z.number(), z.string()]).optional(),
  errCode: z.string().optional().nullable(),
  errorMsg: z.string().optional().nullable(),
  success: z.boolean().optional(),
  data: z.array(WeeklySummaryNodeSchema),
}).passthrough();

export type WeeklySummaryResult = z.infer<typeof WeeklySummaryResultSchema>;
