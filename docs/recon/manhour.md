# Banma Yuntu Manpower (实际工时) — Recon Notes

> Discovered 2026-06-06 from SPA bundle analysis (`index-CoeHsioo.js`) and API probing.
> Domain: `https://banma-yuntu.alibaba-inc.com`
> API prefix: `/yuntu-service/yida/manpower/`
> Frontend page: `/manpowers/confirm/projectWeek?month=2026-06&cycle=1&project=2027`

---

## 1. Endpoint Catalog

### 1.1 Read Endpoints (confirmed working)

| Method | Path | Params | Response | Purpose |
|---|---|---|---|---|
| **GET** | `/yuntu-service/yida/manpower/getProjMpConfirmDetail.json` | `month` (YYYY-MM), `projectList` (projectId), `staff_ID` (empId), `status` (**number**: 0=pending, 1=approved) | `{ hc, mp, projMp[], teamMp[] }` | **Primary endpoint**: Project-level manpower confirmation detail. Returns tree structure of teams/staff with weekly actuals. |
| **GET** | `/yuntu-service/yida/manpower/getManpowerApprovalsByStaffId.json` | `staff_ID` (empId), `month` (YYYY-MM, optional) | `[]` (array) | Per-staff approval records. Returns empty for current user in test. |

### 1.2 Endpoints confirmed to exist (return errors, need correct params)

| Method | Path | Known Params | Notes |
|---|---|---|---|
| **GET** | `/yuntu-service/yida/manpower/getTeamProjectConfirmByProjectId.json` | `month`, `projectId`, `status` (number) | Returns "Unknown banma API error" with test params — may need different projectId format or permissions |
| **GET** | `/yuntu-service/yida/manpower/getProjectManpowerDetail.json` | `month`, `staff_ID` | Returns "Unknown banma API error" — per-staff detail |
| **GET** | `/yuntu-service/yida/manpower/confirmProjectManpowerDetail.json` | `month`, `ids`, `staff_ID` | Returns 500 — `ids` probably needs staff IDs to confirm |
| **GET** | `/yuntu-service/yida/manpower/getProjectManpowerDetailChangeLog.json` | `month`, `projectId` | Returns 500 — change log for detail modifications |

### 1.3 Write Endpoints (confirmed to exist, NOT to be called in read-only mode)

| Method | Path | Notes |
|---|---|---|
| **POST** | `/yuntu-service/yida/manpower/approveMonthManpower.json` | Returns 500 with empty body — approval action |
| **POST** | `/yuntu-service/yida/manpower/confirmProjectManpowerDetailByStaffIds.json` | Returns 500 with empty body — FormData: `month`, `projectId`, `staffIds`, `status`, `refuseMark`, `currentStaffId` |

---

## 2. Key Data Structure: `getProjMpConfirmDetail` Response

```json
{
  "hc": 9,       // headcount total
  "mp": 0,       // manpower total (actual hours?)
  "projMp": [],  // project-level manpower entries (array, may be empty)
  "teamMp": [    // team-level manpower tree (nested)
    {
      "p": null,       // parent group info
      "c": [           // children (team members or sub-groups)
        {
          "p": null,
          "c": [       // leaf nodes (individual staff)
            {
              "p": null,
              "weeklyActuals": null,  // weekly actual hours data (null if no data)
              "r": "",                // role/remark
              "d": "527449",          // staff ID (工号)
              "t": 0,                 // total hours (number)
              "h": "1",               // headcount (string)
              "historyManpower": "",  // historical manpower changes
              "m": "0",               // month status (?) as string
              "n": "王野平 - 527449",  // name - staffId
              "s": 1                  // (optional) approval status
            }
          ],
          "d": "527449",      // group/team staff ID
          "t": 1,             // total for this group
          "h": "9",           // headcount for this group
          "m": "0",           // group status
          "n": "王野平 - 527449"  // group leader name
        }
      ],
      "d": "065527",
      "t": 1,
      "h": "9",
      "m": "0",
      "n": "范正斌 - 065527"
    }
  ]
}
```

