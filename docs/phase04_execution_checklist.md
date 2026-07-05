# Phase 0.4 分步执行任务清单

> 严格依据 `docs/integration_plan_phase04.md`  
> **硬性约束**：不改 Proxy/L0/L1/HMAC/EventUploader 核心逻辑；仅新增 cloud 适配层；Home 不动。

---

## 模块完成度（文档第二节快照）

| 模块 | 状态 | 对接动作 |
|------|------|----------|
| L0/L1 + Proxy | ✅ 复用 | Phase A 验证即可 |
| HMAC + log.jsonl | ✅ 复用 | Phase A `audit verify` |
| EventUploader | ✅ 复用 | 不改 flush/队列逻辑 |
| cloudEventMapper | ✅ 复用 | camelCase 载荷不变 |
| CloudClient | ⚠️ 已加适配 | Supabase 分支在 `supabaseCloudTransport.ts` |
| supabaseEventMapper | ✅ 新增 | snake_case 行映射 |
| Supabase DDL/RLS | ⬜ 待部署 | `docs/supabase/events_ddl.sql` |
| 前端读 events | ✅ 已有 | Phase D 关 mock |
| Dashboard | ⚠️ mock 默认 | `.env.local` |

---

## Phase A — 本地闭环（运行验证，无代码改动）

| ID | 任务 | 状态 |
|----|------|------|
| A-1 | `agentwatch init` | ⬜ |
| A-2 | 记录 `agentId` → 作 `install_id` | ⬜ |
| A-3 | 启动 proxy | ⬜ |
| A-4 | 触发 BLOCK/WARN | ⬜ |
| A-5 | 检查 log.jsonl + hmac | ⬜ |
| A-6 | `audit verify` exit 0 | ⬜ |
| A-7 | dur_ms P99 抽检 | ⬜ |

**Phase A 验收核对**

- [ ] Demo 标准 1：`audit verify` exit 0
- [ ] 未改 L0/L1/Proxy/HMAC 源码

---

## Phase B — Supabase 基础设施（人工 SQL）

| ID | 任务 | 状态 |
|----|------|------|
| B-1 | 执行 `docs/supabase/events_ddl.sql` | ⬜ |
| B-2 | 确认无 `risk_score`/`action` 废弃字段 | ⬜ |
| B-3 | 手工 insert 1 行 + Dashboard 可读 | ⬜ |
| B-4 | RLS select/insert 生效 | ⬜ |
| B-5 | header `x-install-id` 与前端一致 | ⬜ |

**Phase B 验收核对**

- [ ] Demo 标准 2：表中有独立 `event_id`
- [ ] Demo 标准 4：错误 install_id SELECT 为空

---

## Phase C — CloudClient Supabase 适配（代码）

| ID | 任务 | 状态 |
|----|------|------|
| C-2 | `supabaseEventMapper.ts` | ✅ |
| C-3 | `supabaseCloudTransport.ts` + CloudClient 分支 | ✅ |
| C-4a | `supabaseEventMapper.test.ts` | ✅ |
| C-4b | upload.test.ts Supabase 用例 | ✅ |
| C-3d | install_id ← payload.agentId（无 EventUploader 改动） | ✅ |

**Phase C 验收核对**

- [ ] `cd packages/local && npm test -- cloud` 全绿
- [ ] 未改 EventUploader / RetryQueue / AsyncLogger 入队逻辑
- [ ] 未改 CloudEventPayload 字段名

---

## Phase D — 前端 Live（仅 Dashboard 数据源）

| ID | 任务 | 状态 |
|----|------|------|
| D-1 | Settings 填 agentId | ⬜ |
| D-2 | `packages/web/.env.local` → `VITE_USE_MOCK=false` | ⬜ |
| D-3 | Dashboard 展示 Supabase 行 | ⬜ |
| D-4 | 错误 install_id 读不到数据 | ⬜ |
| D-5 | Home.tsx **不修改** | ✅ |

**Phase D 验收核对**

- [ ] Demo 标准 3：表格决策与 CLI 一致
- [ ] Demo 标准 4：RLS 隔离

---

## Phase E — E2E 脚本

| ID | 任务 | 状态 |
|----|------|------|
| E-1 | `docs/demo_e2e_supabase.md` | ✅ |
| E-2 | 真实 proxy → Supabase → Dashboard 录屏 | ⬜ |

---

## 四条 Demo 总验收（全部闭环后）

- [ ] 1. `audit verify` exit 0
- [ ] 2. Supabase `events` 有 CLI 产生的 `event_id`
- [ ] 3. Dashboard 与 CLI 决策一致
- [ ] 4. 换 install_id 读不到他人数据
