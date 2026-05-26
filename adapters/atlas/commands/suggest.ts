/**
 * `atlas suggest <natural>` — rule-based NL→CLI translator.
 *
 * Not an LLM call. Pure regex + keyword extraction. Useful as a sanity check
 * for the skill: the skill produces its own command, then compares against
 * `atlas suggest` to spot disagreements before applying writes.
 *
 * Always returns ok=true with a list of candidate commands ranked by
 * confidence. If nothing matches we still return ok with an empty list and
 * a hint suggesting `atlas resolve` for project lookup.
 */

import { printResult } from '../util/output.js';

export interface SuggestCmdOpts {
  readonly json?: boolean;
}

export interface Suggestion {
  readonly cmd: string;
  readonly args: Record<string, string | boolean>;
  readonly confidence: number;
  readonly reasoning: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
}

export function suggestCmd(query: string, opts: SuggestCmdOpts): void {
  const suggestions = buildSuggestions(query);
  printResult(
    {
      query,
      suggestions,
    },
    {
      json: opts.json,
      meta: { count: suggestions.length },
      hint:
        suggestions.length === 0
          ? 'No rule matched. Use `atlas resolve project <name>` to discover ids manually.'
          : suggestions.length > 1
            ? 'Multiple suggestions. Pick the highest-confidence one or ask user.'
            : undefined,
      renderHuman: () => {
        /* eslint-disable no-console */
        if (suggestions.length === 0) {
          console.log('(no suggestion)');
          return;
        }
        for (const s of suggestions) {
          const argstr = Object.entries(s.args)
            .map(([k, v]) => (v === true ? k : `${k} ${v}`))
            .join(' ');
          console.log(`[${s.confidence.toFixed(2)}] atlas ${s.cmd} ${argstr}`);
          for (const r of s.reasoning) console.log(`  ↳ ${r}`);
          if (s.missing.length > 0) console.log(`  missing: ${s.missing.join(', ')}`);
        }
        /* eslint-enable no-console */
      },
    },
  );
}

export function buildSuggestions(query: string): Suggestion[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const intent = detectIntent(trimmed);
  if (!intent) return [];

  const args: Record<string, string | boolean> = {};
  const reasoning: string[] = [];
  const missing: string[] = [];

  const project = extractProjectName(trimmed);
  if (project) {
    args['--project-id'] = project.token;
    reasoning.push(`project token: "${project.token}" (${project.source})`);
  } else {
    missing.push('--project-id (run `atlas resolve project <name>` first)');
  }

  const dateRange = extractDateRange(trimmed);
  if (dateRange.from) {
    args['--from'] = dateRange.from;
    reasoning.push(`from: ${dateRange.from} (${dateRange.source ?? 'rule'})`);
  }
  if (dateRange.to) {
    args['--to'] = dateRange.to;
    reasoning.push(`to: ${dateRange.to} (${dateRange.source ?? 'rule'})`);
  }

  const department = extractDepartment(trimmed);
  if (department) {
    args['--department'] = department;
    reasoning.push(`department keyword: "${department}"`);
  }

  const role = extractRole(trimmed);
  if (role) {
    args['--role'] = role;
    reasoning.push(`role keyword: "${role}"`);
  }

  // JSON mode is implied for skill consumers.
  args['--json'] = true;

  const confidence = computeConfidence({
    hasProject: Boolean(project),
    hasDateRange: Boolean(dateRange.from || dateRange.to),
    hasFilter: Boolean(department || role),
    intent,
  });

  return [
    {
      cmd: intent.command,
      args,
      confidence,
      reasoning,
      missing,
    },
  ];
}

interface Intent {
  readonly command: string;
  readonly base: number;
}

function detectIntent(query: string): Intent | null {
  const lower = query.toLowerCase();
  // Order matters: more specific first.
  if (/汇总|聚合|aggregate|summary/.test(lower) && !/月度|by month/.test(lower)) {
    return { command: 'summary', base: 0.75 };
  }
  if (/导出|export|csv|json|parquet/.test(lower)) {
    return { command: 'export', base: 0.7 };
  }
  if (/月|month|人力|baseline|基线|投入/.test(lower)) {
    return { command: 'month', base: 0.8 };
  }
  if (/列表|条目|list|show me/.test(lower)) {
    return { command: 'list', base: 0.7 };
  }
  return null;
}

