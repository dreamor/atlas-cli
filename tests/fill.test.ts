import { describe, it, expect } from 'vitest';
import {
  buildStagedUpdate,
  parseRenderedJson,
  renderTemplate,
} from '../adapters/atlas/commands/_fill_render.js';
import { parseStageFile } from '../adapters/atlas/commands/baseline/fill.js';
import type { LinePlan } from '../adapters/atlas/schema/models.js';

const sampleRow: LinePlan = {
  id: 12345,
  projectId: 2548,
  mp: 'CL48_8.13',
  areaCode: 'CN',
  mpType: 1,
};

describe('renderTemplate', () => {
  it('substitutes row fields', () => {
    // Arrange
    const tpl = '{ "id": {{ row.id }}, "areaCode": "{{ row.areaCode }}" }';

    // Act
    const out = renderTemplate(tpl, { row: sampleRow, projectId: '2548' });

    // Assert
    expect(out.trim()).toBe('{ "id": 12345, "areaCode": "CN" }');
  });

  it('throws on missing fields (throwOnUndefined)', () => {
    // Arrange
    const tpl = '{ "missing": "{{ row.nope }}" }';

    // Act & Assert
    expect(() => renderTemplate(tpl, { row: sampleRow, projectId: '2548' })).toThrow();
  });

  it('exposes projectId to the template', () => {
    // Arrange
    const tpl = 'pid={{ projectId }}';

    // Act
    const out = renderTemplate(tpl, { row: sampleRow, projectId: '2548' });

    // Assert
    expect(out.trim()).toBe('pid=2548');
  });
});

describe('parseRenderedJson', () => {
  it('parses well-formed JSON object output', () => {
    // Arrange + Act
    const got = parseRenderedJson('{"mp":"X","areaCode":"CN"}');

    // Assert
    expect(got).toEqual({ mp: 'X', areaCode: 'CN' });
  });

  it('returns null for non-object output', () => {
    // Act + Assert
    expect(parseRenderedJson('"hello"')).toBeNull();
    expect(parseRenderedJson('[1,2,3]')).toBeNull();
    expect(parseRenderedJson('not json')).toBeNull();
    expect(parseRenderedJson('   ')).toBeNull();
  });
});

describe('buildStagedUpdate', () => {
  it('shapes a template-only update with id preserved', () => {
    // Arrange
    const rendered = '{"mp":"NEW_MP"}';

    // Act
    const out = buildStagedUpdate(sampleRow, rendered, null);

    // Assert
    expect(out).toMatchObject({
      id: 12345,
      source: 'template',
      update: { id: 12345, mp: 'NEW_MP' },
    });
    expect(out.rendered).toBe(rendered);
  });

  it('merges LLM patch over template, preserving id', () => {
    // Arrange
    const rendered = '{"mp":"FROM_TEMPLATE","areaCode":"CN"}';
    const patch = { mp: 'FROM_LLM', extra: 42 };

    // Act
    const out = buildStagedUpdate(sampleRow, rendered, patch);

    // Assert
    expect(out.source).toBe('llm');
    expect(out.update).toEqual({
      id: 12345,
      mp: 'FROM_LLM',
      areaCode: 'CN',
      extra: 42,
    });
  });

  it('still emits id when template is unparseable but llm patch present', () => {
    // Arrange
    const out = buildStagedUpdate(sampleRow, 'not json', { mp: 'PATCH' });

    // Assert
    expect(out.update).toEqual({ id: 12345, mp: 'PATCH' });
    expect(out.source).toBe('llm');
  });
});

describe('parseStageFile', () => {
  it('round-trips a staged payload', () => {
    // Arrange
    const file = JSON.stringify({
      projectId: '2548',
      updates: [
        {
          id: 1,
          source: 'template',
          update: { id: 1, mp: 'A' },
          rendered: '{}',
        },
      ],
    });

    // Act
    const parsed = parseStageFile(file);

    // Assert
    expect(parsed.projectId).toBe('2548');
    expect(parsed.updates).toHaveLength(1);
    expect(parsed.updates[0]?.update.mp).toBe('A');
  });

  it('throws on malformed payload', () => {
    // Act + Assert
    expect(() => parseStageFile(JSON.stringify({ foo: 1 }))).toThrow();
  });
});
