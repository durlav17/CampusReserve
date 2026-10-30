import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, CircleDot, X } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../services/api';
import type { Booking } from '../services/types';
import { Button, ErrorState, Field, LoadingBlock, Modal, PageHeader, Panel, StatusBadge, cx, useToast } from '../components/ui';
import { fmtDateTime, fmtRange } from '../lib/format';

type Dialog = 'approve' | 'reject' | 'cancel' | null;

export default function BookingDetailPage() {
  const { id } = useParams();
  const { user, hasRole } = useAuth();
  const toast = useToast();
  const b = useApi(() => api<{ booking: Booking }>(`/bookings/${id}`).then((r) => r.booking), [id]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  if (b.loading) return <LoadingBlock rows={6} />;
  if (b.error || !b.data) return <ErrorState error={b.error} onRetry={b.reload} />;
  const bk = b.data;

  const isOwner = user?.userId === bk.requesterId;
  const isApprover = hasRole('COORDINATOR', 'ADMIN');
  const live = bk.status === 'PENDING' || bk.status === 'APPROVED';
  const notEnded = new Date(bk.endTime) > new Date();

  const act = async () => {
    setPending(true);
    setActionError(null);
    try {
      const path = { approve: 'approve', reject: 'reject', cancel: 'cancel' }[dialog!];
      const body = dialog === 'cancel' ? { reason: text || undefined } : { remarks: text || undefined };
      const res = await api<{ booking: Booking }>(`/bookings/${bk.bookingId}/${path}`, { method: 'POST', body });
      b.setData({ ...res.booking });
      toast('ok', { approve: 'Booking approved', reject: 'Booking rejected', cancel: 'Booking cancelled' }[dialog!]);
      setDialog(null);
      setText('');
    } catch (e) {
      setActionError(e as ApiError);
    } finally {
      setPending(false);
    }
  };

  const steps = [
    { label: 'Requested', at: bk.createdAt, done: true },
    { label: bk.requiresApproval === 'Y' ? (bk.decision === 'REJECTED' ? 'Rejected' : 'Approved') : 'Confirmed',
      at: bk.decidedAt ?? (bk.requiresApproval === 'N' ? bk.createdAt : null), done: bk.status !== 'PENDING' && bk.decision !== null || bk.requiresApproval === 'N', bad: bk.decision === 'REJECTED' },
    ...(bk.status === 'CANCELLED' ? [{ label: 'Cancelled', at: bk.cancelledAt, done: true, bad: true }] : []),
  ];

  return (
    <>
      <Link to="/bookings" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Bookings
      </Link>
      <PageHeader
        title={bk.title}
        subtitle={<>Booking #{bk.bookingId} for <Link className="font-medium text-lagoon hover:underline" to={`/resources/${bk.resourceId}`}>{bk.resourceName}</Link></>}
        actions={<>
          {isApprover && bk.status === 'PENDING' && <>
            <Button onClick={() => setDialog('approve')} icon={<Check className="size-4" />}>Approve</Button>
            <Button variant="secondary" onClick={() => setDialog('reject')} icon={<X className="size-4" />}>Reject</Button>
          </>}
          {(isOwner || isApprover) && live && notEnded && <Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel booking</Button>}
        </>}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_22rem]">
        <Panel title="Details">
          <div className="mb-4"><StatusBadge value={bk.status} /></div>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {[
              ['When', fmtRange(bk.startTime, bk.endTime)],
              ['Duration', `${bk.durationHours} hours`],
              ['Resource', `${bk.resourceName} (${bk.resourceCode})`],
              ['Location', bk.buildingName ?? 'Portable equipment'],
              ['Attendees', `${bk.attendees}${bk.capacity > 0 ? ` of ${bk.capacity} seats` : ''}`],
              ['Requested by', `${bk.requesterName}, ${bk.requesterDeptCode}`],
              ['Purpose', bk.purpose || 'Not given'],
              ...(bk.decisionRemarks ? [['Decision note', `${bk.decisionRemarks}${bk.approverName ? ` (${bk.approverName})` : ''}`]] : []),
              ...(bk.cancelReason ? [['Cancellation reason', bk.cancelReason]] : []),
            ].map(([k, v]) => (
              <div key={k}><dt className="text-sm text-ink-faint">{k}</dt><dd className="font-medium">{v}</dd></div>
            ))}
          </dl>
        </Panel>

        <div className="space-y-5">
          <Panel title="Progress">
            <ol className="space-y-4">
              {steps.map((s) => (
                <li key={s.label} className="flex gap-3">
                  <span className={cx('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
                    !s.done ? 'bg-ink/5 text-ink-faint' : s.bad ? 'bg-bad-wash text-bad' : 'bg-ok-wash text-ok')}>
                    {s.done ? (s.bad ? <X className="size-3.5" /> : <Check className="size-3.5" />) : <CircleDot className="size-3.5" />}
                  </span>
                  <div><p className="font-semibold">{s.done ? s.label : 'Awaiting decision'}</p>
                    {s.at && s.done && <p className="text-sm text-ink-faint">{fmtDateTime(s.at)}</p>}</div>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Change history">
            <p className="mb-3 text-sm text-ink-faint">Recorded automatically by database triggers.</p>
            <ul className="space-y-3 text-sm">
              {bk.history?.map((h) => (
                <li key={h.auditId} className="border-l-2 border-lagoon/30 pl-3">
                  <p className="font-medium">{h.oldStatus ? `${h.oldStatus.toLowerCase()} to ${h.newStatus?.toLowerCase()}` : `created as ${h.newStatus?.toLowerCase()}`}</p>
                  <p className="text-ink-faint">{fmtDateTime(h.changedAt)}{h.changedByName ? `, by ${h.changedByName}` : ''}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <Modal open={dialog !== null} onClose={() => { setDialog(null); setActionError(null); }}
        title={dialog === 'approve' ? 'Approve this booking?' : dialog === 'reject' ? 'Reject this booking' : 'Cancel this booking?'}
        footer={<>
          <Button variant="secondary" onClick={() => setDialog(null)}>Keep as is</Button>
          <Button variant={dialog === 'approve' ? 'primary' : 'danger'} loading={pending} onClick={act}
            disabled={dialog === 'reject' && text.trim().length < 3}>
            {dialog === 'approve' ? 'Approve' : dialog === 'reject' ? 'Reject' : 'Cancel booking'}
          </Button>
        </>}>
        <p className="mb-3 text-ink-soft">{bk.resourceName}, {fmtRange(bk.startTime, bk.endTime)}.</p>
        <Field label={dialog === 'reject' ? 'Reason (shared with the requester)' : dialog === 'cancel' ? 'Reason (optional)' : 'Note (optional)'}>
          {(fid) => <textarea id={fid} rows={3} className="field" value={text} onChange={(e) => setText(e.target.value)} maxLength={400} />}
        </Field>
        {actionError && <div className="mt-3"><ErrorState error={actionError} /></div>}
      </Modal>
    </>
  );
}