interface ExtractedProject {
  readonly token: string;
  readonly source: 'numeric' | 'quoted' | 'kw';
}

function extractProjectName(query: string): ExtractedProject | null {
  // Numeric id: "项目 2548"
  const numeric = query.match(/\b(\d{3,6})\b/);
  if (numeric) return { token: numeric[1]!, source: 'numeric' };

  // Quoted: 「BMW」 / "BMW" / 'BMW'
  const quoted = query.match(/["'「『]([^"'」』]+)["'」』]/);
  if (quoted) return { token: quoted[1]!, source: 'quoted' };

  // "项目 X" / "X 项目"
  const kw = query.match(/(?:项目|project)[\s:：]*([A-Za-z0-9_一-龥]+)/i);
  if (kw) return { token: kw[1]!, source: 'kw' };

  return null;
}

interface DateRange {
  readonly from?: string;
  readonly to?: string;
  readonly source?: string;
}

function extractDateRange(query: string): DateRange {
  // YYYY-MM range: "2026-01 到 2026-06"
  const explicit = query.match(/(\d{4}-\d{2})\D+(\d{4}-\d{2})/);
  if (explicit) return { from: explicit[1], to: explicit[2], source: 'explicit' };

  // Current year heuristics
  const now = new Date();
  const yearMatch = query.match(/(\d{4})\s*年/);
  if (yearMatch) {
    const y = yearMatch[1]!;
    return { from: `${y}-01`, to: `${y}-12`, source: `year ${y}` };
  }
  if (/今年|this year/i.test(query)) {
    const y = now.getFullYear();
    return { from: `${y}-01`, to: `${y}-12`, source: 'this year' };
  }
  if (/明年|next year/i.test(query)) {
    const y = now.getFullYear() + 1;
    return { from: `${y}-01`, to: `${y}-12`, source: 'next year' };
  }
  // Q1..Q4
  const q = query.match(/Q([1-4])|第([一二三四1234])季/i);
  if (q) {
    const num = Number(q[1] ?? cnNum(q[2] ?? ''));
    if (num >= 1 && num <= 4) {
      const y = now.getFullYear();
      const startMonth = String(1 + (num - 1) * 3).padStart(2, '0');
      const endMonth = String(num * 3).padStart(2, '0');
      return { from: `${y}-${startMonth}`, to: `${y}-${endMonth}`, source: `Q${num}` };
    }
  }
  return {};
}

function cnNum(c: string): number {
  return { 一: 1, 二: 2, 三: 3, 四: 4, '1': 1, '2': 2, '3': 3, '4': 4 }[c] ?? 0;
}

const DEPARTMENT_KEYWORDS = [
  'PMO',
  '产品',
  '技术',
  '测试',
  '运营',
  '安全',
  '前端',
  '后端',
  '算法',
  'AI',
  '大模型',
  '数据',
];

function extractDepartment(query: string): string | null {
  for (const kw of DEPARTMENT_KEYWORDS) {
    if (query.includes(kw)) {
      // Skip when the keyword is part of "项目" preamble.
      if (/项目/.test(query.slice(Math.max(0, query.indexOf(kw) - 4), query.indexOf(kw)))) {
        continue;
      }
      return kw;
    }
  }
  return null;
}

const ROLE_KEYWORDS = ['开发', '产品经理', '产品', '测试', '设计', 'PM', '运营', '数据', '算法'];

function extractRole(query: string): string | null {
  // Hint: "<role>角色" / "<role>团队" / "<role>同学"
  for (const kw of ROLE_KEYWORDS) {
    const re = new RegExp(`${kw}\\s*(角色|团队|同学|岗位)`);
    if (re.test(query)) return kw;
  }
  return null;
}

function computeConfidence(features: {
  readonly hasProject: boolean;
  readonly hasDateRange: boolean;
  readonly hasFilter: boolean;
  readonly intent: Intent;
}): number {
  let score = features.intent.base;
  if (!features.hasProject) score -= 0.3;
  if (features.hasDateRange) score += 0.1;
  if (features.hasFilter) score += 0.05;
  return Math.max(0.1, Math.min(0.95, Number(score.toFixed(2))));
}
