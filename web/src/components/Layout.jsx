import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth-context.jsx';
import { api } from '../lib/api.js';
import {
  Server, Globe, Database, Shield, Package, Clock, ScrollText,
  Settings, Users, FileText, Container, Code2,
  ChevronLeft, ChevronRight, Moon, Sun, LogOut, Activity,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import ServiceStatusChips from './ServiceStatus.jsx';

const NAV = [
  { to: '/',          icon: Activity,    label: 'Dashboard' },
  { to: '/sites',     icon: Globe,       label: 'Sites' },
  { to: '/services',  icon: Server,      label: 'Services' },
  { to: '/php',       icon: Code2,       label: 'PHP' },
  { to: '/databases', icon: Database,    label: 'Databases' },
  { to: '/docker',    icon: Container,   label: 'Docker' },
  { to: '/firewall',  icon: Shield,      label: 'Firewall' },
  { to: '/logs',      icon: ScrollText,  label: 'Logs' },
  { to: '/cron',      icon: Clock,       label: 'Cron' },
  { to: '/packages',  icon: Package,     label: 'Packages' },
  { to: '/users',     icon: Users,       label: 'Users' },
  { to: '/audit',     icon: FileText,    label: 'Audit Log' },
  { to: '/settings',  icon: Settings,    label: 'Settings' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get('/api/services'),
    refetchInterval: 15_000,
  });

  function toggleDark() {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    setDark(next);
  }

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className={cn(
        'flex flex-col border-r border-border bg-card transition-all duration-200',
        collapsed ? 'w-16' : 'w-56',
      )}>
        {/* Logo */}
        <div className={cn('flex items-center gap-2 px-4 py-4 border-b border-border', collapsed && 'justify-center px-0')}>
          <Server className="h-6 w-6 text-primary shrink-0" />
          {!collapsed && <span className="font-bold text-lg tracking-tight">iQPanel</span>}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent rounded-none',
                isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
                collapsed && 'justify-center px-0',
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-2 space-y-1">
          <button
            onClick={toggleDark}
            className="flex w-full items-center gap-3 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-md"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {!collapsed && (dark ? 'Light mode' : 'Dark mode')}
          </button>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-md"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && 'Logout'}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center gap-3 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-md"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && 'Collapse'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/80 backdrop-blur px-6 py-3">
          <ServiceStatusChips services={services} compact className="min-w-0 flex-1" />
          <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{user?.role}</span>
            <span className="hidden sm:inline">{user?.email}</span>
          </div>
        </header>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
