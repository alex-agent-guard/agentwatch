#!/usr/bin/env node
/**
 * 批量生成 Live 激活码 → CSV + SQL 哈希入库片段
 *
 * 用法：
 *   node scripts/generate-live-codes.mjs 10
 *   node scripts/generate-live-codes.mjs 100 --batch okx-2026-07
 *
 * 输出：
 *   ./out/live-codes-<batch>-<ts>.csv  （明文码，仅保管/发 OKX 买家，勿提交 git）
 *   ./out/live-codes-<batch>-<ts>.sql  （hash 行，在 Supabase SQL Editor 执行）
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomTail(length = 8) {
  let out = '';
  while (out.length < length) {
    const byte = randomBytes(1)[0];
    out += CHARSET[byte % CHARSET.length];
  }
  return out;
}

function generateCode() {
  const tail = randomTail(8);
  return `AW-LIVE-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

function normalize(display) {
  return display.trim().toUpperCase().replace(/[\s-]/g, '');
}

function hash(normalized) {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function prefix(display) {
  const norm = normalize(display);
  return `AW-LIVE-${norm.slice(6, 10)}`;
}

const count = Math.min(Math.max(parseInt(process.argv[2] ?? '5', 10) || 5, 1), 10_000);
const batchIdx = process.argv.indexOf('--batch');
const batchId = batchIdx >= 0 ? process.argv[batchIdx + 1] ?? 'manual' : `batch-${Date.now()}`;
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(repoRoot, 'out');
mkdirSync(outDir, { recursive: true });

const codes = new Set();
while (codes.size < count) {
  codes.add(generateCode());
}

const rows = [...codes].map((display) => {
  const norm = normalize(display);
  return {
    display,
    normalized: norm,
    code_hash: hash(norm),
    code_prefix: prefix(display),
  };
});

const csvPath = join(outDir, `live-codes-${batchId}-${ts}.csv`);
const sqlPath = join(outDir, `live-codes-${batchId}-${ts}.sql`);

const csv = ['code,display,batch_id', ...rows.map((r) => `${r.normalized},${r.display},${batchId}`)].join(
  '\n',
);

const esc = (s) => s.replace(/'/g, "''");

const sqlValues = rows
  .map(
    (r) =>
      `  ('${r.code_hash}', '${r.code_prefix}', '${esc(r.display)}', '${esc(batchId)}', 'live_perpetual')`,
  )
  .join(',\n');

const sql = `-- Live activation codes batch: ${batchId} (${String(rows.length)} codes)
-- 在 Supabase SQL Editor 执行（service role 或 postgres）
-- code_display 供 packages/code-admin 管理端展示；兑换仍只验 hash

insert into public.live_activation_codes (code_hash, code_prefix, code_display, batch_id, sku)
values
${sqlValues}
on conflict (code_hash) do nothing;
`;

writeFileSync(csvPath, csv, 'utf8');
writeFileSync(sqlPath, sql, 'utf8');

console.log(`Generated ${String(rows.length)} codes`);
console.log(`CSV (KEEP SECRET): ${csvPath}`);
console.log(`SQL (run in Supabase): ${sqlPath}`);
