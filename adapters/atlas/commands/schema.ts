/**
 * `atlas schema <subcommand>` — introspection endpoints for agents.
 *
 *   atlas schema export       Dump cached enum values (mpType, linePlanType,
 *                             srcType, areaCode, department tree).
 *   atlas schema commands     Dump every CLI command with its options.
 *
 * Skills can cache the output and avoid hard-coding ids that may drift across
 * Banma deployments.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import { getClientOrExit } from './_client.js';
import { loadDepartments, loadDictionary } from '../dict/cache.js';
import { printResult } from '../util/output.js';
import { ConfigError } from '../util/errors.js';
import type { Department, Dictionary } from '../schema/models.js';

interface DictGroup {
  readonly type: string;
  readonly values: ReadonlyArray<{ id: string; name: string }>;
}

export interface SchemaExportOpts {
  readonly out?: string;
  readonly refresh?: boolean;
  readonly json?: boolean;
}

export async function schemaExportCmd(opts: SchemaExportOpts): Promise<void> {
  const client = await getClientOrExit();
  const [dict, depts] = await Promise.all([
    loadDictionary(client, { refresh: opts.refresh }),
    loadDepartments(client, { refresh: opts.refresh }),
  ]);

  const enums = groupDictionary(dict);
  const departments = depts.map(toDeptEntry);

  const payload = {
    generatedAt: new Date().toISOString(),
    enums,
    departments,
  };

  if (opts.out) {
    await mkdir(dirname(opts.out), { recursive: true });
    await writeFile(opts.out, JSON.stringify(payload, null, 2), 'utf8');
  }

  printResult(payload, {
    json: opts.json,
    meta: {
      enumGroups: enums.length,
      departments: departments.length,
      ...(opts.out ? { writtenTo: opts.out } : {}),
    },
    renderHuman: () => {
      /* eslint-disable no-console */
      console.log(`generatedAt: ${payload.generatedAt}`);
      console.log(`enum groups: ${enums.length}`);
      for (const g of enums) {
        console.log(`  ${g.type.padEnd(16)} ${g.values.length} value(s)`);
      }
      console.log(`departments: ${departments.length}`);
      if (opts.out) console.log(`wrote: ${opts.out}`);
      /* eslint-enable no-console */
    },
  });
}

function groupDictionary(dict: readonly Dictionary[]): DictGroup[] {
  const byType = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of dict) {
    const type = String(row.type);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push({
      id: String(row.attrValue ?? ''),
      name: row.attrName ?? '',
    });
  }
  return [...byType.entries()]
    .map(([type, values]) => ({ type, values }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

function toDeptEntry(d: Department): Record<string, unknown> {
  return {
    id: String(d.id),
    name: d.deptName ?? '',
    deptCode: d.deptCode ?? null,
    buCode: d.buCode ?? null,
    parentId: (d as { parentId?: unknown }).parentId ?? null,
  };
}

export interface SchemaCommandsOpts {
  readonly json?: boolean;
}

/**
 * Introspect the live Commander program so the command list never drifts from
 * what the user actually has installed.
 */
export function schemaCommandsCmd(program: Command, opts: SchemaCommandsOpts): void {
  const commands = collectCommands(program, []);
  printResult(
    { commands },
    {
      json: opts.json,
      meta: { count: commands.length },
      renderHuman: () => {
        /* eslint-disable no-console */
        for (const c of commands) {
          console.log(`${c.path.padEnd(28)} ${c.description}`);
        }
        /* eslint-enable no-console */
      },
    },
  );
}

interface CommandEntry {
  readonly path: string;
  readonly description: string;
  readonly args: ReadonlyArray<{ name: string; required: boolean }>;
  readonly options: ReadonlyArray<{
    flags: string;
    description: string;
    required: boolean;
    default?: unknown;
  }>;
  readonly subcommands: ReadonlyArray<string>;
}

function collectCommands(node: Command, parents: readonly string[]): CommandEntry[] {
  const out: CommandEntry[] = [];
  const name = node.name();
  const here = name === 'atlas' ? [] : [...parents, name];
  const path = ['atlas', ...here].join(' ');

  // Skip the root program; only emit real subcommands.
  if (here.length > 0) {
    const args = node.registeredArguments?.map((a) => ({
      name: a.name(),
      required: a.required,
    })) ?? [];
    const options = node.options.map((o) => ({
      flags: o.flags,
      description: o.description ?? '',
      required: o.required ?? false,
      ...(o.defaultValue !== undefined ? { default: o.defaultValue } : {}),
    }));
    out.push({
      path,
      description: node.description() ?? '',
      args,
      options,
      subcommands: node.commands.map((c) => c.name()),
    });
  }

  for (const child of node.commands) {
    out.push(...collectCommands(child, here));
  }
  return out;
}

export function parseSubcommand(raw: string): 'export' | 'commands' {
  if (raw === 'export') return 'export';
  if (raw === 'commands') return 'commands';
  throw new ConfigError(`schema <subcommand> must be export|commands (got "${raw}")`);
}
