import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import AuthVideoBackdrop from '@/components/AuthVideoBackdrop';
import { AUTH_ERROR_STORAGE_KEY } from '@/components/AuthSessionBootstrap';
import BrandLogo, { BRAND_NAME_EN } from '@/components/BrandLogo';
import {
  bootstrapAuthSession,
  clearAuthCallbackFromUrl,
  readAuthCallbackError,
  resetAuthFlow,
  signInWithGitHub,
  signInWithWallet,
} from '@/lib/auth';
import { storeAuthRedirect, peekAuthRedirect } from '@/lib/authRedirect';
import { enterGuestMode } from '@/lib/session';
import { resolvePostLoginRoute } from '@/lib/postAuthRoute';
import { USE_MOCK } from '@/lib/supabase';

type AuthBusy = 'github' | 'wallet' | null;

function GitHubIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a2 2 0 0 1 2 2v1.2H8.8A3.8 3.8 0 0 0 5 12v5.5A2.5 2.5 0 0 1 4 15V7.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="5" y="7" width="14" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16.5" cy="13" r="1.2" fill="currentColor" />
    </svg>
  );
}

const ease = [0.22, 1, 0.36, 1] as const;

function AuthGateButton({
  icon,
  label,
  ariaLabel,
  busy,
  disabled,
  onClick,
  delay,
}: {
  icon: ReactNode;
  label: string;
  ariaLabel: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  delay: number;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="auth-stage__gate"
      aria-label={ariaLabel}
      initial={{ opacity: 0, y: 14, x: 8 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration: 0.6, ease, delay }}
      whileHover={{ y: -2, scale: 1.008 }}
      whileTap={{ scale: 0.995 }}
    >
      <span className="auth-stage__gate-inner">
        <span className="auth-stage__gate-icon">{icon}</span>
        <span className="auth-stage__gate-label">{busy ? '…' : label}</span>
      </span>
    </motion.button>
  );
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState<AuthBusy>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(!USE_MOCK);

  useEffect(() => {
    if (USE_MOCK) {
      return;
    }

    const from = (location.state as { from?: string } | null)?.from;
    if (from) {
      storeAuthRedirect(from);
    }

    void (async () => {
      try {
        const storedError = sessionStorage.getItem(AUTH_ERROR_STORAGE_KEY);
        if (storedError) {
          sessionStorage.removeItem(AUTH_ERROR_STORAGE_KEY);
          setError(storedError);
        }

        const callbackError = readAuthCallbackError();
        if (callbackError) {
          clearAuthCallbackFromUrl();
          await resetAuthFlow();
          setError(callbackError);
          return;
        }

        const session = await bootstrapAuthSession();
        if (session) {
          const route = await resolvePostLoginRoute();
          navigate(route, { replace: true });
        }
      } finally {
        setChecking(false);
      }
    })();
  }, [navigate, location.state]);

  const handleGitHub = async () => {
    setBusy('github');
    setError(null);
    const result = await signInWithGitHub();
    if (result.error) {
      setBusy(null);
      setError(result.error);
    }
  };

  const handleWallet = async () => {
    setBusy('wallet');
    setError(null);
    const result = await signInWithWallet();
    setBusy(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    const route = await resolvePostLoginRoute();
    navigate(route);
  };

  return (
    <div className="relative min-h-screen">
      <AuthVideoBackdrop />

      <Link to="/" className="auth-stage__back">
        ← back
      </Link>

      <div className="auth-shell relative z-10 min-h-screen">
        {checking ? (
          <main className="auth-stage flex items-center justify-center">
            <p className="text-sm text-white/50">正在检查登录状态…</p>
          </main>
        ) : (
          <main className="auth-stage">
            <motion.div
              className="auth-stage__rail"
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ duration: 1, ease, delay: 0.1 }}
              aria-hidden
            />

            <motion.header
              className="auth-stage__brand"
              initial={{ opacity: 0, x: -28, y: 12 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 0.75, ease, delay: 0.05 }}
            >
              <div className="auth-stage__mark">
                <BrandLogo to="/" size="lg" showText={false} className="auth-stage__logo" />
                <span className="auth-stage__company">{BRAND_NAME_EN}</span>
              </div>
              <h1 className="auth-stage__title">Agent Watch</h1>
              <p className="auth-stage__tag">MCP Runtime Gate</p>
            </motion.header>

            <motion.div
              className="auth-stage__panel"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease, delay: 0.18 }}
            >
              <div className="auth-stage__choices">
                <AuthGateButton
                  icon={<GitHubIcon />}
                  label="GitHub"
                  ariaLabel="Sign in with GitHub"
                  busy={busy === 'github'}
                  disabled={busy !== null}
                  onClick={() => {
                    if (!peekAuthRedirect()) {
                      storeAuthRedirect('/home');
                    }
                    void handleGitHub();
                  }}
                  delay={0.24}
                />
                <AuthGateButton
                  icon={<WalletIcon />}
                  label="Wallet"
                  ariaLabel="Sign in with wallet"
                  busy={busy === 'wallet'}
                  disabled={busy !== null}
                  onClick={() => {
                    if (!peekAuthRedirect()) {
                      storeAuthRedirect('/home');
                    }
                    void handleWallet();
                  }}
                  delay={0.32}
                />
              </div>

              {error && <p className="auth-stage__error">{error}</p>}

              {USE_MOCK && (
                <motion.button
                  type="button"
                  className="auth-stage__demo"
                  onClick={() => {
                    enterGuestMode();
                    navigate('/home');
                  }}
                  whileHover={{ opacity: 1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  Dev Mock →
                </motion.button>
              )}

              <div className="auth-stage__previews">
                <Link to="/preview/home" className="auth-stage__demo-link">
                  Demo →
                </Link>
              </div>
            </motion.div>
          </main>
        )}
      </div>
    </div>
  );
}
