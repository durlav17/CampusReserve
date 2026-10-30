import { useState } from 'react';
import { Link } from 'react-router-dom';
import { History } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api } from '../services/api';
import type { AuditEntry, Paged } from '../services/types';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Pager, StatusBadge, cx } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const TABLES = [
  { v: '', l: 'Everything' }, { v: 'BOOKINGS', l: 'Bookings' },
  { v: 'MAINTENANCE_REQUESTS', l: 'Maintenance' }, { v: 'RESOURCES', l: 'Resources' },
];
const LIMIT = 25;
const recordLink = (a: AuditEntry) =>
  a.tableName === 'BOOKINGS' ? `/bookings/${a.recordId}` : a.tableName === 'RESOURCES' ? `/resources/${a.recordId}` : '/maintenance';

export default function AuditPage() {
  const [table, setTable] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useApi(() => api<Paged<AuditEntry>>('/audit', { query: { table, limit: LIMIT, offset } }), [table, offset]);

  return (
    <>
      <PageHeader title="Audit history" subtitle="Append-only log written by database triggers. It cannot be edited or deleted, even by administrators." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABLES.map((t) => (
          <button key={t.v || 'all'} onClick={() => { setTable(t.v); setOffset(0); }} aria-pressed={table === t.v}
            className={cx('rounded-full px-3 py-1 text-sm font-medium ring-1', table === t.v ? 'bg-lagoon text-white ring-lagoon' : 'bg-white/70 text-ink-soft ring-line')}>{t.l}</button>
        ))}
      </div>
      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? <LoadingBlock rows={10} /> : !list.data?.items.length ? (
        <div className="glass"><EmptyState icon={<History className="size-6" />} title="No changes recorded yet" /></div>
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-line"><tr>
              <th className="table-head">When</th><th className="table-head">Record</th><th className="table-head">Change</th>
              <th className="table-head">Status</th><th className="table-head">By</th><th className="table-head">Details</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {list.data.items.map((a) => (
                <tr key={a.auditId}>
                  <td className="table-cell whitespace-nowrap tabular-nums">{fmtDateTime(a.changedAt)}</td>
                  <td className="table-cell"><Link className="font-medium hover:text-lagoon-deep" to={recordLink(a)}>
                    {a.tableName === 'BOOKINGS' ? 'Booking' : a.tableName === 'RESOURCES' ? 'Resource' : 'Ticket'} #{a.recordId}</Link></td>
                  <td className="table-cell"><StatusBadge value={a.action} /></td>
                  <td className="table-cell whitespace-nowrap">{a.oldStatus && <><StatusBadge value={a.oldStatus} /> <span className="text-ink-faint">to</span> </>}<StatusBadge value={a.newStatus} /></td>
                  <td className="table-cell">{a.changedByName ?? 'System'}</td>
                  <td className="table-cell max-w-xs text-ink-soft">{a.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </div>
      )}
    </>
  );
}
