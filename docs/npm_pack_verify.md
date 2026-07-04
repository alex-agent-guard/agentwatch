# NPM 打包安装验收流程

> 适用版本：`@agentwatch-web3/cli@0.1.0`  
> 前置：`npm run build` 编译 dist，Node.js >= 18

---

## 1. 打包

```bash
cd /path/to/agent-watch-v0
npm run build
npm pack
# 输出示例：agentwatch-web3-cli-0.1.0.tgz
```

## 2. 临时目录本地安装

```bash
mkdir /tmp/agentwatch-pack-test && cd /tmp/agentwatch-pack-test
npm init -y
npm install /path/to/agentwatch-web3-cli-0.1.0.tgz
```

> 空目录需先 `npm init -y`，否则 `npm install ./xxx.tgz` 不会创建 `node_modules`。

## 3. 验证 CLI 帮助

```bash
npx agentwatch --help
```

期望输出包含：`proxy`、`init`、`status`、`logs`、`audit` 子命令说明。

## 4. 验证代理启动与 ~/.agentwatch 初始化

```bash
export OKX_API_KEY=demo OKX_SECRET_KEY=demo OKX_PASSPHRASE=demo OKX_PROJECT_ID=demo
export AGENTWATCH_API_KEY=demo   # config 模板 ${...} 占位校验
npx agentwatch init
npx agentwatch proxy -- node /path/to/agent-watch-v0/scripts/echo-mcp.js
# 或最小 echo：
# npx agentwatch proxy -- node -e "process.stdin.pipe(process.stdout)"
```

期望：

- 进程正常启动，输出 `[AgentWatch][proxy] gateway_ready`
- 自动创建 `~/.agentwatch/agentwatch.db`
- SQLite 表：`baselines`、`upload_queue`、`hmac_chain`、`perm_probe_tracker`

```bash
ls -la ~/.agentwatch/
sqlite3 ~/.agentwatch/agentwatch.db ".tables"
```

## 5. 验证 HMAC 审计链（A2A 验收）

```bash
npx agentwatch audit verify
# ✅ Chain verified: N entries intact
echo $?   # 0
```

## 6. 自动化验收（Vitest）

```bash
# 根目录 — 含 build + pack install 集成测试
npm run pack:verify

# 或仅跑 pack 安装测试（需已有 dist）
PACK_VERIFY=1 npm run test:pack --prefix packages/local
```

## 7. package.json 关键配置

| 字段 | 值 | 说明 |
|------|-----|------|
| `name` | `@agentwatch-web3/cli` | npm 公开发布包名 |
| `bin.agentwatch` | `dist/packages/local/src/cli/index.js` | 全局 CLI 入口 |
| `imports` | `@packages/shared/*` → `dist/packages/shared/*` | ESM 路径别名解析 |
| `dependencies` | better-sqlite3, byline, chalk, commander | 运行时依赖 |

---

## 故障排查

| 症状 | 处理 |
|------|------|
| `Cannot find module '@packages/shared/constants'` | 确认 `npm run build` 已执行（含 `scripts/fix-dist-imports.mjs` 路径重写）；检查 dist 存在 |
| `agentwatch: command not found` | 使用 `npx agentwatch` 或 `./node_modules/.bin/agentwatch` |
| `OKX_API_KEY is not set` | export 占位 env（见 §4），或编辑 `~/.agentwatch/config.yaml` |
| better-sqlite3 加载失败 | `npm rebuild better-sqlite3` 或 `--build-from-source` |
