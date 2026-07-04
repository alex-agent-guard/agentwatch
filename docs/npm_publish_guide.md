# AgentWatch V0 npm 发包指引

> 包名：`@agentwatch-web3/cli`  
> Week1 首版：`0.1.0`

---

## 1. 版本号规范

遵循 [SemVer 2.0](https://semver.org/)：

| 变更类型 | 版本段 | 示例 |
|----------|--------|------|
| P0 修复 / 安全补丁 | PATCH | 0.1.0 → 0.1.1 |
| 向后兼容功能（Week2 SQLite 等） | MINOR | 0.1.x → 0.2.0 |
| 破坏性 API / 契约变更 | MAJOR | 0.x → 1.0.0 |

**V0 约定**：

- `package.json`（根）与 `@agentwatch/local` 私有包版本保持同步注释  
- 发包前必须：`npm run typecheck && npm run test` 全绿  
- CHANGELOG 条目引用 task ID（如 MPC-05、L0-ENG-04）

---

## 2. 打包产物

### 2.1 编译

```bash
npm run build
```

输出目录 `dist/`（由 `tsconfig.build.json` 控制）：

- `declaration: true` — 生成 `.d.ts`  
- `declarationMap: true` — IDE 跳转  
- `sourceMap: true` — 生产排错  

入口：

- `main`: `dist/bootstrap.js`  
- `types`: `dist/bootstrap.d.ts`  
- `bin.agentwatch`: `dist/bootstrap.js`

### 2.2 .npmignore

根目录 `.npmignore` 已排除：

- 测试、logs、`.cursor/`、内部 `docs/`（README 除外）  
- 源码 `packages/local/src/`（消费者仅用 dist）  
- 本地 `node_modules/`

### 2.3 发布文件清单（files 字段）

```json
"files": ["dist", "packages/shared/types", "packages/shared/constants.ts", "README.md"]
```

---

## 3. 发包步骤

### 3.1 预检清单

- [ ] 版本号已 bump（根 `package.json`）  
- [ ] `npm run typecheck` 通过  
- [ ] `npm run test` — 172 tests 通过  
- [ ] `npm run build` 无 TS 错误  
- [ ] `npm pack --dry-run` 检查 tarball 体积与文件列表  
- [ ] 无 `.env` / API key 误入包内  

### 3.2 干跑打包

```bash
npm pack --dry-run
# 检查输出列表不含 tests/ logs/ docs/task_*.md
```

### 3.3 发布到 npm（示例）

```bash
npm login
npm publish --access public
```

> 私有 registry 将 `--registry=https://your.registry` 写入 `.npmrc`（勿提交 token）。

### 3.4 本地验证安装

```bash
npm install -g ./agentwatch-web3-cli-0.1.0.tgz
agentwatch --help
```

---

## 4. 回滚方案

### 4.1 npm 层面

| 场景 | 操作 |
|------|------|
| 刚发布有致命 bug | `npm deprecate @agentwatch-web3/cli@0.1.x "reason"` |
| 需强制下线 | 联系 npm support unpublish（72h 内且几乎无下载） |
| 正常修复 | 发 PATCH 版本，不 unpublish |

### 4.2 用户侧回滚

```bash
npm install -g @agentwatch-web3/cli@0.1.0
# 或 pin 在 MCP 配置 args 中指定版本
```

### 4.3 配置 / 日志兼容

- V0.1.x 日志 Schema：`BehaviorLogEntry`（`logging.types.ts`）  
- 回滚后检查 `~/.agentwatch/config.yaml` 新增字段是否被旧版忽略（YAML 超集安全）

---

## 5. tsconfig 编译开关校验

| 文件 | noEmit | declaration | 用途 |
|------|--------|-------------|------|
| `tsconfig.json` | — | `true` | 根 strict 基线 |
| `packages/local/tsconfig.json` | `true` | 继承 | 开发 typecheck |
| `tsconfig.build.json` | `false` | `true` | npm 发包 build |

---

## 6. Week2-3 发包注意事项

以下内容 **禁止** 混入 Week1 patch 包，应作为 MINOR 版本：

- better-sqlite3 基线持久化  
- 云端 Fastify 上报客户端  
- CLI `--config` / 热重载  

发 MINOR 前更新 README 能力边界表与 `operation_troubleshoot.md`。

---

*Last updated: Week1 Day7*
