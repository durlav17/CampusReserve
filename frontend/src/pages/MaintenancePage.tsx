import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Wrench } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../services/api';
import type { Maintenance, MaintStatus, Paged, Priority, Resource } from '../services/types';
import { Button, EmptyState, ErrorState, Field, LoadingBlock, Modal, PageHeader, StatusBadge, cx, useToast } from '../components/ui';
import { fmtDate } from '../lib/format';

const NEXT: Record<MaintStatus, MaintStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};
const COLUMNS: { key: MaintStatus; label: string }[] = [
  { key: 'OPEN', label: 'Open' }, { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'RESOLVED', label: 'Resolved' }, { key: 'CLOSED', label: 'Closed' },
];

export default function MaintenancePage() {
  const { hasRole } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const isStaff = hasRole('FACULTY', 'COORDINATOR', 'ADMIN');
  const canManage = hasRole('COORDINATOR', 'ADMIN');
  const [priority, setPriority] = useState<Priority | ''>('');

  const list = useApi(() => api<Paged<Maintenance>>('/maintenance', { query: { priority, limit: 100 } }), [priority]);
  const resources = useApi(() => api<{ items: Resource[] }>('/resources').then((r) => r.items), []);
  const assignees = useApi(() => (isStaff
    ? api<{ items: { userId: number; fullName: string }[] }>('/maintenance/assignees').then((r) => r.items)
    : Promise.resolve([])), [isStaff]);

  const [creating, setCreating] = useState(!!params.get('resource'));
  const [form, setForm] = useState({ resourceId: params.get('resource') ?? '', title: '', description: '', priority: 'MEDIUM' as Priority, blocksBooking: false });
  const [editing, setEditing] = useState<Maintenance | null>(null);
  const [update, setUpdate] = useState({ status: '' as MaintStatus | '', assignedTo: '', notes: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (e?: FormEvent | { preventDefault(): void }) => {
    e?.preventDefault();
    setPending(true); setError(null);
    try {
      await api('/maintenance', { method: 'POST', body: { ...form, resourceId: Number(form.resourceId), description: form.description || undefined } });
      toast('ok', form.blocksBooking ? 'Ticket logged and resource taken out of service' : 'Ticket logged');
      setCreating(false);
      setForm({ resourceId: '', title: '', description: '', priority: 'MEDIUM', blocksBooking: false });
      void list.reload();
    } catch (err) { setError(err as ApiError); } finally { setPending(false); }
  };

  const saveUpdate = async () => {
    if (!editing || !update.status) return;
    setPending(true); setError(null);
    try {
      await api(`/maintenance/${editing.requestId}/status`, {
        method: 'PATCH',
        body: { status: update.status, assignedTo: update.assignedTo ? Number(update.assignedTo) : undefined, notes: update.notes || undefined },
      });
      toast('ok', `Ticket #${editing.requestId} updated`);
      setEditing(null);
      void list.reload();
    } catch (err) { setError(err as ApiError); } finally { setPending(false); }
  };

  const fe = error?.fieldErrors() ?? {};
  const items = list.data?.items ?? [];

  return (
    <>
      <PageHeader title="Maintenance" subtitle={isStaff ? 'Faults reported across campus. Blocking tickets take a resource out of service until resolved.' : 'Faults you have reported.'}
        actions={<Button onClick={() => { setError(null); setCreating(true); }} icon={<Plus className="size-4" />}>Report a fault</Button>} />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => (
          <button key={p || 'all'} onClick={() => setPriority(p)} aria-pressed={priority === p}
            className={cx('rounded-full px-3 py-1 text-sm font-medium ring-1', priority === p ? 'bg-lagoon text-white ring-lagoon' : 'bg-white/70 text-ink-soft ring-line')}>
            {p ? p[0] + p.slice(1).toLowerCase() : 'Any priority'}
          </button>
        ))}
      </div>

      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? <LoadingBlock rows={6} /> : !items.length ? (
        <div className="glass"><EmptyState icon={<Wrench className="size-6" />} title="No tickets">Report a fault to start tracking it.</EmptyState></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const colItems = items.filter((m) => m.status === col.key);
            return (
              <section key={col.key} className="glass p-3" aria-label={col.label}>
                <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-bold">{col.label}<span className="text-ink-faint">{colItems.length}</span></h2>
                <ul className="space-y-2">
                  {colItems.map((m) => (
                    <li key={m.requestId} className="rounded-xl bg-white/75 p-3 ring-1 ring-line">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{m.title}</p><StatusBadge value={m.priority} />
                      </div>
                      <p className="mt-0.5 text-sm text-ink-soft">{m.resourceName}</p>
                      {m.blocksBooking === 'Y' && <p className="mt-1 text-xs font-semibold text-fix">Blocks bookings</p>}
                      <p className="mt-1 text-xs text-ink-faint">#{m.requestId}, {fmtDate(m.createdAt)}, {m.ageDays} d old{m.assigneeName ? `, ${m.assigneeName}` : ''}</p>
                      {m.resolutionNotes && <p className="mt-1 text-xs text-ink-soft">{m.resolutionNotes}</p>}
                      {canManage && NEXT[m.status].length > 0 && (
                        <Button variant="secondary" className="mt-2 w-full py-1.5" onClick={() => {
                          setError(null); setEditing(m);
                          setUpdate({ status: NEXT[m.status][0], assignedTo: m.assigneeId ? String(m.assigneeId) : '', notes: '' });
                        }}>Update</Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Report a fault"
        footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Discard</Button>
          <Button loading={pending} onClick={() => submit()} disabled={!form.resourceId || form.title.trim().length < 3}>Log ticket</Button></>}>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Resource" error={fe.resourceId}>
            {(id) => <select id={id} className="field" value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
              <option value="">Choose a resource</option>
              {resources.data?.map((r) => <option key={r.resourceId} value={r.resourceId}>{r.resourceName} ({r.resourceCode})</option>)}
            </select>}
          </Field>
          <Field label="What is wrong?" error={fe.title}>
            {(id) => <input id={id} className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={150} />}
          </Field>
          <Field label="Details (optional)">
            {(id) => <textarea id={id} rows={3} className="field" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
          </Field>
          <Field label="Priority">
            {(id) => <select id={id} className="field" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => <option key={p} value={p}>{p[0] + p.slice(1).toLowerCase()}</option>)}
            </select>}
          </Field>
          {isStaff && (
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-fix)]" checked={form.blocksBooking} onChange={(e) => setForm({ ...form, blocksBooking: e.target.checked })} />
              <span><span className="font-semibold">Take the resource out of service</span><span className="block text-ink-faint">New bookings are refused and holders of upcoming bookings are notified.</span></span>
            </label>
          )}
          {error && !Object.keys(fe).length && <ErrorState error={error} />}
        </form>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Update ticket #${editing?.requestId ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Close</Button><Button loading={pending} onClick={saveUpdate}>Save update</Button></>}>
        <div className="space-y-4">
          <p className="text-ink-soft">{editing?.title}, {editing?.resourceName}</p>
          <Field label="New status">
            {(id) => <select id={id} className="field" value={update.status} onChange={(e) => setUpdate({ ...update, status: e.target.value as MaintStatus })}>
              {editing && NEXT[editing.status].map((s) => <option key={s} value={s}>{COLUMNS.find((c) => c.key === s)?.label}</option>)}
            </select>}
          </Field>
          <Field label="Assigned to">
            {(id) => <select id={id} className="field" value={update.assignedTo} onChange={(e) => setUpdate({ ...update, assignedTo: e.target.value })}>
              <option value="">Unassigned</option>
              {assignees.data?.map((a) => <option key={a.userId} value={a.userId}>{a.fullName}</option>)}
            </select>}
          </Field>
          <Field label="Resolution notes (optional)">
            {(id) => <textarea id={id} rows={3} className="field" value={update.notes} onChange={(e) => setUpdate({ ...update, notes: e.target.value })} />}
          </Field>
          {error && <ErrorState error={error} />}
        </div>
      </Modal>
    </>
  );
}
