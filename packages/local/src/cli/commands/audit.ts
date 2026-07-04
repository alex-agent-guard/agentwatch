import {
  auditVerifyExitCode,
  formatAuditVerifyHuman,
  formatAuditVerifyJson,
  resolveAuditLogPath,
  verifyAuditLogFile,
} from '../lib/audit-verify.js';

export interface AuditVerifyCommandOptions {
  file?: string;
  json?: boolean;
}

function emitParameterError(message: string, json: boolean | undefined): never {
  if (json === true) {
    console.info(JSON.stringify({ valid: false, count: 0, tamperedIndex: null, error: message }));
  } else {
    console.error(`❌ ${message}`);
  }
  process.exit(2);
}

/** 验证 HMAC 审计链完整性 */
export function auditVerifyCommand(options: AuditVerifyCommandOptions): never {
  const resolved = resolveAuditLogPath(options.file);
  if (typeof resolved !== 'string') {
    emitParameterError(resolved.error, options.json);
  }

  try {
    const result = verifyAuditLogFile(resolved);

    if (options.json === true) {
      console.info(formatAuditVerifyJson(result));
    } else {
      console.info(formatAuditVerifyHuman(result));
    }

    process.exit(auditVerifyExitCode(result));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (options.json === true) {
      console.info(JSON.stringify({ valid: false, count: 0, tamperedIndex: null }));
    } else {
      console.error(`❌ Audit verify failed: ${message}`);
    }
    process.exit(1);
  }
}
