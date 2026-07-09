/** 终端命令 — 与 packages/local CLI 对齐 */

/** 首次：安装 CLI + 初始化 + 打印本机 Agent ID */
export const SETUP_AND_SHOW_ID_CMD =
  'npm install -g @agentwatch-web3/cli && agentwatch-web3 init && agentwatch-web3 credentials';

/** 已装过 CLI：只打印 Agent ID + 上传密钥 */
export const SHOW_AGENT_ID_CMD = 'agentwatch-web3 credentials';

/** @deprecated 旧 curl 安装易 404/卡住，保留仅供文档引用 */
export const INSTALL_ONE_LINER = SETUP_AND_SHOW_ID_CMD;
