import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CalendarClock, ShieldCheck, Wrench } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../services/api';
import type { Department } from '../services/types';
import { Button, ErrorState, Field, cx } from '../components/ui';

export default function AuthPage() {
  const { user, login, register } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [form, setForm] = useState({ fullName: '', email: '', password: '', deptId: '', regNo: '' });
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (mode === 'register' && !departments.length) {
      api<{ items: Department[] }>('/departments').then((r) => setDepartments(r.items)).catch((e) => setError(e));
    }
  }, [mode, departments.length]);

  if (user) {
    const to = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={to} replace />;
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fieldErrors = error?.fieldErrors() ?? {};

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === 'signin') await login(form.email, form.password);
      else await register({
        fullName: form.fullName, email: form.email, password: form.password,
        deptId: Number(form.deptId), regNo: form.regNo || undefined,
      });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between p-12 lg:flex">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-9" />
          <span className="font-display text-xl font-extrabold">CampusReserve</span>
        </div>
        <div className="max-w-lg">
          <h1 className="text-[2.6rem] leading-[1.08] font-extrabold">
            Labs, halls and equipment, booked without the double-booking.
          </h1>
          <p className="mt-4 text-lg text-ink-soft">
            Every reservation is checked and locked inside the database, so two people can never hold the same room at the same time.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              { icon: CalendarClock, t: 'Live availability', d: 'See free, pending and blocked slots for any resource.' },
              { icon: ShieldCheck, t: 'Approvals and audit', d: 'Coordinators approve requests; every change is logged.' },
              { icon: Wrench, t: 'Maintenance built in', d: 'Report faults and take rooms out of service in one step.' },
            ].map(({ icon: Icon, t, d }) => (
              <li key={t} className="glass flex gap-3 p-4">
                <Icon className="mt-0.5 size-5 shrink-0 text-lagoon" aria-hidden />
                <div><p className="font-semibold">{t}</p><p className="text-sm text-ink-soft">{d}</p></div>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-ink-faint">BCSE302P Database Systems Lab, individual mini project by Durlav Dani (24BCE2361).</p>
      </section>

      <section className="flex items-center justify-center p-4 sm:p-8">
        <div className="glass-strong w-full max-w-md p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="font-display text-lg font-extrabold">CampusReserve</span>
          </div>
          <div role="tablist" aria-label="Account" className="mb-6 grid grid-cols-2 rounded-xl bg-ink/5 p-1">
            {(['signin', 'register'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(null); }}
                className={cx('rounded-lg py-2 text-sm font-semibold transition-colors', mode === m ? 'bg-white text-ink shadow-sm' : 'text-ink-soft')}>
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {mode === 'register' && (
              <Field label="Full name" error={fieldErrors.fullName}>
                {(id, d) => <input id={id} aria-describedby={d} className="field" value={form.fullName} onChange={set('fullName')} autoComplete="name" required />}
              </Field>
            )}
            <Field label="University e-mail" error={fieldErrors.email}>
              {(id, d) => <input id={id} aria-describedby={d} type="email" className="field" value={form.email} onChange={set('email')} autoComplete="email" required />}
            </Field>
            <Field label="Password" error={fieldErrors.password} hint={mode === 'register' ? 'At least 8 characters with a letter and a number.' : undefined}>
              {(id, d) => <input id={id} aria-describedby={d} type="password" className="field" value={form.password} onChange={set('password')}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required />}
            </Field>
            {mode === 'register' && (
              <>
                <Field label="School or department" error={fieldErrors.deptId}>
                  {(id, d) => (
                    <select id={id} aria-describedby={d} className="field" value={form.deptId} onChange={set('deptId')} required>
                      <option value="">Choose your school</option>
                      {departments.map((dp) => <option key={dp.deptId} value={dp.deptId}>{dp.deptName}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Registration number (optional)" error={fieldErrors.regNo}>
                  {(id, d) => <input id={id} aria-describedby={d} className="field" value={form.regNo} onChange={set('regNo')} />}
                </Field>
              </>
            )}
            {error && !Object.keys(fieldErrors).length && <ErrorState error={error} />}
            <Button type="submit" loading={pending} className="w-full py-2.5">
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>
          {mode === 'register' && (
            <p className="mt-4 text-sm text-ink-faint">New accounts are student accounts. An administrator can grant staff roles.</p>
          )}
        </div>
      </section>
    </div>
  );
}
