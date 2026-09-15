import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useAuth } from '../lib/auth-context.jsx';
import { api } from '../lib/api.js';
import {
  Server, Globe, Database, Shield, Package, Clock, ScrollText,
  Settings, Users, FileText, Container, Code2,
  Moon, Sun, Monitor, LogOut, Activity, ChevronDown,
} from 'lucide-react';
import { cn } from '../lib/utils.js';
import { getStoredTheme, setStoredTheme, watchSystemTheme } from '../lib/theme.js';
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

const THEME_OPTIONS = [
  { id: 'light',  icon: Sun,     label: 'Light' },
  { id: 'dark',   icon: Moon,    label: 'Dark' },
  { id: 'system', icon: Monitor, label: 'System' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(getStoredTheme);
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.get('/api/services'),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    setStoredTheme(theme);
    return watchSystemTheme(theme);
  }, [theme]);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <Server className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-lg font-bold tracking-tight">iQPanel</span>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent rounded-none',
                isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background/80 px-6 py-3 backdrop-blur">
          <ServiceStatusChips services={services} compact className="min-w-0 flex-1" />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Account menu for ${user?.email ?? 'current user'}`}
              >
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{user?.role}</span>
                <span className="hidden max-w-[16rem] truncate sm:inline">{user?.email}</span>
                <ChevronDown className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                className="z-50 w-64 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-md"
              >
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium text-foreground">{user?.email}</p>
                  <p className="text-xs capitalize text-muted-foreground">{user?.role}</p>
                </div>
                <DropdownMenu.Separator className="my-2 h-px bg-border" />
                <div className="px-1 pb-1">
                  <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Theme</p>
                  <div role="radiogroup" aria-label="Theme" className="flex rounded-md border border-border p-0.5">
                    {THEME_OPTIONS.map(({ id, icon: Icon, label }) => {
                      const selected = theme === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={label}
                          title={label}
                          onClick={() => setTheme(id)}
                          className={cn(
                            'flex flex-1 items-center justify-center gap-1 rounded-sm px-1 py-1.5 text-[11px] font-medium transition-colors',
                            selected
                              ? 'bg-accent text-accent-foreground'
                              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <DropdownMenu.Separator className="my-2 h-px bg-border" />
                <DropdownMenu.Item
                  onSelect={handleLogout}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Logout
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </header>
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
