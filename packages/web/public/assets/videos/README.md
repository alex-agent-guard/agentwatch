# 视频素材映射

> **Git 说明**  
> - 原片 `*.mp4` / `*.mov` 在 `.gitignore`（单文件过大）  
> - **Vercel 生产** 使用 `web/` 子目录下的压缩版（已提交 git）  
> - 本地开发优先加载原片；线上自动 fallback 到 `web/` 候选

源文件夹：`~/Desktop/视频/` → 复制到本目录（以你重命名后的文件为准）。

## 重新生成 web 压缩版

```bash
bash scripts/compress-web-videos.sh
git add packages/web/public/assets/videos/web/
```

## 当前命名 → 项目文件 → 页面用途

| 桌面文件名 | 项目文件名 | web/ 压缩 | 用途 |
|------------|------------|-----------|------|
| **女孩.mp4** | `hero-girl.mp4` | ✅ ~9MB | **Hero 主背景** |
| 发现.mp4 | `card-discover.mp4` | ✅ ~8MB | 卡「发现」 |
| 机器人手指接触人类.mov | `card-robot-touch.mov` | ✅ `card-robot-touch.mp4` | 卡「拦截」 |
| 地球自转…网络连接.mov | `card-earth-network.mov` | ✅ ~2MB | 卡「审计」 |
| **（微信素材 2026-07）** | `protection-hero.mp4` | ✅ ~312KB | **保护态 Hero** |
| 北欧冬夜星空.mp4 | `auth-norway-4.mp4` | ✅ ~1MB | **登录页背景** |
| auth-norway-5.mp4 | `auth-norway-5.mp4` | ❌ 原片过大 | 仅本地；线上自动跳过 |

可选 CDN：Vercel 环境变量 `VITE_VIDEO_CDN_BASE=https://你的CDN根路径/assets/videos`
