import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ClipboardCheck, Send, X } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../services/api';
import type { Booking } from '../services/types';
import { Button, EmptyState, ErrorState, Field, LoadingBlock, Modal, PageHeader, StatusBadge, useToast } from '../components/ui';
import { fmtRange } from '../lib/format';

export default function ApprovalsPage() {
  const { hasRole } = useAuth();
  const toast = useToast();
  const queue = useApi(() => api<{ items: Booking[] }>('/approvals/pending').then((r) => r.items), []);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<Booking | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | null>(null);

  const decide = async (b: Booking, kind: 'approve' | 'reject', remarks?: string) => {
    setBusyId(b.bookingId);
    setError(null);
    try {
      await api(`/bookings/${b.bookingId}/${kind}`, { method: 'POST', body: { remarks } });
      toast('ok', kind === 'approve' ? `Approved #${b.bookingId}` : `Rejected #${b.bookingId}`);
      setRejecting(null);
      setReason('');
      queue.setData((q) => q?.filter((x) => x.bookingId !== b.bookingId) ?? null);
    } catch (e) {
      setError(e as ApiError);
      toast('bad', (e as ApiError).message);
    } finally {
      setBusyId(null);
    }
  };

  const runJob = async (path: string, done: (r: Record<string, number>) => string) => {
    try {
      const r = await api<Record<string, number>>(path, { method: 'POST' });
      toast('ok', done(r));
      void queue.reload();
    } catch (e) { toast('bad', (e as ApiError).message); }
  };

  return (
    <>
      <PageHeader title="Approvals" subtitle="Requests for resources you are responsible for, earliest first."
        actions={<>
          <Button variant="secondary" icon={<Send className="size-4" />}
            onClick={() => runJob('/approvals/digest', (r) => `Digest sent: ${r.pendingCount} pending`)}>Send me a digest</Button>
          {hasRole('ADMIN') && <Button variant="secondary"
            onClick={() => runJob('/jobs/expire-pending', (r) => `${r.expired} expired request(s) closed`)}>Close expired requests</Button>}
        </>} />

      <ErrorState error={queue.error ?? error} onRetry={queue.reload} />
      {queue.loading ? <LoadingBlock rows={5} /> : !queue.data?.length ? (
        <div className="glass"><EmptyState icon={<ClipboardCheck className="size-6" />} title="Nothing waiting">New requests appear here as soon as they are submitted.</EmptyState></div>
      ) : (
        <ul className="space-y-3">
          {queue.data.map((b) => (
            <li key={b.bookingId} className="glass flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/bookings/${b.bookingId}`} className="font-display text-lg font-bold hover:text-lagoon-deep">{b.title}</Link>
                  <StatusBadge value="PENDING" />
                  {!!b.competingRequests && <span className="rounded-full bg-bad-wash px-2 py-0.5 text-xs font-semibold text-bad">{b.competingRequests} competing</span>}
                </div>
                <p className="text-sm text-ink-soft">{b.resourceName}, {fmtRange(b.startTime, b.endTime)}</p>
                <p className="text-sm text-ink-faint">{b.requesterName} ({b.requesterRole.toLowerCase()}, {b.requesterDeptCode}), {b.attendees} attending, waiting {b.hoursWaiting} h</p>
              </div>
              <div className="flex gap-2">
                <Button loading={busyId === b.bookingId} onClick={() => decide(b, 'approve')} icon={<Check className="size-4" />}>Approve</Button>
                <Button variant="secondary" onClick={() => setRejecting(b)} icon={<X className="size-4" />}>Reject</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject request"
        footer={<>
          <Button variant="secondary" onClick={() => setRejecting(null)}>Keep pending</Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={busyId === rejecting?.bookingId}
            onClick={() => rejecting && decide(rejecting, 'reject', reason)}>Reject</Button>
        </>}>
        <p className="mb-3 text-ink-soft">{rejecting?.title}, {rejecting && fmtRange(rejecting.startTime, rejecting.endTime)}</p>
        <Field label="Reason (shared with the requester)">
          {(id) => <textarea id={id} rows={3} className="field" value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </Modal>
    </>
  );
}
