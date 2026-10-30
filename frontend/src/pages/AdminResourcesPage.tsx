import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Pencil, Plus } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api, ApiError } from '../services/api';
import type { Building, Category, Department, Resource } from '../services/types';
import { Button, ErrorState, Field, LoadingBlock, Modal, PageHeader, StatusBadge, useToast } from '../components/ui';
import { campusIso, hoursLabel, isoDay } from '../lib/format';

const empty = { resourceCode: '', resourceName: '', categoryId: '', buildingId: '', managedByDept: '', floorNo: '', roomNo: '', capacity: '0', opensAtHour: '8', closesAtHour: '20', description: '', status: 'AVAILABLE' };

export default function AdminResourcesPage() {
  const toast = useToast();
  const list = useApi(() => api<{ items: Resource[] }>('/resources').then((r) => r.items), []);
  const cats = useApi(() => api<{ items: Category[] }>('/categories').then((r) => r.items), []);
  const blds = useApi(() => api<{ items: Building[] }>('/buildings').then((r) => r.items), []);
  const depts = useApi(() => api<{ items: Department[] }>('/departments').then((r) => r.items), []);

  const [editing, setEditing] = useState<Resource | 'new' | null>(null);
  const [form, setForm] = useState(empty);
  const [blackoutFor, setBlackoutFor] = useState<Resource | null>(null);
  const [bo, setBo] = useState({ date: isoDay(new Date()), from: '8', to: '20', blackoutType: 'EXAM', reason: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fe = error?.fieldErrors() ?? {};

  const open = (r: Resource | 'new') => {
    setError(null);
    setEditing(r);
    setForm(r === 'new' ? empty : {
      resourceCode: r.resourceCode, resourceName: r.resourceName, categoryId: String(r.categoryId), buildingId: r.buildingId ? String(r.buildingId) : '',
      managedByDept: String(r.deptId), floorNo: r.floorNo?.toString() ?? '', roomNo: r.roomNo ?? '', capacity: String(r.capacity),
      opensAtHour: String(r.opensAtHour), closesAtHour: String(r.closesAtHour), description: r.description ?? '', status: r.status,
    });
  };

  const save = async () => {
    setPending(true); setError(null);
    const common = {
      resourceName: form.resourceName, capacity: Number(form.capacity), opensAtHour: Number(form.opensAtHour), closesAtHour: Number(form.closesAtHour),
      description: form.description || undefined, buildingId: form.buildingId ? Number(form.buildingId) : null,
      floorNo: form.floorNo ? Number(form.floorNo) : null, roomNo: form.roomNo || null,
    };
    try {
      if (editing === 'new') {
        await api('/resources', { method: 'POST', body: { ...common, resourceCode: form.resourceCode, categoryId: Number(form.categoryId), managedByDept: Number(form.managedByDept) } });
        toast('ok', 'Resource added');
      } else if (editing) {
        const status = form.status === 'MAINTENANCE' ? undefined : form.status;
        await api(`/resources/${editing.resourceId}`, { method: 'PATCH', body: { ...common, status } });
        toast('ok', 'Resource saved');
      }
      setEditing(null);
      void list.reload();
    } catch (e) { setError(e as ApiError); } finally { setPending(false); }
  };

  const saveBlackout = async () => {
    if (!blackoutFor) return;
    setPending(true); setError(null);
    try {
      const r = await api<{ affectedBookings: number }>(`/resources/${blackoutFor.resourceId}/blackouts`, {
        method: 'POST',
        body: { start: campusIso(bo.date, Number(bo.from)), end: campusIso(bo.date, Number(bo.to)), blackoutType: bo.blackoutType, reason: bo.reason },
      });
      toast('ok', r.affectedBookings ? `Blackout added; ${r.affectedBookings} existing booking(s) overlap and should be reviewed` : 'Blackout added');
      setBlackoutFor(null);
    } catch (e) { setError(e as ApiError); } finally { setPending(false); }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Resource administration" subtitle="Add resources, adjust rules and schedule blackout periods."
        actions={<Button onClick={() => open('new')} icon={<Plus className="size-4" />}>Add resource</Button>} />
      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? <LoadingBlock rows={8} /> : (
        <div className="glass overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-line"><tr>
              <th className="table-head">Resource</th><th className="table-head">Category</th><th className="table-head">Location</th>
              <th className="table-head text-right">Capacity</th><th className="table-head">Hours</th><th className="table-head">Status</th><th className="table-head"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {list.data?.map((r) => (
                <tr key={r.resourceId} className="hover:bg-white/50">
                  <td className="table-cell"><Link to={`/resources/${r.resourceId}`} className="font-semibold hover:text-lagoon-deep">{r.resourceName}</Link>
                    <span className="block text-xs text-ink-faint">{r.resourceCode}, {r.managedByDeptCode}</span></td>
                  <td className="table-cell">{r.categoryName}</td>
                  <td className="table-cell">{r.buildingCode ? `${r.buildingCode} ${r.roomNo ?? ''}` : 'Portable'}</td>
                  <td className="table-cell text-right tabular-nums">{r.capacity || 'n/a'}</td>
                  <td className="table-cell tabular-nums">{hoursLabel(r.opensAtHour)}–{hoursLabel(r.closesAtHour)}</td>
                  <td className="table-cell"><StatusBadge value={r.status} /></td>
                  <td className="table-cell">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => open(r)} aria-label={`Edit ${r.resourceName}`} icon={<Pencil className="size-4" />} />
                      <Button variant="ghost" onClick={() => { setError(null); setBlackoutFor(r); }} aria-label={`Add blackout for ${r.resourceName}`} icon={<Ban className="size-4" />} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add resource' : 'Edit resource'}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Discard</Button><Button loading={pending} onClick={save}>Save resource</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          {editing === 'new' && <Field label="Code" error={fe.resourceCode} hint="e.g. SJT-LAB-610">{(id) => <input id={id} className="field" value={form.resourceCode} onChange={set('resourceCode')} />}</Field>}
          <Field label="Name" error={fe.resourceName}>{(id) => <input id={id} className="field" value={form.resourceName} onChange={set('resourceName')} />}</Field>
          {editing === 'new' && <>
            <Field label="Category" error={fe.categoryId}>{(id) => <select id={id} className="field" value={form.categoryId} onChange={set('categoryId')}>
              <option value="">Choose</option>{cats.data?.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}</select>}</Field>
            <Field label="Managed by" error={fe.managedByDept}>{(id) => <select id={id} className="field" value={form.managedByDept} onChange={set('managedByDept')}>
              <option value="">Choose</option>{depts.data?.map((d) => <option key={d.deptId} value={d.deptId}>{d.deptCode}</option>)}</select>}</Field>
          </>}
          <Field label="Building">{(id) => <select id={id} className="field" value={form.buildingId} onChange={set('buildingId')}>
            <option value="">Portable / none</option>{blds.data?.map((b) => <option key={b.buildingId} value={b.buildingId}>{b.buildingName}</option>)}</select>}</Field>
          <Field label="Room">{(id) => <input id={id} className="field" value={form.roomNo} onChange={set('roomNo')} />}</Field>
          <Field label="Floor">{(id) => <input id={id} type="number" min={0} className="field" value={form.floorNo} onChange={set('floorNo')} />}</Field>
          <Field label="Capacity (0 for equipment)" error={fe.capacity}>{(id) => <input id={id} type="number" min={0} className="field" value={form.capacity} onChange={set('capacity')} />}</Field>
          <Field label="Opens at (hour)" error={fe.opensAtHour}>{(id) => <input id={id} type="number" min={0} max={23} className="field" value={form.opensAtHour} onChange={set('opensAtHour')} />}</Field>
          <Field label="Closes at (hour)" error={fe.closesAtHour}>{(id) => <input id={id} type="number" min={1} max={24} className="field" value={form.closesAtHour} onChange={set('closesAtHour')} />}</Field>
          {editing !== 'new' && form.status !== 'MAINTENANCE' && (
            <Field label="Status" hint="Maintenance status is controlled by maintenance tickets.">{(id) => <select id={id} className="field" value={form.status} onChange={set('status')}>
              <option value="AVAILABLE">Available</option><option value="RETIRED">Retired</option></select>}</Field>
          )}
          <div className="sm:col-span-2"><Field label="Description">{(id) => <textarea id={id} rows={2} className="field" value={form.description} onChange={set('description')} />}</Field></div>
        </div>
        {error && !Object.keys(fe).length && <div className="mt-3"><ErrorState error={error} /></div>}
      </Modal>

      <Modal open={!!blackoutFor} onClose={() => setBlackoutFor(null)} title={`Block out ${blackoutFor?.resourceName ?? ''}`}
        footer={<><Button variant="secondary" onClick={() => setBlackoutFor(null)}>Discard</Button>
          <Button loading={pending} disabled={bo.reason.trim().length < 3 || Number(bo.to) <= Number(bo.from)} onClick={saveBlackout}>Add blackout</Button></>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date">{(id) => <input id={id} type="date" className="field" value={bo.date} onChange={(e) => setBo({ ...bo, date: e.target.value })} />}</Field>
          <Field label="From hour">{(id) => <input id={id} type="number" min={0} max={23} className="field" value={bo.from} onChange={(e) => setBo({ ...bo, from: e.target.value })} />}</Field>
          <Field label="To hour">{(id) => <input id={id} type="number" min={1} max={24} className="field" value={bo.to} onChange={(e) => setBo({ ...bo, to: e.target.value })} />}</Field>
          <Field label="Type">{(id) => <select id={id} className="field" value={bo.blackoutType} onChange={(e) => setBo({ ...bo, blackoutType: e.target.value })}>
            {['EXAM', 'HOLIDAY', 'EVENT', 'MAINTENANCE'].map((t) => <option key={t} value={t}>{t[0] + t.slice(1).toLowerCase()}</option>)}</select>}</Field>
          <div className="sm:col-span-2"><Field label="Reason">{(id) => <input id={id} className="field" value={bo.reason} onChange={(e) => setBo({ ...bo, reason: e.target.value })} />}</Field></div>
        </div>
        {error && <div className="mt-3"><ErrorState error={error} /></div>}
      </Modal>
    </>
  );
}
