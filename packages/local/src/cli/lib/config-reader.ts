import { readFileSync } from 'node:fs';

/** 从 config.yaml 轻量读取 agentId / userId / cloud.enabled */
export interface AgentWatchConfigSummary {
  agentId: string;
  userId: string;
  cloudEnabled: boolean;
  cloudEndpoint: string;
  cloudApiKey: string;
}

const DEFAULT_SUMMARY: AgentWatchConfigSummary = {
  agentId: 'default',
  userId: 'default',
  cloudEnabled: false,
  cloudEndpoint: '',
  cloudApiKey: '',
};

function readQuotedYamlValue(line: string): string | null {
  const match = line.match(/:\s*"?([^"\n#]+)"?\s*$/);
  if (match?.[1] === undefined) {
    return null;
  }
  return match[1].trim();
}

/** 简易 YAML 扫描 — 仅提取 CLI 所需字段，不引入完整解析器 */
export function readAgentWatchConfigSummary(configPath: string): AgentWatchConfigSummary {
  try {
    const content = readFileSync(configPath, 'utf8');
    const summary: AgentWatchConfigSummary = { ...DEFAULT_SUMMARY };

    let inCloud = false;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();

      if (trimmed.startsWith('agentId:')) {
        summary.agentId = readQuotedYamlValue(trimmed) ?? summary.agentId;
        continue;
      }
      if (trimmed.startsWith('userId:')) {
        summary.userId = readQuotedYamlValue(trimmed) ?? summary.userId;
        continue;
      }
      if (/^cloud:\s*$/.test(trimmed)) {
        inCloud = true;
        continue;
      }
      if (inCloud && /^\S/.test(line) && !line.startsWith(' ')) {
        inCloud = false;
      }
      if (!inCloud) {
        continue;
      }
      if (trimmed.startsWith('enabled:')) {
        summary.cloudEnabled = trimmed.includes('true');
      }
      if (trimmed.startsWith('endpoint:')) {
        summary.cloudEndpoint = readQuotedYamlValue(trimmed) ?? '';
      }
      if (trimmed.startsWith('apiKey:')) {
        summary.cloudApiKey = readQuotedYamlValue(trimmed) ?? '';
      }
    }

    return summary;
  } catch {
    return { ...DEFAULT_SUMMARY };
  }
}
