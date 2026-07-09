/** 终端命令 — 生产环境用户可见，须与 scripts/install-agentwatch.sh 一致 */

const DASHBOARD_URL =
  import.meta.env.VITE_DASHBOARD_URL?.replace(/\/$/, '') ?? 'https://www.deeptrench.space';

/** 托管在本站，避免 GitHub raw 404 / 旧链接 */
export const INSTALL_SH_URL = `${DASHBOARD_URL}/install.sh`;

/** 首次：安装 CLI + 初始化 + 打印本机 Agent ID（推荐，不依赖 curl） */
export const SETUP_AND_SHOW_ID_CMD =
  'npm install -g @agentwatch-web3/cli && agentwatch-web3 init && agentwatch-web3 credentials';

/** 已装过 CLI：只打印 Agent ID + 上传密钥 */
export const SHOW_AGENT_ID_CMD = 'agentwatch-web3 credentials';

/** 备选：从本站拉安装脚本（URL 固定，不会 404） */
export const CURL_INSTALL_CMD = `curl -fsSL ${INSTALL_SH_URL} | bash`;

/** @deprecated 使用 SETUP_AND_SHOW_ID_CMD 或 CURL_INSTALL_CMD */
export const INSTALL_ONE_LINER = SETUP_AND_SHOW_ID_CMD;

export { DASHBOARD_URL };
