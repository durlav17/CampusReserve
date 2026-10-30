import { useState } from 'react';
import { Users } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { api, ApiError } from '../services/api';
import type { Department, RoleCode, User } from '../services/types';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Pager, cx, useToast } from '../components/ui';
import { fmtDate } from '../lib/format';

const ROLES: { id: number; code: RoleCode; name: string }[] = [
  { id: 1, code: 'STUDENT', name: 'Student' }, { id: 2, code: 'FACULTY', name: 'Faculty' },
  { id: 3, code: 'COORDINATOR', name: 'Coordinator' }, { id: 4, code: 'ADMIN', name: 'Administrator' },
];
const LIMIT = 20;

export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [role, setRole] = useState<RoleCode | ''>('');
  const [offset, setOffset] = useState(0);
  const list = useApi(() => api<{ total: number; items: User[] }>('/users', { query: { q: dq, role, limit: LIMIT, offset } }), [dq, role, offset]);
  const depts = useApi(() => api<{ items: Department[] }>('/departments').then((r) => r.items), []);

  const patch = async (u: User, body: Record<string, unknown>, msg: string) => {
    try {
      await api(`/users/${u.userId}`, { method: 'PATCH', body });
      toast('ok', msg);
      void list.reload();
    } catch (e) { toast('bad', (e as ApiError).message); }
  };

  return (
    <>
      <PageHeader title="Users" subtitle="Grant staff roles, move people between departments and disable accounts." />
      <div className="glass mb-4 flex flex-wrap gap-3 p-3">
        <label className="sr-only" htmlFor="uq">Search users</label>
        <input id="uq" className="field max-w-sm" placeholder="Search name, e-mail or registration no." value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        <label className="sr-only" htmlFor="ur">Role</label>
        <select id="ur" className="field max-w-48" value={role} onChange={(e) => { setRole(e.target.value as RoleCode | ''); setOffset(0); }}>
          <option value="">All roles</option>{ROLES.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
      </div>
      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? <LoadingBlock rows={8} /> : !list.data?.items.length ? (
        <div className="glass"><EmptyState icon={<Users className="size-6" />} title="No users found">Try another search.</EmptyState></div>
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-line"><tr>
              <th className="table-head">Person</th><th className="table-head">Role</th><th className="table-head">Department</th>
              <th className="table-head text-right">Bookings</th><th className="table-head">Last sign-in</th><th className="table-head">Account</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {list.data.items.map((u) => {
                const self = u.userId === me?.userId;
                return (
                  <tr key={u.userId} className={cx(u.isActive === 'N' && 'opacity-60')}>
                    <td className="table-cell"><span className="font-semibold">{u.fullName}</span><span className="block text-xs text-ink-faint">{u.email}{u.regNo ? `, ${u.regNo}` : ''}</span></td>
                    <td className="table-cell">
                      <label className="sr-only" htmlFor={`role-${u.userId}`}>Role for {u.fullName}</label>
                      <select id={`role-${u.userId}`} className="field py-1.5" value={u.role.id} disabled={self}
                        onChange={(e) => patch(u, { roleId: Number(e.target.value) }, `${u.fullName} is now ${ROLES.find((r) => r.id === Number(e.target.value))?.name}`)}>
                        {ROLES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td className="table-cell">
                      <label className="sr-only" htmlFor={`dept-${u.userId}`}>Department for {u.fullName}</label>
                      <select id={`dept-${u.userId}`} className="field py-1.5" value={u.department.id} disabled={self}
                        onChange={(e) => patch(u, { deptId: Number(e.target.value) }, 'Department updated')}>
                        {depts.data?.map((d) => <option key={d.deptId} value={d.deptId}>{d.deptCode}</option>)}
                      </select>
                    </td>
                    <td className="table-cell text-right tabular-nums">{u.bookingCount}</td>
                    <td className="table-cell">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'Never'}</td>
                    <td className="table-cell">
                      <button disabled={self} onClick={() => patch(u, { isActive: u.isActive === 'Y' ? 'N' : 'Y' }, u.isActive === 'Y' ? 'Account disabled' : 'Account enabled')}
                        className={cx('rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50', u.isActive === 'Y' ? 'bg-ok-wash text-ok' : 'bg-bad-wash text-bad')}>
                        {u.isActive === 'Y' ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </div>
      )}
    </>
  );
}
