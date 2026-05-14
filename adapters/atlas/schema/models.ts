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
