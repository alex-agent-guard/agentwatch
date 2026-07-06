/** 视频 URL 解析 — 生产优先 web 压缩版 / CDN，本地用原片 */

const CDN_BASE = (import.meta.env.VITE_VIDEO_CDN_BASE as string | undefined)?.replace(/\/$/, '');

function fileName(path: string): string {
  return path.split('/').pop() ?? path;
}

function alternateNames(name: string): string[] {
  const names = [name];
  if (name.endsWith('.mov')) {
    names.push(name.replace(/\.mov$/, '.mp4'));
  } else if (name.endsWith('.mp4')) {
    names.push(name.replace(/\.mp4$/, '.mov'));
  }
  return [...new Set(names)];
}

/** 按优先级返回候选 URL（LoopVideo 依次尝试） */
export function resolveVideoCandidates(path: string): string[] {
  const rel = path.replace(/^\/assets\/videos\//, '');
  const names = alternateNames(fileName(path));

  const candidates: string[] = [];
  for (const name of names) {
    const baseRel = rel.replace(/^[^/]+$/, name).replace(fileName(rel), name);
    if (CDN_BASE) {
      candidates.push(`${CDN_BASE}/web/${name}`, `${CDN_BASE}/${baseRel}`);
    }
    candidates.push(`/assets/videos/web/${name}`);
  }
  candidates.push(path);

  return [...new Set(candidates)];
}

export type CinematicVariant =
  | 'hero'
  | 'auth'
  | 'discover'
  | 'intercept'
  | 'audit'
  | 'protection';

/** 功能卡 title → 兜底视觉主题 */
export function featureCardVariant(title: string): CinematicVariant {
  switch (title) {
    case '发现':
      return 'discover';
    case '拦截':
      return 'intercept';
    case '审计':
      return 'audit';
    default:
      return 'hero';
  }
}
