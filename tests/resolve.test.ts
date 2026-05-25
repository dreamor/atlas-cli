import { describe, expect, it } from 'vitest';
import { resolveProjectIdFromName } from '../adapters/atlas/dict/projectCatalog.js';
import { resolveDept, resolveDict } from '../adapters/atlas/dict/resolve.js';
import type { Department, Dictionary, Project } from '../adapters/atlas/schema/models.js';

const PROJECTS: ReadonlyArray<Project> = [
  { id: 2548, name: 'BMW IPA LLM 0726 项目', code: null, status: 1 },
  { id: 2547, name: 'BMW 海纳事故车项目', code: null, status: 1 },
  { id: 2576, name: '海纳事故车项目', code: null, status: 1 },
  { id: 9999, name: '不相关的项目', code: null, status: 1 },
] as Project[];

const DICT: ReadonlyArray<Dictionary> = [
  { id: 1, type: 'mpType', attrName: '产品', attrValue: '0' },
  { id: 2, type: 'mpType', attrName: '研发', attrValue: '1' },
  { id: 3, type: 'mpType', attrName: '测试', attrValue: '2' },
  { id: 4, type: 'srcType', attrName: '内部', attrValue: '0' },
  { id: 5, type: 'areaCode', attrName: '上海', attrValue: 'BSH' },
  { id: 6, type: 'areaCode', attrName: '武汉', attrValue: 'WH' },
] as Dictionary[];

const DEPTS: ReadonlyArray<Department> = [
  { id: 100, deptName: '斑马网络-斑马智行-PMO', deptCode: 'P3459', buCode: null, parentId: null },
  { id: 101, deptName: '斑马网络-技术-前端', deptCode: 'P1234', buCode: null, parentId: 100 },
  { id: 102, deptName: '斑马网络-产品-AI', deptCode: 'P5678', buCode: null, parentId: 100 },
] as Department[];

describe('resolve building blocks (project)', () => {
  it('exact id match resolves uniquely', () => {
    const r = resolveProjectIdFromName(PROJECTS, '2548');
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.project.name).toContain('BMW IPA LLM');
  });

  it('exact name match resolves uniquely', () => {
    const r = resolveProjectIdFromName(PROJECTS, 'BMW IPA LLM 0726 项目');
    expect(r.kind).toBe('resolved');
  });

  it('substring of one project resolves uniquely', () => {
    const r = resolveProjectIdFromName(PROJECTS, '不相关');
    expect(r.kind).toBe('resolved');
  });

  it('substring matching multiple returns ambiguous', () => {
    const r = resolveProjectIdFromName(PROJECTS, 'BMW');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.matches.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('no match returns notFound', () => {
    const r = resolveProjectIdFromName(PROJECTS, 'XYZNONE');
    expect(r.kind).toBe('notFound');
  });

  it('empty query returns notFound', () => {
    expect(resolveProjectIdFromName(PROJECTS, '   ').kind).toBe('notFound');
  });
});

describe('resolve building blocks (dictionary)', () => {
  it('resolves mpType code to name', () => {
    expect(resolveDict(DICT, 'mpType', '0')).toBe('产品');
    expect(resolveDict(DICT, 'mpType', '1')).toBe('研发');
  });

  it('returns undefined for missing code', () => {
    expect(resolveDict(DICT, 'mpType', '99')).toBeUndefined();
  });

  it('returns undefined for unknown type', () => {
    expect(resolveDict(DICT, 'unknownType', '0')).toBeUndefined();
  });
});

describe('resolve building blocks (department)', () => {
  it('matches by numeric id', () => {
    expect(resolveDept(DEPTS, 100)).toContain('PMO');
  });

  it('matches by deptCode', () => {
    expect(resolveDept(DEPTS, 'P3459')).toContain('PMO');
  });

  it('returns undefined for unknown id', () => {
    expect(resolveDept(DEPTS, 'P9999')).toBeUndefined();
  });
});
