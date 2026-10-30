import { useState } from 'react';
import { Camera } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../services/api';
import { Button, ErrorState, PageHeader, Panel, Skeleton, cx, useToast } from '../components/ui';
import { addDays, fmtDay, isoDay } from '../lib/format';

type Util = { resourceCode: string; resourceName: string; categoryCode: string; status: string; utilisationPct: number };
type Top = { resourceCode: string; resourceName: string; approvedCount: number; approvedHours: number };
type Dept = { deptCode: string; deptName: string; totalRequests: number; approved: number; approvedHours: number; distinctResources: number };
type Trend = { bookingDay: string; total: number; approved: number; pending: number; rejected: number; cancelled: number };
type Peak = { isoWeekday: number; startHour: number; bookings: number };
type Cat = { categoryName: string; bookings: number; hours: number };

const RANGES = [{ d: 7, l: '7 days' }, { d: 30, l: '30 days' }, { d: 60, l: '60 days' }];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const axis = { fontSize: 11, fill: '#6B7689' };
const tip = { contentStyle: { borderRadius: 12, border: 'none', boxShadow: '0 12px 30px -12px rgb(23 32 51 / .35)' } };

function ChartBox({ loading, error, onRetry, children, label, height = 'h-72' }: {
  loading: boolean; error: ApiError | null; onRetry: () => void; children: React.ReactNode; label: string; height?: string;
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading) return <Skeleton className={height} />;
  return <div className={height} role="img" aria-label={label}>{children}</div>;
}

