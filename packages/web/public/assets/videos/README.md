# 视频素材映射

> **Git 说明**：`*.mp4` / `*.mov` 已加入 `.gitignore`（单文件过大，GitHub 限制 100MB）。克隆仓库后请从本地 `~/Desktop/视频/` 复制到本目录，见下表。

源文件夹：`~/Desktop/视频/` → 复制到本目录（以你重命名后的文件为准）。

## 当前命名 → 项目文件 → 页面用途

| 桌面文件名 | 项目文件名 | 用途 |
|------------|------------|------|
| **女孩.mp4** | `hero-girl.mp4` | **Hero 主背景** |
| 北欧冬夜星空.mp4 | `hero-stars.mp4` | 卡「验证」 |
| 发现.mp4 | `card-discover.mp4` | 卡「发现」 |
| 海滩.mp4 | `beach.mp4` | 备用 |
| 冰山.mp4 | `iceberg.mp4` | 备用（约 273MB，默认不加载） |
| 地球自转…网络连接.mov | `card-earth-network.mov` | 卡「审计」 |
| 机器人手指接触人类.mov | `card-robot-touch.mov` | 卡「拦截」 |
| **（微信素材 2026-07）** | `protection-hero.mp4` | **保护态 Hero · 新用户空数据安全页** |
| 绕地球边缘.mov | `hero-earth-edge.mov` | 备用（Hero 不用地球） |

桌面改名后，说「视频文件夹更新了」，我会按上表重新 `cp` 并改 `src/data/videoAssets.ts`。
