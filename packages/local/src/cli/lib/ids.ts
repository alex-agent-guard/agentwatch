import { randomBytes } from 'node:crypto';

/** 生成随机 agentId — 格式 agent_<hex> */
export function generateAgentId(): string {
  return `agent_${randomBytes(6).toString('hex')}`;
}

/** 生成随机 userId — 格式 usr_<hex> */
export function generateUserId(): string {
  return `usr_${randomBytes(6).toString('hex')}`;
}
