# Web Dashboard 部署

## 生产地址（GitHub Pages）

**https://alex-agent-guard.github.io/agentwatch/**

入口示例：

- 登录：`https://alex-agent-guard.github.io/agentwatch/#/auth`
- 激活：`https://alex-agent-guard.github.io/agentwatch/#/activate`
- Demo：`https://alex-agent-guard.github.io/agentwatch/#/preview/home`

---

## 一次性开启（若 Pages 尚未启用）

1. 打开 https://github.com/alex-agent-guard/agentwatch/settings/pages  
2. **Build and deployment → Source** 选 **GitHub Actions**  
3. 保存后，在 **Actions** 页手动 **Run workflow** → `Deploy Web (GitHub Pages)`，或 push 到 `main` 自动触发

---

## Supabase Auth 回调（必做）

Dashboard → Authentication → URL Configuration：

| 字段 | 值 |
|------|-----|
| Site URL | `https://alex-agent-guard.github.io/agentwatch/` |
| Redirect URLs | 追加 `https://alex-agent-guard.github.io/agentwatch/` |

GitHub OAuth App 的 Callback 仍是 Supabase 固定地址（不变）：

```text
https://kbjcikgoawxhotwwqtin.supabase.co/auth/v1/callback
```

---

## 本地构建预览

```bash
cd packages/web
npm ci
npm run build -- --base=/agentwatch/
npx vite preview
```

---

## 可选：Vercel

```bash
cd packages/web
npx vercel login
npx vercel --prod
```

在 Vercel 项目 Environment 中设置 `VITE_USE_MOCK=false`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`，并把 Vercel 域名加入 Supabase Redirect URLs。