export default function AnalyticsPage() {
  const { hasRole } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const to = addDays(isoDay(new Date()), 1);
  const from = addDays(to, -days);
  const q = { from, to };

  const util = useApi(() => api<{ items: Util[] }>('/analytics/utilisation', { query: q }).then((r) => r.items), [from, to]);
  const top = useApi(() => api<{ items: Top[] }>('/analytics/top-resources', { query: { ...q, limit: 6 } }).then((r) => r.items), [from, to]);
  const dept = useApi(() => api<{ items: Dept[] }>('/analytics/departments', { query: q }).then((r) => r.items), [from, to]);
  const trend = useApi(() => api<{ items: Trend[] }>('/analytics/trend', { query: { days } }).then((r) => r.items), [days]);
  const peak = useApi(() => api<{ items: Peak[] }>('/analytics/peak-hours', { query: q }).then((r) => r.items), [from, to]);
  const cats = useApi(() => api<{ items: Cat[] }>('/analytics/categories', { query: q }).then((r) => r.items), [from, to]);

  const peakMax = Math.max(1, ...(peak.data?.map((p) => p.bookings) ?? [1]));
  const peakHours = Array.from(new Set(peak.data?.map((p) => p.startHour) ?? [])).sort((a, b) => a - b);
  const cell = (dow: number, h: number) => peak.data?.find((p) => p.isoWeekday === dow && p.startHour === h)?.bookings ?? 0;

  const snapshot = async () => {
    try {
      const r = await api<{ rows: number }>('/analytics/snapshots', { method: 'POST', query: q });
      toast('ok', `Snapshot saved for ${r.rows} resources`);
    } catch (e) { toast('bad', (e as ApiError).message); }
  };

  return (
    <>
      <PageHeader title="Analytics" subtitle={`Computed in Oracle from approved bookings, ${fmtDay(from)} to ${fmtDay(addDays(to, -1))}.`}
        actions={<>
          <div className="flex rounded-xl bg-white/60 p-1 ring-1 ring-line" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <button key={r.d} onClick={() => setDays(r.d)} aria-pressed={days === r.d}
                className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', days === r.d ? 'bg-lagoon text-white' : 'text-ink-soft')}>{r.l}</button>
            ))}
          </div>
          {hasRole('ADMIN') && <Button variant="secondary" onClick={snapshot} icon={<Camera className="size-4" />}>Save snapshot</Button>}
        </>} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel title="Utilisation by resource" className="xl:col-span-2">
          <p className="mb-3 text-sm text-ink-faint">Share of operating hours booked (FN_RESOURCE_UTILISATION).</p>
          <ChartBox loading={util.loading} error={util.error} onRetry={util.reload} height="h-80" label="Bar chart of utilisation percentage per resource">
            <ResponsiveContainer>
              <BarChart data={util.data ?? []} margin={{ left: -12, right: 8, bottom: 40 }}>
                <CartesianGrid stroke="rgb(23 32 51 / 0.06)" vertical={false} />
                <XAxis dataKey="resourceCode" tick={axis} angle={-40} textAnchor="end" interval={0} height={60} />
                <YAxis tick={axis} unit="%" domain={[0, 'auto']} />
                <Tooltip {...tip} formatter={(v) => [`${v}%`, 'Utilisation']} labelFormatter={(l, p) => p?.[0]?.payload?.resourceName ?? l} />
                <Bar dataKey="utilisationPct" radius={[6, 6, 0, 0]}>
                  {(util.data ?? []).map((u) => <Cell key={u.resourceCode} fill={u.status === 'AVAILABLE' ? '#1F7A8C' : '#7C5CC4'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel title="Booking trend">
          <ChartBox loading={trend.loading} error={trend.error} onRetry={trend.reload} label="Line chart of bookings per day by status">
            <ResponsiveContainer>
              <LineChart data={trend.data ?? []} margin={{ left: -18, right: 8 }}>
                <CartesianGrid stroke="rgb(23 32 51 / 0.06)" vertical={false} />
                <XAxis dataKey="bookingDay" tick={axis} tickFormatter={(d) => fmtDay(d).split(', ')[1] ?? d} minTickGap={20} />
                <YAxis tick={axis} allowDecimals={false} />
                <Tooltip {...tip} labelFormatter={(d) => fmtDay(String(d))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="approved" name="Approved" stroke="#1F7A8C" strokeWidth={2} dot={false} />
                <Line dataKey="pending" name="Pending" stroke="#B7791F" strokeWidth={2} dot={false} />
                <Line dataKey="cancelled" name="Cancelled" stroke="#6B7689" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
                <Line dataKey="rejected" name="Rejected" stroke="#C2414B" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel title="Most booked resources">
          <ChartBox loading={top.loading} error={top.error} onRetry={top.reload} label="Horizontal bar chart of most frequently approved resources">
            <ResponsiveContainer>
              <BarChart data={top.data ?? []} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid stroke="rgb(23 32 51 / 0.06)" horizontal={false} />
                <XAxis type="number" tick={axis} allowDecimals={false} />
                <YAxis type="category" dataKey="resourceCode" tick={axis} width={92} />
                <Tooltip {...tip} labelFormatter={(l, p) => p?.[0]?.payload?.resourceName ?? l} />
                <Bar dataKey="approvedCount" name="Approved bookings" fill="#5B5BD6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel title="Usage by department" padded={false}>
          {dept.error ? <div className="p-4"><ErrorState error={dept.error} onRetry={dept.reload} /></div> : dept.loading ? <div className="p-5"><Skeleton className="h-48" /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-line"><tr>
                  <th className="table-head">Department</th><th className="table-head text-right">Requests</th>
                  <th className="table-head text-right">Approved</th><th className="table-head text-right">Hours</th><th className="table-head text-right">Resources</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {dept.data?.map((d) => (
                    <tr key={d.deptCode}>
                      <td className="table-cell"><span className="font-semibold">{d.deptCode}</span><span className="block text-xs text-ink-faint">{d.deptName}</span></td>
                      <td className="table-cell text-right tabular-nums">{d.totalRequests}</td>
                      <td className="table-cell text-right tabular-nums">{d.approved}</td>
                      <td className="table-cell text-right tabular-nums">{d.approvedHours}</td>
                      <td className="table-cell text-right tabular-nums">{d.distinctResources}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Hours by category">
          <ChartBox loading={cats.loading} error={cats.error} onRetry={cats.reload} height="h-64" label="Bar chart of approved hours per resource category">
            <ResponsiveContainer>
              <BarChart data={cats.data ?? []} margin={{ left: -12, right: 8 }}>
                <CartesianGrid stroke="rgb(23 32 51 / 0.06)" vertical={false} />
                <XAxis dataKey="categoryName" tick={axis} interval={0} />
                <YAxis tick={axis} />
                <Tooltip {...tip} />
                <Bar dataKey="hours" name="Approved hours" fill="#1F7A8C" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
        </Panel>

        <Panel title="When resources are busiest" className="xl:col-span-2">
          {peak.error ? <ErrorState error={peak.error} onRetry={peak.reload} /> : peak.loading ? <Skeleton className="h-40" /> : (
            <div className="overflow-x-auto">
              <table className="text-sm" aria-label="Approved bookings by weekday and start hour">
                <thead><tr><th />{peakHours.map((h) => <th key={h} className="px-1 pb-1 text-xs font-medium text-ink-faint">{String(h).padStart(2, '0')}:00</th>)}</tr></thead>
                <tbody>
                  {WEEKDAYS.map((w, i) => (
                    <tr key={w}>
                      <th className="pr-3 text-left text-xs font-medium text-ink-faint">{w}</th>
                      {peakHours.map((h) => {
                        const v = cell(i + 1, h);
                        return <td key={h} className="p-0.5"><div title={`${w} ${h}:00, ${v} bookings`}
                          className="grid h-8 w-14 place-items-center rounded-md text-xs font-semibold tabular-nums"
                          style={{ background: `rgb(31 122 140 / ${0.06 + 0.8 * (v / peakMax)})`, color: v / peakMax > 0.55 ? '#fff' : '#172033' }}>{v || ''}</div></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
