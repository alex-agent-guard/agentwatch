/** 一键安装脚本 — 展示用 one-liner（与 scripts/install-agentwatch.sh 对齐） */

const DEFAULT_INSTALL_SCRIPT_URL =
  import.meta.env.VITE_INSTALL_SCRIPT_URL ??
  'https://raw.githubusercontent.com/agentwatch/agent-watch-v0/main/scripts/install-agentwatch.sh';

/** 仓库本地开发（从 monorepo 根目录执行） */
export const INSTALL_LOCAL_CMD = 'bash scripts/install-agentwatch.sh';

/** 用户复制到终端的一条命令 — dev 默认本地脚本，生产为 curl */
export const INSTALL_ONE_LINER =
  import.meta.env.DEV
    ? INSTALL_LOCAL_CMD
    : `curl -fsSL ${DEFAULT_INSTALL_SCRIPT_URL} | bash`;
