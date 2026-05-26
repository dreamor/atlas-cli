import { describe, expect, it } from 'vitest';
import { buildSuggestions } from '../adapters/atlas/commands/suggest.js';

describe('suggest: intent detection', () => {
  it('queries about manpower / 人力 → month', () => {
    const out = buildSuggestions('看下 项目 2548 今年人力');
    expect(out[0]?.cmd).toBe('month');
  });

  it('queries with "汇总" → summary', () => {
    const out = buildSuggestions('汇总项目 2548 各部门人力');
    // Note: "汇总" wins over "人力" by ordering
    expect(out[0]?.cmd).toBe('summary');
  });

  it('queries with "导出" → export', () => {
    const out = buildSuggestions('导出 2548 项目数据');
    expect(out[0]?.cmd).toBe('export');
  });

  it('queries with "list" → list', () => {
    const out = buildSuggestions('show me list of items in 项目 2548');
    expect(out[0]?.cmd).toBe('list');
  });

  it('returns empty for non-matching queries', () => {
    expect(buildSuggestions('天气怎么样').length).toBe(0);
  });
});

describe('suggest: project extraction', () => {
  it('extracts numeric id', () => {
    const out = buildSuggestions('项目 2548 人力');
    expect(out[0]?.args['--project-id']).toBe('2548');
  });

  it('extracts quoted name', () => {
    const out = buildSuggestions('看下 "BMW IPA" 项目人力');
    expect(out[0]?.args['--project-id']).toBe('BMW IPA');
  });

  it('marks missing project when no id/name found', () => {
    const out = buildSuggestions('查询人力');
    expect(out[0]?.missing.some((m) => m.includes('--project-id'))).toBe(true);
  });
});

describe('suggest: date extraction', () => {
  it('extracts YYYY-MM range', () => {
    const out = buildSuggestions('项目 2548 2026-01 到 2026-06 人力');
    expect(out[0]?.args['--from']).toBe('2026-01');
    expect(out[0]?.args['--to']).toBe('2026-06');
  });

  it('expands "今年" to current year range', () => {
    const out = buildSuggestions('项目 2548 今年人力');
    const y = new Date().getFullYear();
    expect(out[0]?.args['--from']).toBe(`${y}-01`);
    expect(out[0]?.args['--to']).toBe(`${y}-12`);
  });

  it('expands explicit year word "2026年"', () => {
    const out = buildSuggestions('项目 2548 2026年人力');
    expect(out[0]?.args['--from']).toBe('2026-01');
    expect(out[0]?.args['--to']).toBe('2026-12');
  });

  it('expands "Q2" to current-year quarter', () => {
    const out = buildSuggestions('项目 2548 Q2 人力');
    const y = new Date().getFullYear();
    expect(out[0]?.args['--from']).toBe(`${y}-04`);
    expect(out[0]?.args['--to']).toBe(`${y}-06`);
  });
});

describe('suggest: confidence', () => {
  it('full information yields >= 0.8', () => {
    const out = buildSuggestions('项目 2548 今年 PMO 团队人力');
    expect(out[0]?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('missing project drops confidence', () => {
    const out = buildSuggestions('查 PMO 团队人力');
    expect(out[0]?.confidence).toBeLessThan(0.6);
  });
});
