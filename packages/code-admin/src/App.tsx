import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  checkIsAdmin,
  fetchCodes,
  fetchStats,
  getSupabase,
  type LiveCodeRow,
  type LiveCodeStats,
} from './supabase';

const STATUS_LABEL: Record<string, string> = {
  active: '未使用',
  redeemed: '已兑换',
  revoked: '已作废',
};

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export function App() {
  const client = useMemo(() => getSupabase(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [stats, setStats] = useState<LiveCodeStats | null>(null);
  const [rows, setRows] = useState<LiveCodeRow[]>([]);
  const [batchFilter, setBatchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [s, list] = await Promise.all([
        fetchStats(client),
        fetchCodes(client, {
          batchId: batchFilter || undefined,
          status: statusFilter || undefined,
        }),
      ]);
      setStats(s);
      setRows(list);
      setLastSync(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, batchFilter, statusFilter]);

  useEffect(() => {
    let mounted = true;
    void client.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const { data: sub } = client.auth.onAuthStateChange((_evt, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!session) {
      setIsAdmin(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void checkIsAdmin(client).then((ok) => {
      setIsAdmin(ok);
      setLoading(false);
    });
  }, [client, session]);

  useEffect(() => {
    if (!session || !isAdmin) return;
    setLoading(true);
    void reload().finally(() => setLoading(false));
  }, [session, isAdmin, reload]);

  useEffect(() => {
    if (!session || !isAdmin) return;
    const channel = client
      .channel('live-codes-admin')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_activation_codes' },
        () => {
          void reload();
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [client, session, isAdmin, reload]);

  const batches = useMemo(() => {
    if (!stats?.by_batch) return [];
    return stats.by_batch.map((b) => b.batch_id ?? '(无批次)');
  }, [stats]);

  async function signInWithGitHub() {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error: signErr } = await client.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo },
    });
    if (signErr) setError(signErr.message);
  }

  async function signOut() {
    await client.auth.signOut();
  }

  if (!session) {
    return (
      <div className="shell center">
        <div className="card narrow">
          <h1>激活码管理</h1>
          <p className="muted">使用已加入白名单的 GitHub 账号登录，实时查看码池与兑换情况。</p>
          {error && <p className="error">{error}</p>}
          <button type="button" className="btn primary" onClick={() => void signInWithGitHub()}>
            GitHub 登录
          </button>
        </div>
      </div>
    );
  }

  if (loading && isAdmin === null) {
    return (
      <div className="shell center">
        <p className="muted">验证管理员权限…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="shell center">
        <div className="card narrow">
          <h1>无访问权限</h1>
          <p className="muted">
            当前账号不在 <code>live_code_admins</code> 白名单。请在 Supabase SQL Editor 添加你的 user_id。
          </p>
          <p className="muted small">{session.user.email}</p>
          <button type="button" className="btn" onClick={() => void signOut()}>
            退出
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="header">
        <div>
          <h1>激活码管理</h1>
          <p className="muted small">
            {session.user.email}
            {lastSync && <> · 上次同步 {formatTime(lastSync.toISOString())}</>}
            <span className="live-dot" title="Realtime 已连接" />
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn" onClick={() => void reload()}>
            刷新
          </button>
          <button type="button" className="btn" onClick={() => void signOut()}>
            退出
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {stats && (
        <section className="stats">
          <StatCard label="总码数" value={stats.total} />
          <StatCard label="未使用" value={stats.active} tone="green" />
          <StatCard label="已兑换" value={stats.redeemed} tone="blue" />
          <StatCard label="已作废" value={stats.revoked} tone="muted" />
        </section>
      )}

      {stats && stats.by_batch.length > 0 && (
        <section className="card">
          <h2>按批次</h2>
          <div className="batch-grid">
            {stats.by_batch.map((b) => (
              <button
                key={b.batch_id ?? '__none__'}
                type="button"
                className={`batch-chip ${batchFilter === (b.batch_id ?? '') ? 'active' : ''}`}
                onClick={() => setBatchFilter(b.batch_id ?? '')}
              >
                <span className="batch-name">{b.batch_id ?? '(无批次)'}</span>
                <span className="batch-meta">
                  {b.redeemed}/{b.total} 已用
                </span>
              </button>
            ))}
            {batchFilter && (
              <button type="button" className="batch-chip clear" onClick={() => setBatchFilter('')}>
                全部批次
              </button>
            )}
          </div>
        </section>
      )}

      <section className="card">
        <div className="toolbar">
          <h2>码列表</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="状态筛选"
          >
            <option value="">全部状态</option>
            <option value="active">未使用</option>
            <option value="redeemed">已兑换</option>
            <option value="revoked">已作废</option>
          </select>
        </div>

        {loading ? (
          <p className="muted">加载中…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>激活码</th>
                  <th>批次</th>
                  <th>状态</th>
                  <th>兑换时间</th>
                  <th>兑换账户</th>
                  <th>入库时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted center-cell">
                      暂无数据（请确认已执行 live_activation_admin.sql 并用新脚本生成入库）
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className={`row-${row.status}`}>
                      <td className="mono">
                        {row.code_display ?? `${row.code_prefix}-****`}
                      </td>
                      <td>{row.batch_id ?? '—'}</td>
                      <td>
                        <span className={`pill pill-${row.status}`}>
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>
                      </td>
                      <td>{formatTime(row.redeemed_at)}</td>
                      <td>{row.redeemed_email ?? row.redeemed_display_name ?? '—'}</td>
                      <td className="muted">{formatTime(row.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small footnote">
          共 {rows.length} 条{batchFilter ? ` · 批次 ${batchFilter}` : ''}
          {batches.length > 0 && ' · 有人兑换时列表会自动刷新'}
        </p>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'green' | 'blue' | 'muted';
}) {
  return (
    <div className={`stat-card ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
