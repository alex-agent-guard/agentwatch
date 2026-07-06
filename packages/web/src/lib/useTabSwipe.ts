import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { getAppNavItems, isAppNavActive } from '@/lib/appNavigation';

const SWIPE_THRESHOLD_PX = 56;
const SWIPE_MAX_VERTICAL_PX = 48;

function isSwipeBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  return Boolean(
    target.closest(
      'input, textarea, select, button, a, label, [data-no-tab-swipe], .dash-table-wrap, .protect-cmd, .dash-audit-scroll',
    ),
  );
}

/** 移动端在四个主 Tab 间左右滑动切换 */
export function useTabSwipe(pathname: string): void {
  const navigate = useNavigate();
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    if (!mq.matches) {
      return;
    }

    const tabs = getAppNavItems(pathname).map((item) => item.to);
    const currentIndex = tabs.findIndex((tab) => isAppNavActive(pathname, tab));
    if (currentIndex < 0) {
      return;
    }

    const root = document.querySelector('.dash-main--swipe');
    if (!root) {
      return;
    }

    const onTouchStart = (event: Event) => {
      if (isSwipeBlockedTarget(event.target)) {
        startRef.current = null;
        return;
      }
      const touch = (event as TouchEvent).touches[0];
      if (!touch) {
        return;
      }
      startRef.current = { x: touch.clientX, y: touch.clientY };
    };

    const onTouchEnd = (event: Event) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start || isSwipeBlockedTarget(event.target)) {
        return;
      }
      const touch = (event as TouchEvent).changedTouches[0];
      if (!touch) {
        return;
      }

      const dx = touch.clientX - start.x;
      const dy = Math.abs(touch.clientY - start.y);
      if (dy > SWIPE_MAX_VERTICAL_PX) {
        return;
      }

      if (dx > SWIPE_THRESHOLD_PX && currentIndex > 0) {
        navigate(tabs[currentIndex - 1]!);
        return;
      }
      if (dx < -SWIPE_THRESHOLD_PX && currentIndex < tabs.length - 1) {
        navigate(tabs[currentIndex + 1]!);
      }
    };

    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchend', onTouchEnd);
    };
  }, [pathname, navigate]);
}
