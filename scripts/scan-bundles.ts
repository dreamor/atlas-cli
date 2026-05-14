import { readFileSync, readdirSync } from 'fs';
const dir = '.opencli/recon/bundles';
const files = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js');
const allEndpoints = new Map<string, string[]>();
for (const f of files) {
  const text = readFileSync(`${dir}/${f}`, 'utf8');
  const found = new Set<string>();
  const re = /["'`](\/yuntu-service\/[A-Za-z0-9_./-]+?\.json)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) if (m[1]) found.add(m[1]);
  if (found.size) allEndpoints.set(f, [...found]);
}
for (const [f, eps] of allEndpoints) {
  console.log(`\n--- ${f} (${eps.length}) ---`);
  eps.sort().forEach((e) => console.log('  ' + e));
}
