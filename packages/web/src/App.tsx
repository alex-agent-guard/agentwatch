import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthSessionBootstrap from '@/components/AuthSessionBootstrap';
import Layout from '@/components/Layout';
import RequireAuth from '@/components/RequireAuth';
import RequireBoundAgent from '@/components/RequireBoundAgent';
import RequireLive from '@/components/RequireLive';
import AppHome from '@/pages/AppHome';
import Auth from '@/pages/Auth';
import Activate from '@/pages/Activate';
import Dashboard from '@/pages/Dashboard';
import DevDashboardPreview from '@/pages/DevDashboardPreview';
import DevProtectionPreview, { DevProtectionEmptyPreview } from '@/pages/DevProtectionPreview';
import DevReportsPreview from '@/pages/DevReportsPreview';
import DevSettingsPreview from '@/pages/DevSettingsPreview';
import Home from '@/pages/Home';
import Reports from '@/pages/Reports';
import Settings from '@/pages/Settings';

export default function App() {
  return (
    <HashRouter>
      <AuthSessionBootstrap />
      <Routes>
        <Route element={<Layout showEffects={false} />}>
          <Route path="/" element={<Home />} />
          <Route path="/auth" element={<Auth />} />
        </Route>
        <Route
          path="/activate"
          element={
            <RequireAuth>
              <Activate />
            </RequireAuth>
          }
        />
        <Route
          path="/home"
          element={
            <RequireAuth>
              <RequireLive>
                <RequireBoundAgent>
                  <AppHome />
                </RequireBoundAgent>
              </RequireLive>
            </RequireAuth>
          }
        />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <RequireLive>
                <RequireBoundAgent>
                  <Dashboard />
                </RequireBoundAgent>
              </RequireLive>
            </RequireAuth>
          }
        />
        <Route
          path="/reports"
          element={
            <RequireAuth>
              <RequireLive>
                <RequireBoundAgent>
                  <Reports />
                </RequireBoundAgent>
              </RequireLive>
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <Settings />
            </RequireAuth>
          }
        />
        {/* 新用户 Demo — 无需登录，示例数据 */}
        <Route path="/preview/home" element={<DevProtectionPreview />} />
        <Route path="/preview/home-empty" element={<DevProtectionEmptyPreview />} />
        <Route path="/preview/home-warn" element={<Navigate to="/preview/home?scenario=warn" replace />} />
        <Route path="/preview/home-block" element={<Navigate to="/preview/home?scenario=block" replace />} />
        <Route path="/preview/protection" element={<Navigate to="/preview/home" replace />} />
        <Route path="/preview/dashboard" element={<DevDashboardPreview />} />
        <Route path="/preview/reports" element={<DevReportsPreview />} />
        <Route path="/preview/settings" element={<DevSettingsPreview />} />
        <Route path="/preview/onboarding" element={<Navigate to="/preview/settings" replace />} />
      </Routes>
    </HashRouter>
  );
}
