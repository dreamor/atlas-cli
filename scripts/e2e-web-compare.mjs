/**
 * E2E 网页 × CLI 数据比对脚本
 * 运行: node scripts/e2e-web-compare.mjs
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { loadSession } from '../dist/adapters/atlas/auth/session.js';

const PROJECT = '2548';
const BASE = 'https://banma-yuntu.alibaba-inc.com';

function cli(cmd) {
  const out = execSync(`node dist/adapters/atlas/cli.js ${cmd}`, { encoding: 'utf-8', timeout: 30000 });
  const lines = out.trim().split('\n').filter(l => l.startsWith('{'));
  return JSON.parse(lines[lines.length - 1]);
}

async function run() {
  const session = await loadSession();
  if (!session) { console.error('No session'); process.exit(1); }

  const cookies = Array.isArray(session.cookies)
    ? session.cookies.map(c => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path,
        expires: Math.floor(c.expires ?? (Date.now()/1000+86400)),
        httpOnly: c.httpOnly ?? false, secure: c.secure ?? false,
        sameSite: c.sameSite ?? 'Lax',
      }))
    : [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' });
  if (cookies.length > 0) await context.addCookies(cookies);
  const page = await context.newPage();

  const apiResponses = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('line/plan') || url.includes('mpLine') || url.includes('manpower') || url.includes('mpConfirm')) {
      try {
        const body = await resp.json();
        apiResponses.push({ url: url.substring(0, 150), body });
      } catch {}
    }
  });

  // =====================================================
  // 1. 基线页面
  // =====================================================
  console.log('\n═══════════════════════════════════════════');
  console.log('1️⃣  基线数据 — 网页 vs CLI');
  console.log('═══════════════════════════════════════════');
  await page.goto(`${BASE}/projects/mpLine/list?projectId=${PROJECT}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  console.log(`页面: "${await page.title()}"`);
  console.log(`URL:  ${page.url()}`);
  console.log();

  // CLI 数据
  const cliMonth = cli(`baseline month --project-id ${PROJECT} --json`);
  const cliTotal = cliMonth.data.rows.reduce((s, r) => s + Object.values(r.months).reduce((a, b) => a + b, 0), 0);
  console.log(`CLI baseline month: ${cliMonth.data.rows.length} rows, ${cliMonth.data.monthColumns.length} months, total ${cliTotal.toFixed(2)} 人月`);

  // 拦截到的 API 响应
  console.log(`\n拦截到 ${apiResponses.length} 个基线 API 响应:`);
  for (const ar of apiResponses) {
    const body = ar.body;
    const isArr = Array.isArray(body);
    const topKeys = isArr ? (body.length > 0 ? Object.keys(body[0]).slice(0,6) : []) : Object.keys(body).slice(0,6);
    console.log(`  ${ar.url.includes('month') ? '📅' : '📋'} ${ar.url.replace(/https:\/\/[^/]+/, '')}`);
    console.log(`     type=${isArr ? 'array['+body.length+']' : 'object'} keys=${topKeys.join(', ')}`);

    // 提取数据
    let items = isArr ? body : (body.data ?? body.items ?? body.rows ?? body.result ?? []);
    if (!Array.isArray(items)) items = [];

    if (items.length > 0) {
      const first = items[0];
      if ('linePlanMonthDetailList' in first) {
        // monthly 格式
        let sum = 0;
        for (const item of items) {
          for (const d of item.linePlanMonthDetailList ?? []) sum += Number(d.manpower ?? 0);
        }
        console.log(`     ${items.length} 行月度数据, 总计 ${sum.toFixed(2)} 人月`);
      } else if ('month' in first || Object.keys(first).some(k => /^\d{4}/.test(k))) {
        // 月度透视格式
        const total = items.reduce((s, r) => s + Object.entries(r).filter(([k]) => /^\d{4}/.test(k)).reduce((a, [,v]) => a + Number(v), 0), 0);
        console.log(`     ${items.length} 行透视数据, 总计 ${total.toFixed(2)} 人月`);
      } else {
        console.log(`     ${items.length} 项, 第1项: ${JSON.stringify(first).substring(0,100)}`);
      }
    }
  }

  // 页面文本提取
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const totalLines = lines.filter(l => l.includes('合计') || l.includes('总计') || l.includes('Total'));
  console.log(`\n页面合计行: ${totalLines.join(' | ').substring(0, 200)}`);

  // =====================================================
  // 2. FBI 实际工时页面
  // =====================================================
  console.log('\n═══════════════════════════════════════════');
  console.log('2️⃣  FBI 实际工时报表');
  console.log('═══════════════════════════════════════════');

  const fbiUrl = 'https://fbi.alibaba-inc.com/dashboard/view/page.htm?id=519791&project_id=2548&status=%E8%BF%9B%E8%A1%8C%E4%B8%AD';
  await page.goto(fbiUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);

  const fbiTitle = await page.title();
  const fbiUrl_ = page.url();
  const fbiText = await page.evaluate(() => document.body.innerText).catch(() => '(error)');

  console.log(`FBI 标题: "${fbiTitle}"`);
  console.log(`FBI URL:  ${fbiUrl_}`);

  if (fbiUrl_.includes('login') || fbiTitle.includes('登录')) {
    console.log('\n❌ FBI 需要单独登录，无法自动提取数据。');
    console.log('\n以下为 CLI 各月份实际工时数据，请对照 FBI 报表人工校验:');
  } else {
    console.log(`✅ FBI 页面可访问`);
    console.log(`页面文本 (前 600): ${fbiText.substring(0, 600)}`);
  }

  // CLI 实际工时各月
  console.log('\n📊 CLI 各月实际工时汇总:');
  for (const m of ['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06']) {
    try {
      const r = cli(`actual summary --project-id ${PROJECT} --by month --month ${m} --json`);
      const total = r.data?.entries?.reduce((a,e) => a + e.total, 0) ?? 0;
      if (total > 0) {
        console.log(`  ${m}（审批）: ${total.toFixed(1)} 人天 → ${(total/22).toFixed(2)} 人月`);
      }
    } catch {}
  }

  // compare 验证
  console.log('\n📊 CLI compare 基线 vs 实际:');
  const cmp = cli(`compare --project-id ${PROJECT} --by month --from 2025-09 --to 2025-12 --json`);
  console.log(`  baselineTotal: ${cmp.data.baselineTotal.toFixed(2)} 人月`);
  console.log(`  actualTotal:   ${cmp.data.actualTotal.toFixed(2)} 人月`);
  for (const e of cmp.data.entries) {
    console.log(`  ${e.key}: baseline=${e.baseline.toFixed(3)} actual=${e.actual.toFixed(3)} diff=${e.diff.toFixed(3)}`);
  }

  await browser.close();
  console.log('\n✅ 完成');
}

run().catch(e => { console.error(e); process.exit(1); });