import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AuthVideoBackdrop from '@/components/AuthVideoBackdrop';
import BrandLogo from '@/components/BrandLogo';
import { signOut } from '@/lib/auth';
import {
  formatActivationCode,
  isActivationCodeFormat,
  normalizeActivationCode,
} from '@/lib/activationCode';
import {
  fetchLiveEntitlementStatus,
  redeemLiveActivationCode,
} from '@/lib/liveEntitlement';
import { resolvePostLoginRoute } from '@/lib/postAuthRoute';
import { isLiveGateEnabled } from '@/lib/liveGate';

export default function Activate() {
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath = (location.state as { from?: string } | null)?.from;

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!isLiveGateEnabled()) {
      void resolvePostLoginRoute().then((path) => navigate(path, { replace: true }));
      return;
    }

    void fetchLiveEntitlementStatus().then((status) => {
      setChecking(false);
      if (status.entitled) {
        void resolvePostLoginRoute().then((path) => navigate(path, { replace: true }));
      }
    });
  }, [navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isActivationCodeFormat(code)) {
      setError('格式：AW-LIVE-XXXX-XXXX');
      return;
    }

    setBusy(true);
    const result = await redeemLiveActivationCode(code);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const next =
      fromPath && fromPath !== '/activate' ? fromPath : await resolvePostLoginRoute();
    navigate(next, { replace: true });
  };

  const handleBlurFormat = () => {
    const norm = normalizeActivationCode(code);
    if (norm) {
      setCode(formatActivationCode(norm));
    }
  };

  if (checking) {
    return (
      <div className="activate-page activate-page--loading">
        <span className="activate-page__muted">…</span>
      </div>
    );
  }

  return (
    <div className="activate-page">
      <AuthVideoBackdrop />

      <div className="activate-card">
        <BrandLogo className="activate-card__logo" />

        <h1 className="activate-card__title">激活码</h1>
        <p className="activate-card__hint">输入后即可使用 · 每码限用一次</p>

        <form className="activate-card__form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <input
            id="live-code"
            aria-label="激活码"
            className={`activate-card__input${error ? ' activate-card__input--error' : ''}`}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              if (error) setError(null);
            }}
            onBlur={handleBlurFormat}
            placeholder="AW-LIVE-XXXX-XXXX"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="characters"
            disabled={busy}
          />

          {error && <p className="activate-card__error">{error}</p>}

          <button type="submit" className="activate-card__submit" disabled={busy}>
            {busy ? '…' : '进入'}
          </button>
        </form>

        <button
          type="button"
          className="activate-card__signout"
          onClick={() => void signOut().then(() => navigate('/auth', { replace: true }))}
        >
          切换账户
        </button>
      </div>
    </div>
  );
}
