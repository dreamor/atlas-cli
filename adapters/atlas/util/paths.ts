import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const HOME = homedir();
export const CONFIG_DIR = resolve(HOME, '.config', 'atlas');
export const SESSION_FILE = resolve(CONFIG_DIR, 'session.json');
export const CACHE_DIR = resolve(HOME, '.cache', 'atlas');
export const DICT_FILE = resolve(CACHE_DIR, 'dictionary.json');
export const DEPT_FILE = resolve(CACHE_DIR, 'department.json');
export const PROJECTS_FILE = resolve(CACHE_DIR, 'projects.json');

export const KEYTAR_SERVICE = 'atlas';
export const KEYTAR_ACCOUNT = 'default';

export const TARGET_HOST = 'banma-yuntu.alibaba-inc.com';
export const BASE_URL = `https://${TARGET_HOST}`;

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