### Field Mapping (from SPA code analysis)

| Field | Type | Description |
|---|---|---|
| `hc` | number | Headcount total |
| `mp` | number | Manpower total (may represent approved hours) |
| `projMp` | array | Project-level manpower entries (seems to be empty in our test) |
| `teamMp` | array | Tree structure of teams → staff with hours |
| `p` | object/null | Parent group info |
| `c` | array | Children (sub-teams or individuals) |
| `d` | string | Staff ID (employee number) |
| `n` | string | Display name in format "姓名 - 工号" |
| `r` | string | Role/remark |
| `t` | number | Total (subtotal for group or individual) |
| `h` | string | Headcount (string-formatted number) |
| `m` | string | Month status or metadata |
| `s` | number | (optional) Approval status — seen on some leaf nodes with value `1` |
| `weeklyActuals` | array/null | Weekly actual hours data — **KEY FIELD** for actual hours |
| `historyManpower` | string | Historical manpower change info |

### Status Parameter

| Value | Meaning |
|---|---|
| `0` | Pending (待审批) |
| `1` | Approved (已审批) |

---

## 3. Parameter Details

### `month` Parameter
- Format: `YYYY-MM` (e.g., `"2026-06"`)
- Used across all endpoints

### `projectList` Parameter (getProjMpConfirmDetail)
- Single project: just the project ID as string (e.g., `"2027"`)
- Multiple projects: possibly comma-separated (not confirmed)

### `projectId` Parameter (getTeamProjectConfirmByProjectId)
- Project ID as string (e.g., `"2027"`)

### `staff_ID` Parameter
- Employee ID / 工号 (e.g., `"527449"`)

### `status` Parameter
- **Must be a number, not a string** (Zod validation on server)
- `0` = pending, `1` = approved
- Required for `getProjMpConfirmDetail`

---

## 4. Relationship to Existing `line/plan/month/select.json` (基线数据)

| Feature | 基线 (month) | 实际工时 (actual) |
|---|---|---|
| API prefix | `/yuntu-service/line/plan/` | `/yuntu-service/yida/manpower/` |
| Primary endpoint | `month/select.json` | `getProjMpConfirmDetail.json` |
| Method | POST | GET |
| Data structure | Flat array of (dept, role, remark) rows with `linePlanMonthDetailList` | Nested tree of teams → staff with `weeklyActuals` |
| Time granularity | Monthly (`month` as epoch ms, `manpower` as float) | Weekly (`weeklyActuals`) + Monthly |
| Approval status | N/A (baseline is always "approved") | `status` filter: 0=pending, 1=approved |
| Grouping | By department + role + remark | By team leader → individual staff |

---

## 5. Implementation Notes

### API Client Changes
- The `BanmaClient.request()` method passes query params as strings via URL encoding.
- The `status` parameter must be numeric — needs special handling in the URL (e.g., `?status=0` not `?status="0"`).
- GET params not POST body for these endpoints.

### `weeklyActuals` field
- May be `null` when no data exists for the month.
- When populated, likely contains an array of weekly entries with hours.
- Need to test with a month that has actual data (older months where people have filled in timesheets).

### Tree Structure Flattening
- `teamMp` is a tree structure that needs to be flattened for CLI display.
- Each node has `c` (children), `d` (staffId), `n` (name), plus hours data.
- Leaf nodes (individuals) have `weeklyActuals`, `t` (total), `h` (headcount).
- Group nodes aggregate `t` and `h`.

### CLI Command Design
- `atlas actual` — new command for actual manpower queries
  - `atlas actual` (default: current month, pending + approved)
  - `atlas actual --month 2026-05` (specific month)
  - `atlas actual --status approved` (only approved)
  - `atlas actual --status pending` (only pending)
  - `atlas actual --by month|department|role` (summaries, like `summary`)
