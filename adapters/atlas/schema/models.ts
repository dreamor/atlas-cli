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
// Manpower (Actual Hours) — /yuntu-service/yida/manpower/
// ---------------------------------------------------------------------------

/** Manpower confirmation entry within a staff node from
 * `getProjMpConfirmDetail.json`. May be null when no data exists.
 *
 * Each entry represents a half-month cycle with hours and remarks.
 * Key fields: `manpower` (hours), `month` (epoch ms), `cycle` (1 or 3). */
export const ManpowerWeeklyActualSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional().nullable(),
    gmtCreate: z.union([z.number(), z.string()]).optional().nullable(),
    gmtModified: z.union([z.number(), z.string()]).optional().nullable(),
    staffId: z.union([z.number(), z.string()]).optional().nullable(),
    realname: z.string().optional().nullable(),
    bossId: z.string().optional().nullable(),
    /** Actual manpower hours for this cycle. */
    manpower: z.union([z.number(), z.string()]).optional().nullable(),
    /** Cycle within the month (1 = first half, 3 = second half typically). */
    cycle: z.union([z.number(), z.string()]).optional().nullable(),
    /** Month as epoch ms timestamp. */
    month: z.union([z.number(), z.string()]).optional().nullable(),
    isDeleted: z.union([z.number(), z.boolean(), z.string()]).optional().nullable(),
    /** Legacy field — may contain week start date (epoch ms). */
    week: z.union([z.number(), z.string()]).optional().nullable(),
    /** Legacy field — may contain actual manpower hours. */
    actualManpower: z.union([z.number(), z.string()]).optional().nullable(),
    /** Legacy field — week start date. */
    startDate: z.union([z.number(), z.string()]).optional().nullable(),
    /** Legacy field — week end date. */
    endDate: z.union([z.number(), z.string()]).optional().nullable(),
    confirmDate: z.union([z.number(), z.string()]).optional().nullable(),
    confirmStaffId: z.string().optional().nullable(),
    confirmStatus: z.union([z.number(), z.string()]).optional().nullable(),
    departmentId: z.string().optional().nullable(),
    departmentName: z.string().optional().nullable(),
    projectId: z.union([z.number(), z.string()]).optional().nullable(),
    projectName: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    subCategory: z.string().optional().nullable(),
    status: z.union([z.number(), z.string()]).optional().nullable(),
    isConvert: z.union([z.number(), z.boolean(), z.string()]).optional().nullable(),
    /** Work description / remark. */
    remark: z.string().optional().nullable(),
    refuseRemark: z.string().optional().nullable(),
    except: z.boolean().optional().nullable(),
  })
  .passthrough();

export type ManpowerWeeklyActual = z.infer<typeof ManpowerWeeklyActualSchema>;

/** Recursive tree node for team/staff from `getProjMpConfirmDetail.json`.
 * Group nodes have `c` (children); leaf nodes have `weeklyActuals`. */
export const ManpowerTreeNodeSchema: z.ZodType<ManpowerTreeNode> = z.lazy(() =>
  z
    .object({
      /** Parent group info (usually null at top level). */
      p: z.unknown().optional().nullable(),
      /** Children (sub-teams or individuals). */
      c: z.array(ManpowerTreeNodeSchema).optional().nullable(),
      /** Staff ID (工号). */
      d: z.string().optional().nullable(),
      /** Display name in "姓名 - 工号" format. */
      n: z.string().optional().nullable(),
      /** Role / remark. */
      r: z.string().optional().nullable(),
      /** Total hours / subtotal for this node. */
      t: z.number().optional().nullable(),
      /** Headcount (string-formatted number). */
      h: z.string().optional().nullable(),
      /** Month status/metadata. */
      m: z.string().optional().nullable(),
      /** Approval status (1 = approved, seen on some leaf nodes). */
      s: z.number().optional().nullable(),
      /** Weekly actual hours data (null when no data submitted). */
      weeklyActuals: z.union([
        z.array(ManpowerWeeklyActualSchema),
        z.null(),
      ]).optional().nullable(),
      /** Historical manpower changes. */
      historyManpower: z.string().optional().nullable(),
    })
    .passthrough(),
);

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

/** Top-level response from `getProjMpConfirmDetail.json`. */
export const ManpowerConfirmResultSchema = z
  .object({
    /** Total headcount. */
    hc: z.number().optional().nullable(),
    /** Total manpower (approved hours?). */
    mp: z.number().optional().nullable(),
    /** Project-level manpower entries (may be empty). */
    projMp: z.array(z.unknown()).optional().nullable(),
    /** Team tree with nested staff/weekly hours. */
    teamMp: z.array(ManpowerTreeNodeSchema).optional().nullable(),
  })
  .passthrough();

export type ManpowerConfirmResult = z.infer<typeof ManpowerConfirmResultSchema>;

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
