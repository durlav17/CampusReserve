import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, Clock, MapPin, Users, Wrench } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api } from '../services/api';
import type { ResourceDetail } from '../services/types';
import { Button, ErrorState, LoadingBlock, PageHeader, Panel, StatusBadge } from '../components/ui';
import WeekCalendar from '../components/WeekCalendar';
import { fmtDate, fmtRange, hoursLabel } from '../lib/format';

export default function ResourceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const r = useApi(() => api<{ resource: ResourceDetail }>(`/resources/${id}`).then((x) => x.resource), [id]);

  if (r.loading) return <LoadingBlock rows={6} />;
  if (r.error || !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  const res = r.data;
  const features = Object.entries(res.features ?? {});

  return (
    <>
      <Link to="/resources" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All resources
      </Link>
      <PageHeader
        title={res.resourceName}
        subtitle={`${res.categoryName} managed by ${res.managedByDeptName}`}
        actions={res.status === 'AVAILABLE' && (
          <Button onClick={() => navigate(`/book?resource=${res.resourceId}`)} icon={<CalendarPlus className="size-4" />}>Book this resource</Button>
        )}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_22rem]">
        <Panel title="Availability this week">
          <WeekCalendar resource={res} onPick={(day, hour) => navigate(`/book?resource=${res.resourceId}&date=${day}&start=${hour}`)} />
        </Panel>

        <div className="space-y-5">
          <Panel title="Details">
            <div className="mb-3"><StatusBadge value={res.status} /></div>
            <dl className="space-y-2.5 text-sm">
              <div className="flex gap-2"><MapPin className="size-4 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">Location</dt>
                <dd>{res.buildingName ? `${res.buildingName}, room ${res.roomNo}, floor ${res.floorNo}` : 'Portable equipment, collect from the Estate Office'}</dd></div>
              <div className="flex gap-2"><Users className="size-4 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">Capacity</dt>
                <dd>{res.capacity > 0 ? `${res.capacity} people` : 'Not seat-limited'}</dd></div>
              <div className="flex gap-2"><Clock className="size-4 shrink-0 text-ink-faint" aria-hidden /><dt className="sr-only">Rules</dt>
                <dd>Open {hoursLabel(res.opensAtHour)}–{hoursLabel(res.closesAtHour)}, up to {res.maxBookingHours} h per booking
                  {res.minNoticeHours > 0 ? `, ${res.minNoticeHours} h notice` : ''}. {res.requiresApproval === 'Y' ? 'Requests need approval.' : 'Confirmed instantly.'}</dd></div>
            </dl>
            {res.description && <p className="mt-3 text-sm text-ink-soft">{res.description}</p>}
            {features.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {features.map(([k, v]) => (
                  <li key={k} className="rounded-full bg-white/80 px-2.5 py-1 text-xs text-ink-soft ring-1 ring-line">
                    {k.replace(/_/g, ' ')}{v === true ? '' : `: ${Array.isArray(v) ? v.join(', ') : String(v)}`}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 rounded-xl bg-lagoon-wash/70 p-3">
              <p className="text-sm text-ink-soft">Utilisation over the last 30 days</p>
              <div className="mt-1.5 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white">
                  <div className="h-full rounded-full bg-lagoon" style={{ width: `${Math.min(res.utilisation30d, 100)}%` }} />
                </div>
                <span className="font-display font-extrabold tabular-nums">{res.utilisation30d}%</span>
              </div>
            </div>
          </Panel>

          <Panel title="Open maintenance" action={<Link to={`/maintenance?resource=${res.resourceId}`} className="text-sm font-medium text-lagoon hover:underline">Report a fault</Link>}>
            {res.openTickets.length === 0 ? <p className="text-sm text-ink-soft">No open tickets.</p> : (
              <ul className="space-y-2">
                {res.openTickets.map((m) => (
                  <li key={m.requestId} className="flex items-start gap-2 text-sm">
                    <Wrench className="mt-0.5 size-4 text-fix" aria-hidden />
                    <span className="flex-1">{m.title}<span className="block text-xs text-ink-faint">Reported {fmtDate(m.createdAt)}</span></span>
                    <StatusBadge value={m.priority} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Coming up">
            {res.upcoming.length === 0 ? <p className="text-sm text-ink-soft">No upcoming bookings.</p> : (
              <ul className="space-y-2 text-sm">
                {res.upcoming.map((b) => (
                  <li key={b.bookingId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0"><span className="block truncate font-medium">{b.title}</span>
                      <span className="block text-xs text-ink-faint">{fmtRange(b.startTime, b.endTime)}</span></span>
                    <StatusBadge value={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
