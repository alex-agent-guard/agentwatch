import { randomBytes } from 'node:crypto';

/** 生成随机 agentId — 格式 agent_<hex> */
export function generateAgentId(): string {
  return `agent_${randomBytes(6).toString('hex')}`;
}

/** 生成随机 userId — 格式 usr_<hex> */
export function generateUserId(): string {
  return `usr_${randomBytes(6).toString('hex')}`;
}

/** 生成 CLI 上报 upload_secret — 格式 aw_<base64url> */
export function generateUploadSecret(): string {
  return `aw_${randomBytes(24).toString('base64url')}`;
}
