import { describe, it, expect } from 'vitest';
import { resolveDict, resolveDept } from '../adapters/atlas/dict/resolve.js';
import type { Department, Dictionary } from '../adapters/atlas/schema/models.js';

const DICT: Dictionary[] = [
  { id: 1, type: 'mpType', typeDesc: '报价类型', attrName: '预报价', attrValue: '1' },
  { id: 2, type: 'mpType', typeDesc: '报价类型', attrName: '正式报价', attrValue: 2 },
  { id: 3, type: 'srcType', typeDesc: '来源', attrName: '内部', attrValue: '1' },
];

const DEPTS: Department[] = [
  { id: 17, deptName: 'Banma RD', deptCode: 'BMRD' },
  { id: 18, deptName: 'Banma QA', deptCode: 'BMQA' },
];

describe('resolveDict', () => {
  it('matches type + value', () => {
    expect(resolveDict(DICT, 'mpType', '1')).toBe('预报价');
  });

  it('coerces numeric values to string for comparison', () => {
    expect(resolveDict(DICT, 'mpType', 2)).toBe('正式报价');
  });

  it('returns undefined for unknown', () => {
    expect(resolveDict(DICT, 'mpType', 99)).toBeUndefined();
  });

  it('returns undefined for null/undefined', () => {
    expect(resolveDict(DICT, 'mpType', null)).toBeUndefined();
    expect(resolveDict(DICT, 'mpType', undefined)).toBeUndefined();
  });
});

describe('resolveDept', () => {
  it('matches dept by id', () => {
    expect(resolveDept(DEPTS, 17)).toBe('Banma RD');
    expect(resolveDept(DEPTS, '18')).toBe('Banma QA');
  });

  it('returns undefined for unknown', () => {
    expect(resolveDept(DEPTS, 999)).toBeUndefined();
  });
});
