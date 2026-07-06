#!/usr/bin/env node
/**
 * 本地码池看板 — 查看 / 添加 / 删除（仅 127.0.0.1）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3920;
const HOST = '127.0.0.1';
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function loadEnv() {
  const envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv();
const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function supabaseHeaders(extra = {}) {
  const headers = { apikey: SERVICE_KEY, Accept: 'application/json', ...extra };
  if (SERVICE_KEY.startsWith('ey')) {
    headers.Authorization = `Bearer ${SERVICE_KEY}`;
  }
  return headers;
}

async function supabaseRequest(method, table, { query = '', body, prefer } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const headers = supabaseHeaders();
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  if (prefer) {
    headers.Prefer = prefer;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 240)}`);
  }
  return text ? JSON.parse(text) : null;
}

function randomTail(length = 8) {
  let out = '';
  while (out.length < length) {
    out += CHARSET[randomBytes(1)[0] % CHARSET.length];
  }
  return out;
}

function generateDisplayCode() {
  const tail = randomTail(8);
  return `AW-LIVE-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

function normalize(display) {
  return display.trim().toUpperCase().replace(/[\s-]/g, '');
}

function hashCode(normalized) {
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function prefix(display) {
  return `AW-LIVE-${normalize(display).slice(6, 10)}`;
}

function buildCodeRow(display, batchId) {
  const norm = normalize(display);
  return {
    code_hash: hashCode(norm),
    code_prefix: prefix(display),
    code_display: display,
    batch_id: batchId,
    sku: 'live_perpetual',
    status: 'active',
  };
}

function generateUniqueCodes(count) {
  const set = new Set();
  while (set.size < count) {
    set.add(generateDisplayCode());
  }
  return [...set];
}

function appendCsv(batchId, displays) {
  const csvPath = path.join(__dirname, `发码用-${batchId}.csv`);
  const header = 'code,display,batch_id\n';
  const lines = displays.map((d) => `${normalize(d)},${d},${batchId}`).join('\n');
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, header + lines + '\n', 'utf8');
  } else {
    fs.appendFileSync(csvPath, lines + '\n', 'utf8');
  }
}

async function fetchDashboardData() {
  const codes = await supabaseRequest(
    'GET',
    'live_activation_codes',
    {
      query:
        'select=id,code_display,code_prefix,batch_id,status,redeemed_at,redeemed_by,created_at&order=created_at.desc&limit=5000',
    },
  );

  let redeemers = {};
  const redeemedIds = [...new Set(codes.map((c) => c.redeemed_by).filter(Boolean))];
  if (redeemedIds.length > 0) {
    const profiles = await supabaseRequest('GET', 'profiles', {
      query: `select=id,email,display_name&id=in.(${redeemedIds.join(',')})`,
    });
    redeemers = Object.fromEntries(profiles.map((p) => [p.id, p]));
  }

  const rows = codes.map((c) => {
    const p = c.redeemed_by ? redeemers[c.redeemed_by] : null;
    return {
      ...c,
      display: c.code_display || `${c.code_prefix}-****`,
      redeemer: p?.email || p?.display_name || (c.redeemed_by ? '(未知用户)' : null),
    };
  });

  const stats = {
    total: rows.length,
    active: rows.filter((r) => r.status === 'active').length,
    redeemed: rows.filter((r) => r.status === 'redeemed').length,
    revoked: rows.filter((r) => r.status === 'revoked').length,
  };

  const batchMap = new Map();
  for (const r of rows) {
    const b = r.batch_id || '(无批次)';
    const cur = batchMap.get(b) || { batch_id: b, total: 0, active: 0, redeemed: 0 };
    cur.total += 1;
    if (r.status === 'active') cur.active += 1;
    if (r.status === 'redeemed') cur.redeemed += 1;
    batchMap.set(b, cur);
  }

  return { stats, batches: [...batchMap.values()], rows, fetchedAt: new Date().toISOString() };
}

async function addCodes(count, batchId) {
  const n = Math.min(Math.max(Number(count) || 1, 1), 500);
  const batch = String(batchId || `batch-${Date.now()}`).trim().slice(0, 64) || `batch-${Date.now()}`;
  const displays = generateUniqueCodes(n);
  const payload = displays.map((d) => buildCodeRow(d, batch));

  const inserted = await supabaseRequest('POST', 'live_activation_codes', {
    body: payload,
    prefer: 'return=representation',
  });

  appendCsv(batch, displays);
  return { added: inserted?.length ?? n, batch_id: batch, codes: displays };
}

async function deleteCode(id) {
  const rows = await supabaseRequest('GET', 'live_activation_codes', {
    query: `select=id,status,code_display&id=eq.${id}&limit=1`,
  });
  const row = rows?.[0];
  if (!row) {
    throw new Error('码不存在');
  }
  if (row.status === 'redeemed') {
    throw new Error('已兑换的码不能删除（留作对账）');
  }

  await supabaseRequest('DELETE', 'live_activation_codes', {
    query: `id=eq.${id}`,
  });
  return { deleted: true, display: row.code_display };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function configError(res) {
  json(res, 500, {
    error: 'missing_config',
    message: '请编辑同目录 .env.local，填入 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY',
  });
}

const htmlPath = path.join(__dirname, 'dashboard.html');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(htmlPath, 'utf8'));
    return;
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    if (url.pathname.startsWith('/api/')) {
      configError(res);
      return;
    }
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/data') {
      json(res, 200, await fetchDashboardData());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/codes') {
      const body = await readJsonBody(req);
      const result = await addCodes(body.count, body.batch_id);
      json(res, 201, result);
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/codes/')) {
      const id = url.pathname.slice('/api/codes/'.length);
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        json(res, 400, { error: 'invalid_id' });
        return;
      }
      json(res, 200, await deleteCode(id));
      return;
    }
  } catch (e) {
    json(res, 500, { error: 'operation_failed', message: e instanceof Error ? e.message : String(e) });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  const openUrl = `http://${HOST}:${PORT}`;
  console.log(`AgentWatch 码池看板 → ${openUrl}`);
  if (process.platform === 'darwin') {
    exec(`open "${openUrl}"`);
  }
});
