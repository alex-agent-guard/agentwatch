import { Outlet } from 'react-router-dom';
import GlobalEffects from '@/components/GlobalEffects';

interface LayoutProps {
  showEffects?: boolean;
  className?: string;
}

export default function Layout({ showEffects = true, className = '' }: LayoutProps) {
  return (
    <div className={`min-h-screen bg-bg-primary text-text-primary ${className}`}>
      {showEffects && <GlobalEffects />}
      <Outlet />
    </div>
  );
}
