import { describe, it, expect } from 'vitest';
import {
  LinePlanSchema,
  ProjectSchema,
  DictionarySchema,
  DepartmentSchema,
} from '../adapters/atlas/schema/models.js';

describe('LinePlanSchema', () => {
  it('parses a real-shape line plan row', () => {
    const row = {
      id: 12345,
      gmtCreate: 1730000000000,
      gmtModified: 1730000000001,
      isDeleted: 0,
      projectId: 2548,
      departmentId: 17,
      mpType: 1,
      areaCode: 'CN',
      mp: 'CL48_8.13',
      linePlanType: 2,
      changeTime: '2025-12-01',
      createAt: '2025-11-01',
      srcType: 1,
      projectIds: '2548,2549',
      // unexpected extra
      mystery: { nested: true },
    };
    const parsed = LinePlanSchema.parse(row);
    expect(parsed.id).toBe(12345);
    expect((parsed as Record<string, unknown>).mystery).toBeDefined();
  });

  it('tolerates string ids', () => {
    const r = LinePlanSchema.parse({ id: 'abc' });
    expect(r.id).toBe('abc');
  });
});

describe('ProjectSchema', () => {
  it('parses {id, name}', () => {
    const r = ProjectSchema.parse({ id: 2548, name: 'Working Project' });
    expect(r.name).toBe('Working Project');
  });
});

describe('DictionarySchema', () => {
  it('parses dictionary rows', () => {
    const r = DictionarySchema.parse({
      id: 1,
      type: 'mpType',
      typeDesc: '报价类型',
      attrName: '预报价',
      attrValue: '1',
    });
    expect(r.attrName).toBe('预报价');
  });
});

describe('DepartmentSchema', () => {
  it('parses department rows', () => {
    const r = DepartmentSchema.parse({
      id: 99,
      deptCode: 'X',
      deptName: 'Banma RD',
    });
    expect(r.deptName).toBe('Banma RD');
  });
});
