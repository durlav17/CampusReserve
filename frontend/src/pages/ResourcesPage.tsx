import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, MapPin, SearchX, Users, Wrench } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useDebounced } from '../hooks/useDebounced';
import { api } from '../services/api';
import type { Building, Category, Resource } from '../services/types';
import { EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '../components/ui';
import { hoursLabel } from '../lib/format';

export default function ResourcesPage() {
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [minCapacity, setMinCapacity] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const dq = useDebounced(q, 300);

  const cats = useApi(() => api<{ items: Category[] }>('/categories').then((r) => r.items), []);
  const blds = useApi(() => api<{ items: Building[] }>('/buildings').then((r) => r.items), []);
  const list = useApi(() => api<{ items: Resource[] }>('/resources', {
    query: { q: dq, categoryId, buildingId, minCapacity, status: onlyAvailable ? 'AVAILABLE' : undefined },
  }).then((r) => r.items), [dq, categoryId, buildingId, minCapacity, onlyAvailable]);

  return (
    <>
      <PageHeader title="Find a space" subtitle="Labs, seminar halls, classrooms, auditoriums and portable equipment." />

      <div className="glass mb-5 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_0.8fr_auto]">
        <label className="sr-only" htmlFor="rq">Search</label>
        <input id="rq" className="field" placeholder="Search by name, code or description" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr-only" htmlFor="rc">Category</label>
        <select id="rc" className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {cats.data?.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}
        </select>
        <label className="sr-only" htmlFor="rb">Building</label>
        <select id="rb" className="field" value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
          <option value="">All buildings</option>
          {blds.data?.map((b) => <option key={b.buildingId} value={b.buildingId}>{b.buildingName}</option>)}
        </select>
        <label className="sr-only" htmlFor="rm">Minimum seats</label>
        <input id="rm" className="field" type="number" min={0} placeholder="Min. seats" value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)} />
        <label className="flex items-center gap-2 text-sm font-medium text-ink-soft">
          <input type="checkbox" className="size-4 accent-[var(--color-lagoon)]" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
          Bookable only
        </label>
      </div>

      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-44 rounded-[var(--radius-panel)]" />)}</div>
      ) : !list.data?.length ? (
        <div className="glass"><EmptyState icon={<SearchX className="size-6" />} title="No resources match">Try a different search or clear a filter.</EmptyState></div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((r) => (
            <li key={r.resourceId}>
              <Link to={`/resources/${r.resourceId}`} className="glass group flex h-full flex-col p-5 transition-shadow hover:shadow-[0_18px_40px_-20px_rgb(23_32_51/0.45)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink-faint">{r.categoryName}</p>
                    <h2 className="truncate text-lg font-bold group-hover:text-lagoon-deep">{r.resourceName}</h2>
                  </div>
                  <StatusBadge value={r.status} />
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{r.description}</p>
                <dl className="mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5 pt-4 text-sm text-ink-soft">
                  <div className="flex items-center gap-1.5"><MapPin className="size-4" aria-hidden /><dt className="sr-only">Location</dt>
                    <dd className="truncate">{r.buildingCode ? `${r.buildingCode} ${r.roomNo ?? ''}` : 'Portable'}</dd></div>
                  <div className="flex items-center gap-1.5"><Users className="size-4" aria-hidden /><dt className="sr-only">Capacity</dt>
                    <dd>{r.capacity > 0 ? `${r.capacity} seats` : 'Equipment'}</dd></div>
                  <div className="flex items-center gap-1.5"><Building2 className="size-4" aria-hidden /><dt className="sr-only">Hours</dt>
                    <dd>{hoursLabel(r.opensAtHour)}–{hoursLabel(r.closesAtHour)}</dd></div>
                  {r.openMaintenance > 0 && <div className="flex items-center gap-1.5 text-fix"><Wrench className="size-4" aria-hidden /><dt className="sr-only">Maintenance</dt>
                    <dd>{r.openMaintenance} open ticket{r.openMaintenance > 1 ? 's' : ''}</dd></div>}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
