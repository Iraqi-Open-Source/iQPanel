import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth-context.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import Spinner from './components/ui/Spinner.jsx';

// Lazy-loaded pages
const Dashboard        = lazy(() => import('./pages/Dashboard.jsx'));
const SitesPage        = lazy(() => import('./pages/SitesPage.jsx'));
const SiteDetailPage   = lazy(() => import('./pages/SiteDetailPage.jsx'));
const SiteWizardPage   = lazy(() => import('./pages/SiteWizardPage.jsx'));
const ServicesPage     = lazy(() => import('./pages/ServicesPage.jsx'));
const PHPPage          = lazy(() => import('./pages/PHPPage.jsx'));
const DatabasesPage    = lazy(() => import('./pages/DatabasesPage.jsx'));
const DockerPage       = lazy(() => import('./pages/DockerPage.jsx'));
const FirewallPage     = lazy(() => import('./pages/FirewallPage.jsx'));
const LogsPage         = lazy(() => import('./pages/LogsPage.jsx'));
const CronPage         = lazy(() => import('./pages/CronPage.jsx'));
const PackagesPage     = lazy(() => import('./pages/PackagesPage.jsx'));
const UsersPage        = lazy(() => import('./pages/UsersPage.jsx'));
const SettingsPage     = lazy(() => import('./pages/SettingsPage.jsx'));
const AuditPage        = lazy(() => import('./pages/AuditPage.jsx'));

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center"><Spinner size="lg" /></div>;
  if (!user)   return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<div className="flex h-screen items-center justify-center"><Spinner size="lg" /></div>}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<Dashboard />} />
            <Route path="sites" element={<SitesPage />} />
            <Route path="sites/new" element={<SiteWizardPage />} />
            <Route path="sites/:slug" element={<SiteDetailPage />} />
            <Route path="sites/:slug/:tab" element={<SiteDetailPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="php" element={<PHPPage />} />
            <Route path="databases" element={<DatabasesPage />} />
            <Route path="docker" element={<DockerPage />} />
            <Route path="firewall" element={<FirewallPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="cron" element={<CronPage />} />
            <Route path="packages" element={<PackagesPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
