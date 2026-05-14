# Banma Yuntu mpLine — Recon Notes

> Source: `.opencli/recon/xhr-log.jsonl` (94 raw entries → 47 req/resp pairs → 19 unique API endpoints).
> Captured 2026-05-13 from `https://banma-yuntu.alibaba-inc.com/projects/mpLine/list?projectId=2548`.
> Recon was **read-only**: no create / update / delete flows were exercised — see [Open Questions](#open-questions).

---

## 1. Base origin & auth

| | |
|---|---|
| **Origin** | `https://banma-yuntu.alibaba-inc.com` |
| **API prefix** | `/yuntu-service/...` (most endpoints) and a few page-level routes under `/projects/...` and `/user/info` |
| **Auth model** | BUC SSO cookie + custom mirrored headers on every XHR |
| **No CSRF token rotation observed** — token is the BUC bearer itself, repeated in headers |

### Cookies (set by SSO, sent on every request)

```
SSO_REFRESH_TOKEN, SSO_EMPID_HASH_V2, SSO_BU_HASH_V2,
access_token, access_token.sig, refresh_token, refresh_token.sig,
buc_userinfo, buc_userinfo.sig, buc_username, buc_username.sig,
cna, x_umt, xlly_s, sgcookie, isg, __itrace_wid, x_mini_wua, x_sign, tfstk
```

The session-bearing cookies are the `access_token*` / `refresh_token*` / `buc_*` family. Everything else is ALB / risk-control noise but **must be replayed verbatim** because the gateway sniffs them.

### Auth headers mirrored on every XHR

```
token:               buc<40-hex>
x-banma-token:       buc<40-hex>          ← same value as `token`
x-banma-staff-id:    <empId, 6 digits>
x-banma-user:        <domain.account>
x-banma-company-id:  <empty in this session>
```

The CLI must:
1. Parse cookies after SSO and persist the full cookie jar in macOS Keychain (the BUC token TTL is short — refresh on 401).
2. Re-emit the four `x-banma-*` / `token` headers on every XHR (extract empId, account, BUC token from `/user/info` once).

---

## 2. Endpoint catalog

### 2.1 mpLine — page shell (HTML, not API)

| Method | Path | Type | Notes |
|---|---|---|---|
| GET | `/projects/mpLine/list?projectId=<id>` | page | Returns the SPA HTML; no JSON. Useful only as the recon entrypoint. |
| GET | `/projects/mpLine/total/list?projectId=<id>` | page | Same shell, "总量" tab. |

### 2.2 Project context

| Method | Path | Type | Query / Body | Response |
|---|---|---|---|---|
| GET | `/yuntu-service/projApi/queryProjById.json` | detail | `projId=<id>` | `data.projInfo: { id, projName, gmtCreate, gmtModified, tempId, tempInfo, version, startTime, endTime, creator, planManpower, contractIds, ... }` |
| GET | `/yuntu-service/pmpProjectTeam/isProjCordMember.json` | metadata | `projectId=<id>` | `{ status, data }` — boolean-ish |
| GET | `/yuntu-service/project/featchBugSummary.json` | metadata | `projectId, dayS12, day` | bug summary aggregate |
| GET | `/yuntu-service/tpmMetric/fetchTpmMetric.json` | metadata | `projId=<id>` | `data: [{ needCloseCount, closeRate, planCloseRate, resolveRate, aoneUrlTotal, ... }]` |
| POST | `/yuntu-service/project/selectHasPermisValidProject.json` | list | `{}` | `data: [{ id, name }]` — **all projects the user has access to** (use this for project autocomplete in CLI) |

### 2.3 mpLine items — the actual data

| Method | Path | Type | Body | Response |
|---|---|---|---|---|
| **POST** | `/yuntu-service/line/plan/select.json` | **list** | `{ "projectId": "2548" }` | `data: LinePlan[]` (see schema below) |
| **POST** | `/yuntu-service/line/plan/month/select.json` | list | `{ "projectId": "2548" }` (assumed) | monthly view of `LinePlan` |

**`LinePlan` item shape (from `line/plan/select.json`):**

```
id, gmtCreate, gmtModified, isDeleted,
projectId, departmentId,
mpType, areaCode, mp,
linePlanType, changeTime, createAt,
srcType, projectIds
```

This is the **primary read endpoint** for the CLI's `list` and `export` commands. Body is just `{projectId}` — no pagination params observed (the recon dataset was small; pagination may kick in for larger projects — see Open Questions).

### 2.4 Reference / dictionary data

| Method | Path | Type | Body | Notes |
|---|---|---|---|---|
| POST | `/yuntu-service/dictionary/select.json` | metadata | `{}` | Returns the full enum dictionary: `[{ id, type, typeDesc, attrName, attrValue, ids, extendValue }]`. Cache locally; resolve enum codes (e.g. `mpType`, `linePlanType`, `srcType`) via this. |
| POST | `/yuntu-service/department/tree/select.json` | metadata | `{}` | Department tree: `[{ id, deptCode, deptName, buCode, buCorpCode, parentDepartmentNode, ... }]`. Resolves `departmentId` on `LinePlan`. |
| GET | `/yuntu-service/version/getPMPVersionList.json` | metadata | – | Versions catalog. |
| GET | `/yuntu-service/stand/queryTestStandList.json` | metadata | `isTemplate, status` | Test standard templates. |
| GET | `/yuntu-service/scm/aone/repo/list.json` | metadata | – | Aone code repos. |
| GET | `/yuntu-service/scm/getBranchDataListFromScm.json` | metadata | – | SCM branches. |

### 2.5 User / session

| Method | Path | Type | Notes |
|---|---|---|---|
| GET | `/user/info` | metadata | `data: { account, account_id, emp_id, name, locale, perm_list, token, ... }` — **the cleanest place to extract `x-banma-*` header values**. Call this once per session. |
| GET | `/yuntu-service/cloud/instance/checkBatchPermission.json` | metadata | Permission probe; returns standard envelope. |
| POST | `/yuntu-service/myPage/getMyTaskNum.json` | metadata | `data: { taskCount, reviewCount }` |

### 2.6 Telemetry (CLI should NOT replay)

| Method | Path |
|---|---|
| POST | `/yuntu-service/visit/insertSelective.json` |

This is page-view tracking. Skip.

---

## 3. Response envelope

Every `/yuntu-service/...` endpoint uses one of these two shapes:

**Standard envelope:**
```json
{ "status": 1, "code": 1, "errCode": "1", "errorMsg": null, "success": true, "data": ... }
```

**Slim envelope** (some endpoints):
```json
{ "status": 1, "data": ... }
```

The adapter should treat `success === true && code === 1` (or simply `status === 1` for the slim variant) as success. On error, `errorMsg` is the human-readable message and `errCode` is a numeric string.

---

## 4. Pagination

**Not observed in this recon.** All list endpoints (`line/plan/select.json`, `dictionary/select.json`, `department/tree/select.json`, `selectHasPermisValidProject.json`) returned the entire dataset in one POST without `page`/`size` parameters.

Hypotheses to confirm in Step 2 with a larger project:
- Backend may accept optional `pageNum`/`pageSize` (Alibaba convention).
- Or the dataset for project 2548 is small enough to fit in one call (`line/plan/select.json` returned `array[1]`).

The CLI should:
- Default to "fetch-all" for now.
- Support a `--page-size` / `--page` flag for forward-compat that gets injected into the POST body if present.
- Detect server-side pagination by inspecting response keys for `total` / `pageNum` / `hasMore` (none observed yet).

---

## 5. `projectId` flow

| Endpoint | Where projectId goes | Form |
|---|---|---|
| `projApi/queryProjById.json` | **query** | `?projId=2548` (note: `projId`, not `projectId`) |
| `tpmMetric/fetchTpmMetric.json` | **query** | `?projId=2548` |
| `pmpProjectTeam/isProjCordMember.json` | **query** | `?projectId=2548` |
| `project/featchBugSummary.json` | **query** | `?projectId=2548` (sic — typo in upstream path) |
| `line/plan/select.json` | **body** | `{"projectId":"2548"}` (string!) |
| `line/plan/month/select.json` | **body** | `{"projectId":"2548"}` (assumed) |

CLI must:
- Accept `--project-id <int>` (or `BANMA_PROJECT_ID` env).
- **Stringify** when injecting into POST bodies.
- Use the right param name per endpoint (`projId` vs `projectId`).
- Never hard-code `2548`.

---

## 6. CSRF / signing

**No CSRF token, no request signing observed.** The auth model is pure cookie + bearer-mirroring header. This is good news for replay:

- Once the CLI has cookies + `(empId, account, bucToken)`, every XHR can be replayed with `undici` directly. No JS-side signing, no nonce, no HMAC.
- Risk control may still flag headless / non-Chrome user agents — replay with the same UA Playwright captured (recon already keeps it in cookies; sniff `headers["user-agent"]` once).

---

## 7. Field schema / dictionaries

The platform uses a centralized dictionary at `/yuntu-service/dictionary/select.json`. Each entry:
```
{ id, type, typeDesc, attrName, attrValue }
```

Examples seen:
- `type=1, typeDesc="报价类型", attrName="预报价", attrValue="1"`

The CLI should:
- On `auth login`, fetch `dictionary/select.json` once and cache to `~/.cache/atlas/dictionary.json`.
- Use it to resolve `mpType` / `linePlanType` / `srcType` codes when rendering tables.
- Refresh the cache on `--refresh-dictionary` or after 24h.

Department resolution works similarly via `department/tree/select.json`.

---

## 8. Open questions (resolved via static recon — see §10)

Static analysis of the SPA bundle (`index-dpcEnnVr.js`) on 2026-05-14
resolved every write-side question. See [§10](#10-write-endpoints-static-recon).

---

## 9. Implementation handoff (for Step 2)

The adapter `adapters/atlas/` should layer:

1. **`auth/`** — Playwright headed login → extract cookies + `(empId, account, bucToken)` from `/user/info` → persist via `keytar`.
2. **`http/`** — `undici` Pool with:
   - cookie jar replay
   - auto-injection of `token, x-banma-token, x-banma-staff-id, x-banma-user, x-banma-company-id`
   - response envelope unwrapping (`status === 1` check)
   - exponential backoff with jitter on 5xx / 429
   - 401 → mark session expired → exit non-zero with "run `banma auth login`"
3. **`schema/`** — zod schemas for `LinePlan`, `Project`, `Dictionary`, envelope, paginated wrapper (forward-compat).
4. **`commands/`** — `auth login`, `list`, `show`, `export`, `fill --dry-run`, `import --dry-run` per spec; mutating commands halt until create/update endpoints are confirmed in re-recon.
5. **`dict/`** — local dictionary cache + lookup helpers.

---

## 10. Write endpoints (static recon)

Discovered by grepping `assets/index-dpcEnnVr.js` (5 MB main bundle) on
2026-05-14 — see `scripts/static-recon.ts`. The SPA wraps every backend call
through a single axios instance `we`, with `tt = '/yuntu-service'`. The full
mpLine CRUD surface lives in one block of factory functions:

| Endpoint | Method | Body shape | Purpose |
|---|---|---|---|
| `/yuntu-service/line/plan/select.json` | POST | `{projectId}` | **Sparse base table** — metadata only (id, mpType, linePlanType, srcType, departmentId, areaCode, mp, …). No per-month manpower. Surfaced via `atlas list`. |
| `/yuntu-service/line/plan/save.json?projectId=<id>` | POST | array (or single object) | **Upsert** — insert + update fused; `id` present → update, absent → insert |
| `/yuntu-service/line/plan/delete.json` | POST | `{id}` or `[{id}]` (TBD on first call) | Delete LinePlan row |
| `/yuntu-service/line/plan/month/select.json` | POST | `{projectId}` | **Rich rolling baseline (人力基线汇总)** — array of (department, role, remark) rows, each carrying `linePlanMonthDetailList: [{ month: <epoch ms>, manpower: <float> }, …]`. This is what users mean by "月度人力". Surfaced via `atlas month` / `summary`. |
| `/yuntu-service/line/plan/month/save.json?projectId=<id>` | POST | array of month rows | Upsert month |
| `/yuntu-service/line/plan/month/delete.json` | POST | `{id}` | Delete month row |
| `/yuntu-service/line/plan/month/detail/save.json` | POST | array of detail rows | Upsert per-month manpower entries |
| `/yuntu-service/line/plan/month/detail/delete.json` | POST | `{id}` | Delete one detail entry |
| `/yuntu-service/line/plan/month/import.json` | POST `multipart/form-data` | `projectId=<id>` + `file=<.xlsx>` | **Bulk import from Excel** — direct match for the CLI `import` command |

### Notes on save shape

The factory:
```js
function te(me, Le) { return we.post(`${tt}/line/plan/save.json?projectId=${Le}`, me) }
```
takes `me` (the body) and `Le` (the projectId). Body shape inferred from
how the SPA calls it (still to confirm by single dry-run with `--apply`):
- For `line/plan/save.json`: array of LinePlan-like objects. `id` triggers
  update; missing `id` triggers insert. Server returns the merged set.
- For `line/plan/month/import.json`: standard multipart, two fields
  (`projectId` text, `file` blob).

### No single-item detail endpoint

The bundle contains **no** `line/plan/detail.json` or similar. The SPA
loads the full list via `select.json` and renders detail client-side. The
CLI's `show <id>` already does the right thing (filter list).

---

## 11. Implementation plan for `fill` and `import`

- **`fill`** — for each LinePlan (or month row, with `--target month`) in
  the project, render a Jinja-like template with the row's fields,
  optionally call an LLM for derived values, stage updates to a JSON
  file. With `--apply`: POST array of staged updates to
  `line/plan/save.json?projectId=<id>` (lineplan, default) or
  `line/plan/month/save.json?projectId=<id>` (month).
- **`import <file>`** — accept `.xlsx` (preferred — matches server contract
  exactly) or `.csv` (locally convert to `.xlsx`). Validate column headers
  against a known schema, then POST multipart to
  `line/plan/month/import.json` (`--target month`, default — only target
  currently wired). With `--dry-run` (default): just validate and print
  what would be sent.

Both commands MUST default to `--dry-run` and require `--apply` to commit.

### sparse `select` vs rich `month/select`

These two endpoints both exist and return very different shapes. Code
should pick deliberately:

- `line/plan/select.json` — sparse **base** table. One row per (project,
  mpType, linePlanType) tuple, no manpower numbers. CLI `list` + `fill
  --target lineplan`.
- `line/plan/month/select.json` — rich **monthly aggregate** table. One
  row per (department, role, remark) tuple, each row carrying a
  `linePlanMonthDetailList` of (month, manpower) pairs. CLI `month` +
  `summary` + `fill --target month` + `import --target month`.

If the user's question is "how much headcount in 2025-Q2 for the 算法
team?", they want the **month** surface, not `list`.
