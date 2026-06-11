import nunjucks from 'nunjucks';
import type { LinePlan } from '../schema/models.js';

const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: true,
  trimBlocks: true,
  lstripBlocks: true,
});

// JSON-safe dump filter: serializes any value to JSON without the nunjucks
// default object toString which can leak internal state or produce invalid JSON.
env.addFilter('dump', (v: unknown) => JSON.stringify(v ?? null));

export interface RenderContext {
  readonly row: LinePlan;
  readonly projectId: string;
}

/** Render a Jinja-like template against a single LinePlan row. */
export function renderTemplate(template: string, ctx: RenderContext): string {
  return env.renderString(template, {
    row: ctx.row,
    projectId: ctx.projectId,
  });
}

export interface StagedUpdate {
  readonly id: number | string;
  readonly source: 'template' | 'llm';
  readonly update: Record<string, unknown>;
  readonly rendered: string;
  /**
   * Snapshot of the row as it existed at stage time. Persisted into the stage
   * file so `--apply` can write a faithful undo manifest without a second
   * fetch. Optional for backward-compat with stage files written before P2.
   */
  readonly original?: Record<string, unknown>;
}

/**
 * Best-effort parse of a rendered string into a JSON object that becomes the
 * row update payload. If the string is not valid JSON, returns null so the
 * caller can decide what to do (e.g. fall back to LLM, skip row).
 */
export function parseRenderedJson(rendered: string): Record<string, unknown> | null {
  const trimmed = rendered.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a staged update by rendering the template, then merging an optional
 * LLM-derived patch. Always preserves the row id and snapshots the original
 * row so the apply step can write an undo manifest.
 */
export function buildStagedUpdate(
  row: LinePlan,
  rendered: string,
  llmPatch: Record<string, unknown> | null,
): StagedUpdate {
  const parsed = parseRenderedJson(rendered);
  const fromTemplate = parsed ?? {};
  const update: Record<string, unknown> = {
    ...fromTemplate,
    ...(llmPatch ?? {}),
    id: row.id,
  };
  return {
    id: row.id,
    source: llmPatch ? 'llm' : 'template',
    update,
    rendered,
    original: row as Record<string, unknown>,
  };
}
