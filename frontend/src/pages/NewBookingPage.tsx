import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Loader2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, ApiError, newRequestKey } from '../services/api';
import type { Booking, Resource, Slot } from '../services/types';
import { Button, ErrorState, Field, LoadingBlock, PageHeader, Panel, cx, useToast } from '../components/ui';
import WeekCalendar from '../components/WeekCalendar';
import { addDays, campusIso, fmtDay, fmtTime, hoursLabel, isoDay } from '../lib/format';

const VERDICT_TEXT: Record<string, string> = {
  AVAILABLE: 'This time is free.',
  CONFLICT: 'Someone already holds part of this time.',
  BLACKOUT: 'The resource is blocked out during this time.',
  OUTSIDE_HOURS: 'Outside operating hours.',
  MAINTENANCE: 'The resource is under maintenance.',
  RETIRED: 'The resource has been retired.',
  INVALID_INTERVAL: 'End time must be after start time.',
  NOT_FOUND: 'Resource not found.',
};

const timeOptions = (open: number, close: number) => {
  const out: string[] = [];
  for (let h = open; h <= close; h++) for (const m of [0, 30]) if (h < close || m === 0) out.push(`${String(h).padStart(2, '0')}:${m ? '30' : '00'}`);
  return out;
};

export default function NewBookingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const list = useApi(() => api<{ items: Resource[] }>('/resources', { query: { status: 'AVAILABLE' } }).then((r) => r.items), []);

  const [resourceId, setResourceId] = useState(params.get('resource') ?? '');
  const [date, setDate] = useState(params.get('date') ?? addDays(isoDay(new Date()), 1));
  const startParam = Number(params.get('start'));
  const [start, setStart] = useState(startParam ? `${String(startParam).padStart(2, '0')}:00` : '10:00');
  const [end, setEnd] = useState(startParam ? `${String(startParam + 1).padStart(2, '0')}:00` : '11:00');
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [attendees, setAttendees] = useState('10');
  const [verdict, setVerdict] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const requestKey = useRef(newRequestKey());   // stable across retries of the same submission

  const resource = list.data?.find((r) => String(r.resourceId) === resourceId);
  useEffect(() => {
    if (!resourceId && list.data?.length) setResourceId(String(list.data[0].resourceId));
  }, [list.data, resourceId]);

  const times = useMemo(() => (resource ? timeOptions(resource.opensAtHour, resource.closesAtHour) : []), [resource]);
  const toIso = (hhmm: string) => campusIso(date, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)));

  // Day strip from the PIPELINED function PKG_CAMPUS_RESERVATIONS.DAY_SLOTS
  const slots = useApi(() => (resource
    ? api<{ items: Slot[] }>(`/resources/${resource.resourceId}/slots`, { query: { date, slotMinutes: 60 } }).then((r) => r.items)
    : Promise.resolve([] as Slot[])), [resource?.resourceId, date]);

  // Advisory availability check (FN_RESOURCE_AVAILABILITY). The final decision is
  // still made by SP_CREATE_BOOKING under a row lock when the form is submitted.
  useEffect(() => {
    if (!resource || start >= end) { setVerdict(start >= end ? 'INVALID_INTERVAL' : null); return; }
    let live = true;
    setChecking(true);
    const t = setTimeout(() => {
      api<{ verdict: string }>(`/resources/${resource.resourceId}/availability`, { query: { start: toIso(start), end: toIso(end) } })
        .then((r) => live && setVerdict(r.verdict))
        .catch(() => live && setVerdict(null))
        .finally(() => live && setChecking(false));
    }, 250);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource?.resourceId, date, start, end]);

  const fieldErrors = submitError?.fieldErrors() ?? {};
  const hours = (Number(end.slice(0, 2)) * 60 + Number(end.slice(3)) - Number(start.slice(0, 2)) * 60 - Number(start.slice(3))) / 60;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!resource) return;
    setPending(true);
    setSubmitError(null);
    try {
      const res = await api<{ booking: Booking; duplicate: boolean }>('/bookings', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey.current },
        body: { resourceId: resource.resourceId, title, purpose: purpose || undefined, attendees: Number(attendees), start: toIso(start), end: toIso(end) },
      });
      requestKey.current = newRequestKey();
      toast('ok', res.booking.status === 'APPROVED' ? 'Booking confirmed' : 'Booking submitted for approval');
      navigate(`/bookings/${res.booking.bookingId}`);
    } catch (err) {
      setSubmitError(err as ApiError);
      // A definite rejection means the next attempt is a new request.
      if ((err as ApiError).status >= 400 && (err as ApiError).status < 500) requestKey.current = newRequestKey();
      void slots.reload();
    } finally {
      setPending(false);
    }
  };

  if (list.loading) return <LoadingBlock rows={6} />;

  return (
    <>
      <PageHeader title="New booking" subtitle="Choose a resource and time. The request is checked against every other booking when you submit." />
      <ErrorState error={list.error} onRetry={list.reload} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[26rem_1fr]">
        <Panel title="Request">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Resource" error={fieldErrors.resourceId}>
              {(id) => (
                <select id={id} className="field" value={resourceId} onChange={(e) => setResourceId(e.target.value)} required>
                  {list.data?.map((r) => <option key={r.resourceId} value={r.resourceId}>{r.resourceName} ({r.resourceCode})</option>)}
                </select>
              )}
            </Field>
            {resource && (
              <p className="-mt-2 text-sm text-ink-faint">
                Up to {resource.maxBookingHours} h{resource.capacity > 0 ? `, ${resource.capacity} seats` : ''}
                {resource.minNoticeHours > 0 ? `, ${resource.minNoticeHours} h notice` : ''}.
                {resource.requiresApproval === 'Y' ? ' Needs approval.' : ' Confirmed instantly.'}
              </p>
            )}
            <Field label="Date">
              {(id) => <input id={id} type="date" className="field" min={isoDay(new Date())} value={date} onChange={(e) => setDate(e.target.value)} required />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                {(id) => <select id={id} className="field" value={start} onChange={(e) => setStart(e.target.value)}>{times.slice(0, -1).map((t) => <option key={t}>{t}</option>)}</select>}
              </Field>
              <Field label="To" error={fieldErrors.end}>
                {(id) => <select id={id} className="field" value={end} onChange={(e) => setEnd(e.target.value)}>{times.slice(1).map((t) => <option key={t}>{t}</option>)}</select>}
              </Field>
            </div>

            <div aria-live="polite" className={cx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
              checking ? 'bg-ink/5 text-ink-soft' : verdict === 'AVAILABLE' ? 'bg-ok-wash text-ok' : verdict ? 'bg-bad-wash text-bad' : 'hidden')}>
              {checking ? <Loader2 className="size-4 animate-spin" /> : verdict === 'AVAILABLE' ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
              {checking ? 'Checking availability' : `${VERDICT_TEXT[verdict ?? ''] ?? verdict}${verdict === 'AVAILABLE' && hours > 0 ? ` ${hours} h selected.` : ''}`}
            </div>

            <Field label="Title" error={fieldErrors.title}>
              {(id, d) => <input id={id} aria-describedby={d} className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. DBMS project review" maxLength={150} required />}
            </Field>
            <Field label="Expected attendees" error={fieldErrors.attendees}>
              {(id, d) => <input id={id} aria-describedby={d} type="number" min={1} className="field" value={attendees} onChange={(e) => setAttendees(e.target.value)} required />}
            </Field>
            <Field label="Purpose (optional)" error={fieldErrors.purpose}>
              {(id) => <textarea id={id} rows={3} className="field resize-y" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={1000} />}
            </Field>
            {submitError && !Object.keys(fieldErrors).length && <ErrorState error={submitError} />}
            <Button type="submit" loading={pending} className="w-full py-2.5" disabled={!resource || !title.trim() || start >= end}>
              {resource?.requiresApproval === 'Y' ? 'Submit request' : 'Confirm booking'}
            </Button>
          </form>
        </Panel>

        <div className="space-y-5">
          {resource && (
            <Panel title={`Hour by hour, ${fmtDay(date)}`}>
              {slots.loading ? <LoadingBlock rows={1} /> : (
                <ol className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
                  {slots.data?.map((s) => (
                    <li key={s.slotStart} title={s.slotState}
                      className={cx('rounded-lg px-1 py-2 text-center text-xs font-medium',
                        s.slotState === 'FREE' && 'bg-white/80 text-ink ring-1 ring-line',
                        s.slotState === 'BOOKED' && 'bg-lagoon-wash text-lagoon-deep',
                        s.slotState === 'PENDING' && 'bg-wait-wash text-wait',
                        s.slotState === 'BLACKOUT' && 'bg-fix-wash text-fix',
                        (s.slotState === 'PAST' || s.slotState === 'CLOSED') && 'bg-ink/5 text-ink-faint line-through')}>
                      {fmtTime(s.slotStart)}
                      <span className="sr-only"> {s.slotState.toLowerCase()}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          )}
          {resource && (
            <Panel title="Week view">
              <WeekCalendar key={resource.resourceId} resource={resource}
                highlight={start < end ? { day: date, start: Number(start.slice(0, 2)) + Number(start.slice(3)) / 60, end: Number(end.slice(0, 2)) + Number(end.slice(3)) / 60 } : null}
                onPick={(d, h) => { setDate(d); setStart(hoursLabel(h)); setEnd(hoursLabel(Math.min(h + 1, resource.closesAtHour))); }} />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
