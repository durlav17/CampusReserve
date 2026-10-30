import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api } from '../services/api';
import type { Resource, ScheduleEntry } from '../services/types';
import { addDays, campusIso, fmtDay, fmtTime, hoursLabel, isoDay, weekStart } from '../lib/format';
import { Button, ErrorState, Skeleton, cx } from './ui';

const HOUR_PX = 48;

function useNarrow() {
  const q = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const fn = () => setNarrow(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return narrow;
}

/** Minutes since campus-local midnight for an ISO timestamp. */
function campusMinutes(iso: string) {
  const [h, m] = fmtTime(iso).split(':').map(Number);
  return h * 60 + m;
}

const chipTone: Record<string, string> = {
  APPROVED: 'border-lagoon/30 bg-lagoon-wash/85 text-lagoon-deep',
  PENDING: 'border-wait/30 bg-wait-wash/85 text-wait border-dashed',
  BLACKOUT: 'border-fix/30 text-fix bg-[repeating-linear-gradient(135deg,rgb(124_92_196/0.10)_0_8px,rgb(124_92_196/0.18)_8px_16px)]',
};

/**
 * Week view of one resource. Bookings and blackouts come from the Oracle
 * package function PKG_CAMPUS_RESERVATIONS.RESOURCE_SCHEDULE. Clicking a free
 * hour calls onPick(day, hour).
 */
export default function WeekCalendar({ resource, onPick, highlight }: {
  resource: Resource;
  onPick?: (day: string, hour: number) => void;
  highlight?: { day: string; start: number; end: number } | null;
}) {
  const today = isoDay(new Date());
  const [anchor, setAnchor] = useState(() => weekStart(today));
  const [focusDay, setFocusDay] = useState(today);
  const narrow = useNarrow();

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);
  const shown = narrow ? [days.includes(focusDay) ? focusDay : days[0]] : days;
  const hours = Array.from({ length: resource.closesAtHour - resource.opensAtHour }, (_, i) => resource.opensAtHour + i);

  const sched = useApi(() => api<{ items: ScheduleEntry[] }>(`/resources/${resource.resourceId}/schedule`, {
    query: { from: campusIso(anchor, 0), to: campusIso(addDays(anchor, 7), 0) },
  }).then((r) => r.items), [resource.resourceId, anchor]);

  const nowMin = campusMinutes(new Date().toISOString());
  const isPast = (day: string, hour: number) => day < today || (day === today && (hour + 1) * 60 <= nowMin);
  const busy = (day: string, hour: number) => sched.data?.some((e) => {
    if (isoDay(new Date(e.startTime)) !== day) return false;
    const s = campusMinutes(e.startTime); const en = campusMinutes(e.endTime);
    return s < (hour + 1) * 60 && en > hour * 60;
  });
  const closed = resource.status !== 'AVAILABLE';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setAnchor(addDays(anchor, -7))} aria-label="Previous week" icon={<ChevronLeft className="size-4" />} />
        <Button variant="secondary" onClick={() => { setAnchor(weekStart(today)); setFocusDay(today); }}>This week</Button>
        <Button variant="secondary" onClick={() => setAnchor(addDays(anchor, 7))} aria-label="Next week" icon={<ChevronRight className="size-4" />} />
        <p className="ml-1 font-display font-bold">{fmtDay(days[0])} to {fmtDay(days[6])}</p>
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-ink-soft">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-lagoon-wash ring-1 ring-lagoon/30" />Booked</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-wait-wash ring-1 ring-wait/30" />Pending</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-fix-wash ring-1 ring-fix/30" />Blocked</span>
          {onPick && <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-white ring-1 ring-line" />Free, select to book</span>}
        </div>
      </div>

      {narrow && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Day">
          {days.map((d) => (
            <button key={d} role="tab" aria-selected={d === shown[0]} onClick={() => setFocusDay(d)}
              className={cx('shrink-0 rounded-xl px-3 py-1.5 text-sm font-medium', d === shown[0] ? 'bg-lagoon text-white' : 'bg-white/70 text-ink-soft')}>
              {fmtDay(d).split(',')[0]} {d.slice(8)}
            </button>
          ))}
        </div>
      )}

      <ErrorState error={sched.error} onRetry={sched.reload} />
      {closed && (
        <p className="mb-3 rounded-xl bg-fix-wash/80 px-3 py-2 text-sm text-fix">
          This resource is {resource.status === 'MAINTENANCE' ? 'under maintenance' : 'retired'} and cannot be booked right now.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/45">
        <div className="grid" style={{ gridTemplateColumns: `3.5rem repeat(${shown.length}, minmax(0, 1fr))` }}>
          <div />
          {shown.map((d) => (
            <div key={d} className={cx('border-b border-l border-line px-2 py-2 text-center text-sm font-semibold', d === today && 'text-lagoon-deep')}>
              {fmtDay(d).replace(',', '')}
            </div>
          ))}

          <div className="relative">
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="pr-2 text-right text-xs text-ink-faint tabular-nums">{hoursLabel(h)}</div>
            ))}
          </div>

          {shown.map((d) => (
            <div key={d} className="relative border-l border-line">
              {hours.map((h) => {
                const disabled = closed || isPast(d, h) || busy(d, h) || !onPick;
                return (
                  <button
                    key={h}
                    type="button"
                    disabled={disabled}
                    onClick={() => onPick?.(d, h)}
                    style={{ height: HOUR_PX }}
                    aria-label={`${fmtDay(d)} ${hoursLabel(h)}${disabled ? '' : ', free'}`}
                    className={cx('block w-full border-t border-line/70 transition-colors',
                      isPast(d, h) ? 'bg-ink/[0.035]' : !disabled && 'hover:bg-lagoon-wash/60 cursor-pointer')}
                  />
                );
              })}

              {sched.loading && <Skeleton className="absolute inset-x-2 top-3 h-16" />}


              {sched.data?.filter((e) => isoDay(new Date(e.startTime)) === d).map((e) => {
                const top = (campusMinutes(e.startTime) - resource.opensAtHour * 60) / 60 * HOUR_PX;
                const height = Math.max((campusMinutes(e.endTime) - campusMinutes(e.startTime)) / 60 * HOUR_PX, 22);
                const tone = e.entryKind === 'BLACKOUT' ? 'BLACKOUT' : e.entryStatus;
                return (
                  <div key={`${e.entryKind}-${e.entryId}`}
                    className={cx('pointer-events-none absolute inset-x-1.5 overflow-hidden rounded-xl border px-2 py-1 backdrop-blur-sm', chipTone[tone])}
                    style={{ top: Math.max(top, 0) + 2, height: height - 4 }}>
                    <p className="truncate text-xs font-semibold">{e.title}</p>
                    {height > 40 && <p className="truncate text-[11px] opacity-80">{fmtTime(e.startTime)}–{fmtTime(e.endTime)}{e.requesterName ? `, ${e.requesterName}` : ''}</p>}
                  </div>
                );
              })}

              {highlight && highlight.day === d && (
                <div className="pointer-events-none absolute inset-x-1.5 rounded-xl border-2 border-iris bg-iris-wash/70"
                  style={{ top: (highlight.start - resource.opensAtHour) * HOUR_PX + 2, height: (highlight.end - highlight.start) * HOUR_PX - 4 }}>
                  <p className="px-2 py-1 text-xs font-semibold text-iris">Your request</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
