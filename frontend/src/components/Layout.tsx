import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Bell, BarChart3, Building2, CalendarDays, CalendarPlus, ClipboardCheck, History, LayoutDashboard,
  ListChecks, LogOut, Menu, Search, Settings, Users, Wrench, X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import type { Notification, RoleCode } from '../services/types';
import { cx } from './ui';
import { relative } from '../lib/format';

type NavItem = { to: string; label: string; icon: typeof Bell; roles?: RoleCode[] };
const STAFF: RoleCode[] = ['FACULTY', 'COORDINATOR', 'ADMIN'];
const APPROVERS: RoleCode[] = ['COORDINATOR', 'ADMIN'];

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Book',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard },
      { to: '/resources', label: 'Find a space', icon: Search },
      { to: '/calendar', label: 'Availability', icon: CalendarDays },
      { to: '/book', label: 'New booking', icon: CalendarPlus },
      { to: '/bookings', label: 'My bookings', icon: ListChecks },
    ],
  },
  {
    label: 'Operate',
    items: [
      { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, roles: APPROVERS },
      { to: '/maintenance', label: 'Maintenance', icon: Wrench },
      { to: '/analytics', label: 'Analytics', icon: BarChart3, roles: STAFF },
    ],
  },
  {
    label: 'Administer',
    items: [
      { to: '/admin/resources', label: 'Resources', icon: Building2, roles: ['ADMIN'] },
      { to: '/admin/users', label: 'Users', icon: Users, roles: ['ADMIN'] },
      { to: '/audit', label: 'Audit history', icon: History, roles: APPROVERS },
    ],
  },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src="/favicon.svg" alt="" className="size-8" />
      <div className="leading-tight">
        <p className="font-display text-[1.05rem] font-extrabold">CampusReserve</p>
        <p className="text-xs text-ink-faint">Shared campus resources</p>
      </div>
    </div>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  return (
    <nav aria-label="Main" className="space-y-5">
      {groups.map((g) => {
        const items = g.items.filter((i) => !i.roles || (user && i.roles.includes(user.role.code)));
        if (!items.length) return null;
        return (
          <div key={g.label}>
            <p className="mb-1.5 px-3 text-xs font-semibold text-ink-faint">{g.label}</p>
            <ul className="space-y-0.5">
              {items.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) => cx(
                      'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                      isActive ? 'bg-white text-lagoon-deep shadow-sm' : 'text-ink-soft hover:bg-white/55 hover:text-ink',
                    )}
                  >
                    <Icon className="size-[18px]" aria-hidden />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const navigate = useNavigate();
  const unread = items.filter((n) => n.isRead === 'N').length;

  const load = () => api<{ items: Notification[] }>('/notifications').then((r) => setItems(r.items)).catch(() => {});
  useEffect(() => {
    void load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const openItem = async (n: Notification) => {
    if (n.isRead === 'N') {
      await api(`/notifications/${n.notificationId}/read`, { method: 'POST' }).catch(() => {});
      setItems((xs) => xs.map((x) => (x.notificationId === n.notificationId ? { ...x, isRead: 'Y' } : x)));
    }
    if (n.bookingId) { setOpen(false); navigate(`/bookings/${n.bookingId}`); }
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
    setItems((xs) => xs.map((x) => ({ ...x, isRead: 'Y' })));
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-10 place-items-center rounded-xl text-ink-soft hover:bg-white/70"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="glass-strong absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-display font-bold">Notifications</p>
            {unread > 0 && <button onClick={readAll} className="text-sm font-medium text-lagoon hover:underline">Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-faint">You're all caught up.</li>}
            {items.map((n) => (
              <li key={n.notificationId}>
                <button onClick={() => openItem(n)} className="flex w-full gap-3 px-4 py-3 text-left hover:bg-white/70">
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.isRead === 'N' ? 'bg-lagoon' : 'bg-transparent')} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{n.title}</span>
                    <span className="block text-sm text-ink-soft">{n.message}</span>
                    <span className="block text-xs text-ink-faint">{relative(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [drawer, setDrawer] = useState(false);

  const initials = user?.fullName.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !w.endsWith('.')).slice(0, 2).map((w) => w[0]).join('') ?? '';

  const footer = (
    <div className="mt-auto space-y-1 border-t border-line pt-4">
      <NavLink to="/profile" className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/55">
        <span className="grid size-9 place-items-center rounded-full bg-lagoon text-sm font-bold text-white">{initials}</span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold">{user?.fullName}</span>
          <span className="block truncate text-xs text-ink-faint">{user?.role.name}, {user?.department.code}</span>
        </span>
        <Settings className="ml-auto size-4 text-ink-faint" aria-hidden />
      </NavLink>
      <button onClick={logout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-ink-soft hover:bg-white/55 hover:text-ink">
        <LogOut className="size-[18px]" aria-hidden /> Sign out
      </button>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1600px] gap-5 p-3 sm:p-4 lg:p-5">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="glass sticky top-5 hidden h-[calc(100dvh-2.5rem)] w-64 shrink-0 flex-col gap-6 overflow-y-auto p-4 lg:flex">
        <Brand />
        <Navigation />
        {footer}
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-ink/30 backdrop-blur-sm" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="glass-strong absolute inset-y-3 left-3 flex w-72 flex-col gap-6 overflow-y-auto p-4">
            <div className="flex items-center justify-between"><Brand />
              <button onClick={() => setDrawer(false)} className="rounded-lg p-1.5 hover:bg-ink/5" aria-label="Close menu"><X className="size-5" /></button>
            </div>
            <Navigation onNavigate={() => setDrawer(false)} />
            {footer}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-3 z-30 mb-5 flex items-center gap-2 px-3 py-2 sm:top-4 lg:top-5">
          <button onClick={() => setDrawer(true)} className="grid size-10 place-items-center rounded-xl hover:bg-white/70 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="font-display font-extrabold lg:hidden">CampusReserve</span>
          <p className="hidden text-sm text-ink-soft lg:block">
            Signed in as <span className="font-semibold text-ink">{user?.fullName}</span>
          </p>
          <div className="ml-auto flex items-center gap-1">
            <NavLink to="/book" className="hidden items-center gap-2 rounded-xl bg-lagoon px-3 py-2 text-sm font-semibold text-white hover:bg-lagoon-deep sm:inline-flex">
              <CalendarPlus className="size-4" aria-hidden /> Book a space
            </NavLink>
            <Notifications />
          </div>
        </header>
        <main id="main" className="min-w-0 flex-1 pb-8">
          <Outlet />
        </main>
        <footer className="pb-2 text-center text-xs text-ink-faint">
          CampusReserve, an individual BCSE302P mini project by Durlav Dani (24BCE2361). Demo data is synthetic.
        </footer>
      </div>
    </div>
  );
}
