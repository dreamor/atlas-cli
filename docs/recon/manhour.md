# Banma Yuntu Manpower (实际工时) — Recon Notes

> 初始调研 2026-06-06，2026-06-10 更新：CLI 已切换至新 API。
> 旧 API（`/yuntu-service/yida/manpower/`）不再使用，仅供 E2E 测试 mock 引用。
> 新 API 行为已通过 E2E 测试验证（`tests/e2e-web-vs-cli.test.ts`）。

---

## 1. Endpoint Catalog

### 1.1 当前使用的主 API（summaryByTeam）

| Method | Path | 请求体 | 响应 | 用途 |
|--------|------|--------|------|------|
| **POST** | `/yuntu-service/manpower/weekly/summaryByTeam.json` | `{ month, staffIds, projectIds, isConfirm, loginStaffId }` | `{ data: WeeklySummaryNode[] }` | **主端点**：按月获取全量实际工时，按团队维度组织，返回值为**人月** |

请求体示例：

```json
{
  "month": "2026-06",
  "staffIds": [],
  "projectIds": [],
  "isConfirm": false,
  "loginStaffId": "527449"
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `month` | string | YYYY-MM 格式 |
| `staffIds` | string[] | 留空数组返回全量 |
| `projectIds` | string[] | 项目过滤 |
| `isConfirm` | boolean | `false`=全量，`true`=仅已确认 |
| `loginStaffId` | string | 当前登录用户工号 |

> **注意**：页面端"各项目显示值"的过滤（已填/已填已批/已确认等）是前端实现的，API 始终返回全量数据。
> CLI 采用同样的策略（方案 B）：全量拉到本地，按业务规则过滤。

### 1.2 还有另一个视图：summaryByProject

| Method | Path | 说明 |
|--------|------|------|
| **POST** | `/yuntu-service/manpower/weekly/summaryByProject.json` | 与 summaryByTeam 请求体相同，但响应按项目维度聚合。CLI 目前只用 summaryByTeam。 |

### 1.3 辅助端点

| Method | Path | 说明 |
|--------|------|------|
| **GET** | `/yuntu-service/manpower/weekly/calendar/select.json?month=2026-06` | 返回该月的周期信息（第1~4周期的工作日天数） |
| **POST** | `/yuntu-service/manpower/weekly/approval/selectRunning.json` | `{ month }` 返回运行中的审批流 |

### 1.4 旧 API（已废弃，仅测试用）

| Method | Path | 说明 |
|--------|------|------|
| **GET** | `/yuntu-service/yida/manpower/getProjMpConfirmDetail.json` | ⛔ 已废弃。数据单位为人天，需 `/22` 转人月，且经常 500。 |

---

## 2. 关键数据结构：summaryByTeam 响应

```json
{
  "status": 1,
  "code": 1,
  "errCode": "1",
  "errorMsg": null,
  "success": true,
  "data": [
    {
      "staffId": "527449",
      "realname": "王野平",
      "manpower": 28.0,
      "status": null,
      "detail": null,
      "isExcept": false,
      "hc": 189,
      "cycleHc": null,
      "children": [
        {
          "staffId": "092480",
          "realname": "李海鸥",
          "manpower": 5.0,
          "status": null,
          "detail": [
            {
              "id": 193956,
              "manpower": 5.0,
              "cycle": 1,
              "month": 1780243200000,
              "projectId": 2548,
              "projectName": "BMW IPA LLM 0726 项目",
              "status": 0,
              "remark": "项目管理",
              "confirmStaffId": "SYSTEM",
              "confirmStatus": null,
              "except": false
            }
          ],
          "isExcept": false,
          "hc": 21,
          "cycleHc": { "1": 5, "2": 5, "3": 4, "4": 7 },
          "children": null,
          "role": "项目管理",
          "department": "斑马网络-斑马智行-PMO-I组",
          "locationDesc": "北京-北京-..."
        }
      ]
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `staffId` | string | 工号 |
| `realname` | string | 姓名 |
| `manpower` | number | 合计人月（**已是人月，无需 ÷22**） |
| `hc` | number | 人头数 |
| `cycleHc` | object/null | 各周期工作日，如 `{ "1": 5, "2": 5, "3": 4, "4": 7 }` |
| `children` | array | 子节点（团队负责人下有成员） |
| `detail` | array | 明细条目（人员 × 项目 × 周期） |
| `role` | string | 角色 |
| `department` | string | 部门全路径 |
| `locationDesc` | string | 办公地点 |
| `isExcept` | boolean | 是否外包/例外人员 |
| `except` | boolean（detail 内） | 是否例外人员 |

### detail[] 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 记录 ID |
| `manpower` | number | **人月**（无需 ÷22） |
| `cycle` | number | 周期 1-4 |
| `month` | number | 月份（epoch ms） |
| `projectId` | number | 项目 ID |
| `projectName` | string | 项目名称 |
| `status` | number | 审批状态（见下方） |
| `remark` | string | 填报备注 |
| `confirmStaffId` | string | 确认人 |
| `confirmStatus` | number/string | 确认状态 |

---

## 3. 审批状态枚举

通过页面过滤器和 API 响应数据交叉分析：

| status | 页面标签 | 说明 |
|--------|----------|------|
| `0` | 已填 | 已提交填报，可能含已批/未批混合 |
| `1` | 已填(已批) | 主管已审批 |
| `2` | 已确认 | PM 已确认 |
| 拒绝 | 已拒绝 | 被拒绝 |
| null/无 | 未确认 | 有填报但 PM 未确认 |

### CLI 的智能过滤规则（`filterActualByBusinessRule`）

- **过去月份**（< 当前月）→ 只显示 **已确认**（`status === 2`）
- **当前月份**（= 当前月）→ 显示所有已填数据
- `--status all` 可覆盖默认行为

---

## 4. 页面过滤器说明

页面 "人力汇总" (`/manpowers/statistics`) 的过滤器：
- **盘点月份**：按月选择
- **周期**：全部/第1~4周期
- **各项目显示值**：已填/已填(已批)/已填(未批)/已确认/已拒绝/未确认
- **项目/项目集**：下拉选择
- **人员范围**：按工号/姓名搜索

两个 Tab：
- **团队**：按团队织看（你的下属在各项目的人力分布）
- **项目**：按项目看（各项目在各团队的人力分布）

两种视图共享同一 API（summaryByTeam / summaryByProject），仅前端渲染方式不同。

---

## 5. 与旧 API 的对比

| 对比项 | 旧 API (`yida/manpower/`) | 新 API (`weekly/summaryByTeam`) |
|--------|--------------------------|-------------------------------|
| **数据单位** | 人天（需 ÷22） | **人月** ✅ |
| **调用次数** | 每月需 2 次（status=0 + status=1） | **每月 1 次** ✅ |
| **稳定性** | ❌ 频繁 500 | ✅ 稳定 |
| **部门/角色** | 从树结构推断 | **直接返回** ✅ |
| **周期信息** | 无 | `cycle` + `cycleHc` 工作日 ✅ |
| **项目过滤** | 需拆分为多项目查询 | `projectIds[]` 参数 ✅ |

---

## 6. 实现要点

### Flattern 逻辑（`flattenWeeklySummary`）

`_actual_logic.ts` 中的 `flattenWeeklySummary()` 递归遍历 `data[]` 树：
- `children` 非空 → 递归，将 `staffId`/`realname` 作为团队负责人传递
- `detail` 非空 → 将每条 detail 展开为 `ManpowerWeeklyActual` 兼容对象
- `manpower` **不做 ÷22**（已是人月）
- `status` 取该成员所有 detail 中的最大值（`CONFIRMED > APPROVED > FILLED`）
- 节点上的 `role`/`department`/`locationDesc` 直接填充

### 智能过滤（`filterActualByBusinessRule`）

```
rows.filter(row → 所在月份 < 当前月 ? status === 2 : true)
```

### 状态常量（`ACTUAL_STATUS`）

```typescript
const ACTUAL_STATUS = {
  FILLED: 0,      // 已填
  APPROVED: 1,    // 已填(已批)
  CONFIRMED: 2,   // 已确认
};
```

---

## 7. 单元/集成测试

| 测试文件 | 类型 | 说明 |
|----------|------|------|
| `tests/manhours.test.ts` | 单元 | mock 测试新 API fetcher 的请求/响应 |
| `tests/actual.test.ts` | 单元 | 纯逻辑测试：flatten/filter/pivot/summarize |
| `tests/e2e-manpower.test.ts` | 集成 | mock 全线数据流（基线 + 实际） |
| `tests/e2e-web-vs-cli.test.ts` | E2E | 真实 API 调用，验证 CLI 输出 = 手工计算值 |