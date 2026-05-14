import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const TEST_DIR = resolve(homedir(), '.config', 'atlas-sandbox-test');

/**
 * 检测是否在沙盒环境中
 * 通过尝试写入配置目录来判断
 */
export async function isSandbox(): Promise<boolean> {
  try {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(resolve(TEST_DIR, 'test'), 'test', 'utf8');
    await rm(TEST_DIR, { recursive: true, force: true });
    return false; // 正常环境
  } catch {
    return true; // 沙盒环境
  }
}

/** 缓存检测结果，避免重复检测 */
let sandboxCache: boolean | null = null;

export async function isSandboxCached(): Promise<boolean> {
  if (sandboxCache === null) {
    sandboxCache = await isSandbox();
  }
  return sandboxCache;
}