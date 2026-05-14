import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CACHE_DIR, DEPT_FILE, DICT_FILE } from '../util/paths.js';
import { DepartmentSchema, DictionarySchema, type Department, type Dictionary } from '../schema/models.js';
import type { BanmaClient } from '../http/client.js';

const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheFile<T> {
  readonly fetchedAt: string;
  readonly items: readonly T[];
}

async function isFresh(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return Date.now() - s.mtimeMs < TTL_MS;
  } catch {
    return false;
  }
}

async function readCache<T>(path: string): Promise<readonly T[] | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as CacheFile<T>;
    return parsed.items ?? null;
  } catch {
    return null;
  }
}

async function writeCache<T>(path: string, items: readonly T[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });
  const payload: CacheFile<T> = {
    fetchedAt: new Date().toISOString(),
    items,
  };
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
}

export async function loadDictionary(
  client: BanmaClient,
  opts: { refresh?: boolean } = {},
): Promise<readonly Dictionary[]> {
  if (!opts.refresh && (await isFresh(DICT_FILE))) {
    const cached = await readCache<Dictionary>(DICT_FILE);
    if (cached) return cached;
  }
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/dictionary/select.json',
    method: 'POST',
    body: {},
  });
  const arr = Array.isArray(data) ? data : [];
  const items = arr
    .map((row) => {
      const r = DictionarySchema.safeParse(row);
      return r.success ? r.data : null;
    })
    .filter((x): x is Dictionary => x !== null);
  await writeCache(DICT_FILE, items);
  return items;
}

export async function loadDepartments(
  client: BanmaClient,
  opts: { refresh?: boolean } = {},
): Promise<readonly Department[]> {
  if (!opts.refresh && (await isFresh(DEPT_FILE))) {
    const cached = await readCache<Department>(DEPT_FILE);
    if (cached) return cached;
  }
  const { data } = await client.request<unknown>({
    path: '/yuntu-service/department/tree/select.json',
    method: 'POST',
    body: {},
  });
  const flat = flattenDepartments(data);
  await writeCache(DEPT_FILE, flat);
  return flat;
}

function flattenDepartments(node: unknown, acc: Department[] = []): Department[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) flattenDepartments(child, acc);
    return acc;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const parsed = DepartmentSchema.safeParse(obj);
    if (parsed.success) acc.push(parsed.data);
    const childrenKeys = ['children', 'childList', 'subDepts', 'sub'];
    for (const k of childrenKeys) {
      if (Array.isArray(obj[k])) flattenDepartments(obj[k], acc);
    }
  }
  return acc;
}
