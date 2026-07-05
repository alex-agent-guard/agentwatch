import { HashRouter, Route, Routes } from 'react-router-dom';
import AuthSessionBootstrap from '@/components/AuthSessionBootstrap';
import Layout from '@/components/Layout';
import RequireAuth from '@/components/RequireAuth';
import Auth from '@/pages/Auth';
import Dashboard from '@/pages/Dashboard';
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
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/reports"
          element={
            <RequireAuth>
              <Reports />
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
      </Routes>
    </HashRouter>
  );
}
