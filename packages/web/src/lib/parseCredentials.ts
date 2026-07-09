/** 解析终端 credentials 输出 / 剪贴板文本 */
export function parseCredentialsFromTerminal(text: string): {
  agentId: string;
  uploadSecret: string;
} | null {
  const agentMatch = text.match(/agent_[a-zA-Z0-9_-]+/);
  if (!agentMatch) {
    return null;
  }
  const secretMatch = text.match(/aw_[a-zA-Z0-9_-]+/);
  return {
    agentId: agentMatch[0],
    uploadSecret: secretMatch?.[0] ?? '',
  };
}
