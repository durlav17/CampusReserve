import { Link } from 'react-router-dom';
import { Activity, Building2, CalendarCheck, ClipboardCheck, Gauge, Wrench } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../hooks/useAuth';
import { useApi } from '../hooks/useApi';
import { api } from '../services/api';
import type { Booking, Paged, Summary } from '../services/types';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Panel, Skeleton, Stat, StatusBadge } from '../components/ui';
import { fmtDay, fmtRange, fmtTime } from '../lib/format';

export default function DashboardPage() {
  const { user, hasRole } = useAuth();
  const isStaff = hasRole('FACULTY', 'COORDINATOR', 'ADMIN');
  const summary = useApi(() => api<{ summary: Summary }>('/analytics/summary').then((r) => r.summary), []);
  const upcoming = useApi(() => api<Paged<Booking>>('/bookings', {
    query: { scope: 'mine', from: new Date().toISOString(), limit: 6 },
  }), []);
  const trend = useApi(() => (isStaff
    ? api<{ items: { bookingDay: string; total: number; approved: number; pending: number }[] }>('/analytics/trend', { query: { days: 21 } }).then((r) => r.items)
    : Promise.resolve([])), [isStaff]);

  const s = summary.data;
  const firstName = user?.fullName.replace(/^Dr\.\s*/, '').split(' ')[0];
  const next = upcoming.data?.items.filter((b) => b.status === 'APPROVED' || b.status === 'PENDING')
    .sort((a, b) => a.startTime.localeCompare(b.startTime)) ?? [];

  return (
    <>
      <PageHeader title={`Good to see you, ${firstName}`} subtitle="What is happening across campus resources today." />

      <ErrorState error={summary.error} onRetry={summary.reload} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summary.loading || !s ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[92px] rounded-[var(--radius-panel)]" />) : (
          <>
            <Stat label="Resources" value={s.totalResources} icon={<Building2 className="size-5" />} hint={`${s.availableResources} bookable`} />
            <Stat label="In use now" value={s.activeNow} icon={<Activity className="size-5" />} tone="ok" />
            <Stat label="Booked today" value={s.bookingsToday} icon={<CalendarCheck className="size-5" />} />
            <Stat label="Awaiting approval" value={s.pendingApprovals} icon={<ClipboardCheck className="size-5" />} tone="wait" />
            <Stat label="Open maintenance" value={s.openMaintenance} icon={<Wrench className="size-5" />} tone="fix" hint={`${s.resourcesInMaintenance} out of service`} />
            <Stat label="Utilisation, 30 days" value={s.avgUtilisation30d === null ? 'n/a' : `${s.avgUtilisation30d}%`} icon={<Gauge className="size-5" />} />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
        {isStaff ? (
          <Panel title="Bookings per day" action={<Link to="/analytics" className="text-sm font-medium text-lagoon hover:underline">Open analytics</Link>}>
            <ErrorState error={trend.error} onRetry={trend.reload} />
            {trend.loading ? <Skeleton className="h-64" /> : (
              <div className="h-64" role="img" aria-label="Area chart of approved and pending bookings per day over the last three weeks and the coming week">
                <ResponsiveContainer>
                  <AreaChart data={trend.data ?? []} margin={{ left: -18, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1F7A8C" stopOpacity={0.35} /><stop offset="100%" stopColor="#1F7A8C" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgb(23 32 51 / 0.06)" vertical={false} />
                    <XAxis dataKey="bookingDay" tickFormatter={(d) => fmtDay(d).split(',')[1] ?? d} tick={{ fontSize: 11, fill: '#6B7689' }} interval="preserveStartEnd" minTickGap={24} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7689' }} />
                    <Tooltip labelFormatter={(d) => fmtDay(String(d))} contentStyle={{ borderRadius: 12, border: 'none' }} />
                    <Area type="monotone" dataKey="approved" name="Approved" stroke="#1F7A8C" strokeWidth={2} fill="url(#gA)" />
                    <Area type="monotone" dataKey="pending" name="Pending" stroke="#B7791F" strokeWidth={2} fill="transparent" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        ) : (
          <Panel title="Quick start">
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { to: '/resources', t: 'Find a space', d: 'Search labs, halls and equipment.' },
                { to: '/calendar', t: 'Check availability', d: 'See a week at a glance.' },
                { to: '/maintenance', t: 'Report a fault', d: 'Tell the facilities team.' },
              ].map((x) => (
                <Link key={x.to} to={x.to} className="rounded-2xl border border-line bg-white/60 p-4 hover:bg-white">
                  <p className="font-semibold">{x.t}</p><p className="text-sm text-ink-soft">{x.d}</p>
                </Link>
              ))}
            </div>
          </Panel>
        )}

        <Panel title="Your next bookings" action={<Link to="/bookings" className="text-sm font-medium text-lagoon hover:underline">See all</Link>} padded={false}>
          <ErrorState error={upcoming.error} onRetry={upcoming.reload} />
          {upcoming.loading ? <div className="p-5"><LoadingBlock rows={3} /></div> : next.length === 0 ? (
            <EmptyState icon={<CalendarCheck className="size-6" />} title="Nothing booked yet"
              action={<Link to="/book" className="font-semibold text-lagoon hover:underline">Book a space</Link>}>
              Upcoming reservations will appear here.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {next.map((b) => (
                <li key={b.bookingId}>
                  <Link to={`/bookings/${b.bookingId}`} className="flex items-center gap-4 px-5 py-3 hover:bg-white/50">
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-xs text-ink-faint">{fmtDay(b.startTime).split(',')[0]}</p>
                      <p className="font-display text-lg font-extrabold tabular-nums">{fmtTime(b.startTime)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{b.title}</p>
                      <p className="truncate text-sm text-ink-soft">{b.resourceName}, {fmtRange(b.startTime, b.endTime)}</p>
                    </div>
                    <StatusBadge value={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
