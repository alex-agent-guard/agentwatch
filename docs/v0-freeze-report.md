# AgentWatch V0 冻结验收报告

> 本文档记录 V0 MVP 自检结论与**修正后的验收标准**。  
> 若与早期清单（如 `upload_meta` / `upload_logs`）冲突，以本文为准。

---

## SQLite 表结构

| 表名 | 职责 | 状态 |
|------|------|------|
| `baselines` | 用户行为基线（Welford + 6维画像） | ✅ |
| `upload_queue` | 云端上报重试队列 + 批次元数据 | ✅ |
| `hmac_chain` | 审计日志完整性链 | ✅ |
| `perm_probe_tracker` | 权限试探连续失败计数 | ✅ |

说明：

- `upload_meta` 的 batch 级元数据由 `upload_queue` 的 payload 和 `EventUploader` 内存状态覆盖
- `upload_logs` 由文件系统 JSONL（`~/.agentwatch/log.jsonl`）和 `hmac_chain` 覆盖
- V0 不重复落库，V1 按需拆分

### 验证命令

```bash
sqlite3 ~/.agentwatch/agentwatch.db ".tables"
# 期望：baselines  hmac_chain  perm_probe_tracker  upload_queue
```

数据库路径：`~/.agentwatch/agentwatch.db`（代理首次启动时由 `DatabaseManager` 自动创建）。
