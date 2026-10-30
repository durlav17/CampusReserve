import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarX2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import type { Booking, BookingStatus, Paged } from '../services/types';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Pager, cx, StatusBadge } from '../components/ui';
import { fmtDay, fmtTime } from '../lib/format';

const STATUSES: (BookingStatus | '')[] = ['', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const LIMIT = 15;

export default function BookingsPage() {
  const { hasRole } = useAuth();
  const canSeeAll = hasRole('COORDINATOR', 'ADMIN');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [offset, setOffset] = useState(0);

  const list = useApi(() => api<Paged<Booking>>('/bookings', { query: { scope, status, limit: LIMIT, offset } }),
    [scope, status, offset]);

  return (
    <>
      <PageHeader title={scope === 'mine' ? 'My bookings' : 'All bookings'} subtitle="Track requests from submission to decision."
        actions={<Link to="/book" className="rounded-[var(--radius-control)] bg-lagoon px-3.5 py-2 text-sm font-semibold text-white hover:bg-lagoon-deep">New booking</Link>} />

      <div className="glass overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          {canSeeAll && (
            <div className="flex rounded-xl bg-ink/5 p-1" role="tablist" aria-label="Scope">
              {(['mine', 'all'] as const).map((s) => (
                <button key={s} role="tab" aria-selected={scope === s} onClick={() => { setScope(s); setOffset(0); }}
                  className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', scope === s ? 'bg-white shadow-sm' : 'text-ink-soft')}>
                  {s === 'mine' ? 'Mine' : 'Everyone'}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button key={s || 'all'} onClick={() => { setStatus(s); setOffset(0); }} aria-pressed={status === s}
                className={cx('rounded-full px-3 py-1 text-sm font-medium ring-1', status === s ? 'bg-lagoon text-white ring-lagoon' : 'bg-white/70 text-ink-soft ring-line hover:bg-white')}>
                {s ? s[0] + s.slice(1).toLowerCase() : 'Any status'}
              </button>
            ))}
          </div>
        </div>

        <ErrorState error={list.error} onRetry={list.reload} />
        {list.loading ? <div className="p-4"><LoadingBlock /></div> : !list.data?.items.length ? (
          <EmptyState icon={<CalendarX2 className="size-6" />} title="No bookings here"
            action={<Link to="/book" className="font-semibold text-lagoon hover:underline">Book a space</Link>}>
            {status ? 'Nothing matches this status.' : 'Your reservations will be listed here.'}
          </EmptyState>
        ) : (
          <>
            {/* Table on wide screens */}
            <table className="hidden w-full md:table">
              <thead className="border-b border-line">
                <tr><th className="table-head">Booking</th><th className="table-head">Resource</th><th className="table-head">When</th>
                  {scope === 'all' && <th className="table-head">Requested by</th>}<th className="table-head">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.data.items.map((b) => (
                  <tr key={b.bookingId} className="hover:bg-white/50">
                    <td className="table-cell"><Link to={`/bookings/${b.bookingId}`} className="font-semibold hover:text-lagoon-deep">{b.title}</Link>
                      <span className="block text-xs text-ink-faint">#{b.bookingId}, {b.attendees} attending</span></td>
                    <td className="table-cell">{b.resourceName}<span className="block text-xs text-ink-faint">{b.resourceCode}</span></td>
                    <td className="table-cell tabular-nums">{fmtDay(b.startTime)}<span className="block text-xs text-ink-faint">{fmtTime(b.startTime)}–{fmtTime(b.endTime)}, {b.durationHours} h</span></td>
                    {scope === 'all' && <td className="table-cell">{b.requesterName}<span className="block text-xs text-ink-faint">{b.requesterDeptCode}</span></td>}
                    <td className="table-cell"><StatusBadge value={b.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Cards on small screens */}
            <ul className="divide-y divide-line md:hidden">
              {list.data.items.map((b) => (
                <li key={b.bookingId}>
                  <Link to={`/bookings/${b.bookingId}`} className="block px-4 py-3">
                    <div className="flex items-start justify-between gap-2"><p className="font-semibold">{b.title}</p><StatusBadge value={b.status} /></div>
                    <p className="text-sm text-ink-soft">{b.resourceName}</p>
                    <p className="text-sm text-ink-faint">{fmtDay(b.startTime)}, {fmtTime(b.startTime)}–{fmtTime(b.endTime)}</p>
                  </Link>
                </li>
              ))}
            </ul>
            <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          </>
        )}
      </div>
    </>
  );
}
