import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './mobile.css';

/** Hash 为空时默认进入官网首页，而非登录页 */
if (typeof window !== 'undefined') {
  const hash = window.location.hash;
  if (!hash || hash === '#') {
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#/`);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
