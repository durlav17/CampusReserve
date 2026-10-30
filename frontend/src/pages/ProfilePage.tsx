import { useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError } from '../services/api';
import { Button, ErrorState, Field, PageHeader, Panel, useToast } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [profile, setProfile] = useState({ fullName: user?.fullName ?? '', phone: user?.phone ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pErr, setPErr] = useState<ApiError | null>(null);
  const [wErr, setWErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<'p' | 'w' | null>(null);
  if (!user) return null;

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); setBusy('p'); setPErr(null);
    try {
      await api('/auth/me', { method: 'PATCH', body: { fullName: profile.fullName, phone: profile.phone } });
      await refresh();
      toast('ok', 'Profile saved');
    } catch (err) { setPErr(err as ApiError); } finally { setBusy(null); }
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.newPassword !== pw.confirm) { setWErr(new ApiError(400, 'MISMATCH', 'The new passwords do not match.')); return; }
    setBusy('w'); setWErr(null);
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast('ok', 'Password changed');
    } catch (err) { setWErr(err as ApiError); } finally { setBusy(null); }
  };

  const pfe = pErr?.fieldErrors() ?? {};
  const wfe = wErr?.fieldErrors() ?? {};

  return (
    <>
      <PageHeader title="Profile and account" subtitle="Your details and sign-in settings." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title="Account">
          <dl className="space-y-3 text-sm">
            {[['E-mail', user.email], ['Role', user.role.name], ['Department', user.department.name],
              ['Registration no.', user.regNo ?? 'Not set'], ['Member since', fmtDateTime(user.createdAt)],
              ['Last sign-in', user.lastLoginAt ? fmtDateTime(user.lastLoginAt) : 'First visit']].map(([k, v]) => (
              <div key={k}><dt className="text-ink-faint">{k}</dt><dd className="font-medium">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-ink-faint">Role and department changes are made by an administrator.</p>
        </Panel>

        <Panel title="Personal details">
          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Full name" error={pfe.fullName}>{(id) => <input id={id} className="field" value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />}</Field>
            <Field label="Phone" error={pfe.phone}>{(id) => <input id={id} className="field" inputMode="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />}</Field>
            {pErr && !Object.keys(pfe).length && <ErrorState error={pErr} />}
            <Button type="submit" loading={busy === 'p'}>Save details</Button>
          </form>
        </Panel>

        <Panel title="Password">
          <form onSubmit={savePassword} className="space-y-4">
            <Field label="Current password">{(id) => <input id={id} type="password" autoComplete="current-password" className="field" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}</Field>
            <Field label="New password" error={wfe.newPassword} hint="At least 8 characters with a letter and a number.">{(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="new-password" className="field" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}</Field>
            <Field label="Confirm new password">{(id) => <input id={id} type="password" autoComplete="new-password" className="field" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />}</Field>
            {wErr && !Object.keys(wfe).length && <ErrorState error={wErr} />}
            <Button type="submit" loading={busy === 'w'} disabled={!pw.currentPassword || !pw.newPassword}>Change password</Button>
          </form>
        </Panel>
      </div>
    </>
  );
}
