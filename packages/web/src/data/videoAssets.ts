/**
 * 桌面 ~/Desktop/视频/ 命名 → public/assets/videos/
 */
export const VIDEO_ASSETS = {
  /** 女孩.mp4 — Hero 主背景 */
  heroGirl: '/assets/videos/hero-girl.mp4',
  /** 北欧冬夜星空.mp4 */
  heroStars: '/assets/videos/hero-stars.mp4',
  /** 绕地球边缘.mov */
  heroEarthEdge: '/assets/videos/hero-earth-edge.mov',
  /** 海滩.mp4（备用） */
  beach: '/assets/videos/beach.mp4',
  /** 发现.mp4 — 卡「发现」 */
  cardDiscover: '/assets/videos/card-discover.mp4',
  /** 冰山.mp4（备用） */
  iceberg: '/assets/videos/iceberg.mp4',
  /** 地球自转…网络连接.mov */
  cardEarthNetwork: '/assets/videos/card-earth-network.mov',
  /** 机器人手指接触人类.mov */
  cardRobotTouch: '/assets/videos/card-robot-touch.mov',
  /** 保护态 Hero — 新用户空数据安全页（待放入素材） */
  protectionHero: '/assets/videos/protection-hero.mp4',
} as const;

/** 保护态 Hero 静态图 — 按档位切换 */
export const PROTECTION_ASSETS = {
  /** 警告态背景 — 龙虾/异常场景 */
  warnHero: '/assets/images/protection-warn-hero.png',
  /** 拦截态背景 — 黑客/入侵场景 */
  blockHero: '/assets/images/protection-block-hero.png',
} as const;

export type VideoAssetKey = keyof typeof VIDEO_ASSETS;

/** 登录页背景 — 挪威 4→5 依次播放 */
export const AUTH_NORWAY_PLAYLIST = [
  '/assets/videos/auth-norway-4.mp4',
  '/assets/videos/auth-norway-5.mp4',
] as const;
