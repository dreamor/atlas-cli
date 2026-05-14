import { describe, expect, test } from 'vitest';
import { resolveProjectIdFromName } from '../adapters/atlas/dict/projectCatalog.js';
import type { Project } from '../adapters/atlas/schema/models.js';

const catalog: Project[] = [
  { id: 2548, name: 'BMW IPA LLM 0726 项目' } as Project,
  { id: 2027, name: '语音中台-NLU' } as Project,
  { id: 1141, name: '项目维护 –大众系（南北大众-斯柯达-捷达等）' } as Project,
  { id: 1142, name: '项目维护 -其它（福特-神龙-观致-后装等）' } as Project,
  { id: 2566, name: '语音大模型' } as Project,
  { id: 2522, name: '语音中台-NLU' } as Project,
  { id: 9999, name: 'EXACT NAME' } as Project,
];

describe('resolveProjectIdFromName', () => {
  test('exact numeric id resolves directly', () => {
    const r = resolveProjectIdFromName(catalog, '2548');
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') {
      expect(r.project.id).toBe('2548');
      expect(r.project.name).toBe('BMW IPA LLM 0726 项目');
    }
  });

  test('exact case-insensitive name resolves', () => {
    const r = resolveProjectIdFromName(catalog, 'exact name');
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.project.id).toBe('9999');
  });

  test('substring single match resolves', () => {
    const r = resolveProjectIdFromName(catalog, 'BMW IPA');
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.project.id).toBe('2548');
  });

  test('substring multiple matches → ambiguous', () => {
    const r = resolveProjectIdFromName(catalog, '语音');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.matches.length).toBeGreaterThan(1);
      expect(r.matches.length).toBeLessThanOrEqual(10);
      expect(r.matches.every((m) => m.name.includes('语音'))).toBe(true);
    }
  });

  test('Chinese substring works', () => {
    const r = resolveProjectIdFromName(catalog, 'BMW');
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.project.id).toBe('2548');
  });

  test('no match returns notFound', () => {
    const r = resolveProjectIdFromName(catalog, 'zzzz-not-real-zzzz');
    expect(r.kind).toBe('notFound');
  });

  test('empty query returns notFound', () => {
    const r = resolveProjectIdFromName(catalog, '   ');
    expect(r.kind).toBe('notFound');
  });

  test('numeric id that does not exist falls through to substring', () => {
    const r = resolveProjectIdFromName(catalog, '99999999');
    expect(r.kind).toBe('notFound');
  });
});
