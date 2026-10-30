import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { api } from '../services/api';
import type { Resource } from '../services/types';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Panel } from '../components/ui';
import WeekCalendar from '../components/WeekCalendar';

export default function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const list = useApi(() => api<{ items: Resource[] }>('/resources').then((r) => r.items), []);
  const selectedId = Number(params.get('resource')) || list.data?.find((r) => r.status === 'AVAILABLE')?.resourceId;
  const resource = list.data?.find((r) => r.resourceId === selectedId);

  const grouped = (list.data ?? []).reduce<Record<string, Resource[]>>((acc, r) => {
    (acc[r.categoryName] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <PageHeader title="Availability" subtitle="Pick a resource to see its week. Select a free hour to start a booking." />
      <ErrorState error={list.error} onRetry={list.reload} />
      {list.loading ? <LoadingBlock rows={8} /> : (
        <Panel>
          <div className="mb-4 max-w-md">
            <label className="label" htmlFor="cal-res">Resource</label>
            <select id="cal-res" className="field" value={selectedId ?? ''} onChange={(e) => setParams({ resource: e.target.value })}>
              {Object.entries(grouped).map(([cat, rs]) => (
                <optgroup key={cat} label={cat}>
                  {rs.map((r) => <option key={r.resourceId} value={r.resourceId}>{r.resourceName} ({r.resourceCode}){r.status !== 'AVAILABLE' ? ', unavailable' : ''}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {resource ? (
            <WeekCalendar key={resource.resourceId} resource={resource}
              onPick={(day, hour) => navigate(`/book?resource=${resource.resourceId}&date=${day}&start=${hour}`)} />
          ) : (
            <EmptyState icon={<CalendarDays className="size-6" />} title="Choose a resource">Its bookings and blocked periods will appear here.</EmptyState>
          )}
        </Panel>
      )}
    </>
  );
}
