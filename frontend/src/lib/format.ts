// Date helpers. The API stores campus-local time (Asia/Kolkata). The UI
// formats in the browser's zone and sends ISO strings with an explicit offset.

const TZ = 'Asia/Kolkata';

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...opts });
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const dateFmt = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });

export const fmtDay = (d: string | Date) => dayFmt.format(new Date(d));
export const fmtDate = (d: string | Date) => dateFmt.format(new Date(d));
export const fmtTime = (d: string | Date) => timeFmt.format(new Date(d));
export const fmtRange = (s: string, e: string) => `${fmtDay(s)}, ${fmtTime(s)}–${fmtTime(e)}`;
export const fmtDateTime = (d: string) => `${fmtDate(d)} ${fmtTime(d)}`;

export function relative(d: string) {
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** "YYYY-MM-DD" for a campus-local calendar day. */
export function isoDay(d: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Campus-local wall-clock time -> ISO string with +05:30 offset. */
export function campusIso(day: string, hour: number, minute = 0) {
  return `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`;
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

/** Monday of the ISO week containing `day`. */
export function weekStart(day: string) {
  const d = new Date(`${day}T12:00:00+05:30`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(day, -dow);
}

export const hoursLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
