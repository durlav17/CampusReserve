import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';
import type { ApiError } from '../services/api';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ---- Button ---------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-lagoon text-white hover:bg-lagoon-deep shadow-[0_6px_16px_-8px_rgb(31_122_140/0.8)]',
  secondary: 'bg-white/80 text-ink border border-line hover:bg-white',
  ghost: 'text-ink-soft hover:bg-white/60 hover:text-ink',
  danger: 'bg-bad text-white hover:brightness-95',
};

export function Button({
  variant = 'primary', loading, icon, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3.5 py-2 text-sm font-semibold',
        'transition-[background-color,box-shadow,transform] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant], className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

// ---- Panel ------------------------------------------------------------------
export function Panel({ title, action, children, className, padded = true }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={cx('glass min-w-0', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {action}
        </header>
      )}
      <div className={padded ? 'p-5 pt-3' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[65ch] text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ---- Form field -------------------------------------------------------------
export function Field({ label, error, hint, children }: {
  label: string; error?: string; hint?: string; children: (id: string, describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children(id, error || hint ? msgId : undefined)}
      {error ? <p id={msgId} className="mt-1 text-sm text-bad">{error}</p>
        : hint ? <p id={msgId} className="mt-1 text-sm text-ink-faint">{hint}</p> : null}
    </div>
  );
}

// ---- Status badges -------------------------------------------------------------
const tones = {
  ok: 'bg-ok-wash text-ok', wait: 'bg-wait-wash text-wait', bad: 'bg-bad-wash text-bad',
  fix: 'bg-fix-wash text-fix', neutral: 'bg-ink/5 text-ink-soft', info: 'bg-lagoon-wash text-lagoon-deep',
} as const;
const statusTone: Record<string, keyof typeof tones> = {
  APPROVED: 'ok', AVAILABLE: 'ok', RESOLVED: 'ok', CLOSED: 'neutral',
  PENDING: 'wait', OPEN: 'wait', IN_PROGRESS: 'info',
  REJECTED: 'bad', CRITICAL: 'bad', HIGH: 'bad',
  CANCELLED: 'neutral', RETIRED: 'neutral', LOW: 'neutral', MEDIUM: 'wait',
  MAINTENANCE: 'fix', BLACKOUT: 'fix', INSERT: 'info', UPDATE: 'neutral', DELETE: 'bad',
};
const statusText: Record<string, string> = {
  IN_PROGRESS: 'In progress', APPROVED: 'Approved', PENDING: 'Pending', REJECTED: 'Rejected',
  CANCELLED: 'Cancelled', AVAILABLE: 'Available', MAINTENANCE: 'Maintenance', RETIRED: 'Retired',
  OPEN: 'Open', RESOLVED: 'Resolved', CLOSED: 'Closed', LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High',
  CRITICAL: 'Critical', INSERT: 'Created', UPDATE: 'Updated', DELETE: 'Deleted',
};

export function StatusBadge({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return null;
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
      tones[statusTone[value] ?? 'neutral'], className)}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {statusText[value] ?? value}
    </span>
  );
}

// ---- Loading / empty / error -------------------------------------------------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-lg bg-ink/[0.06]', className)} aria-hidden />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-11" />)}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-lagoon-wash text-lagoon">{icon}</div>}
      <p className="font-display text-lg font-bold">{title}</p>
      {children && <p className="mt-1 max-w-[46ch] text-ink-soft">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-bad/20 bg-bad-wash/70 p-4 text-sm">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-bad" aria-hidden />
      <div className="flex-1">
        <p className="font-semibold text-bad">{error.status === 0 ? 'Connection problem' : 'This could not be completed'}</p>
        <p className="text-ink-soft">{error.message}</p>
      </div>
      {onRetry && <Button variant="secondary" onClick={onRetry} icon={<RefreshCw className="size-4" />}>Retry</Button>}
    </div>
  );
}

// ---- Modal -------------------------------------------------------------------------
export function Modal({ open, title, onClose, children, footer }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="glass-strong m-auto w-[min(34rem,calc(100vw-2rem))] p-0 text-ink backdrop:bg-ink/30 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 className="text-lg font-bold">{title}</h2>
        <button onClick={onClose} className="rounded-lg p-1 text-ink-faint hover:bg-ink/5" aria-label="Close dialog">
          <X className="size-5" />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
    </dialog>
  );
}

// ---- Toasts ------------------------------------------------------------------------------
type Toast = { id: number; tone: 'ok' | 'bad'; text: string };
const ToastCtx = createContext<(tone: Toast['tone'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="glass-strong pointer-events-auto flex max-w-sm items-center gap-2.5 px-4 py-3 text-sm font-medium">
            {t.tone === 'ok' ? <CheckCircle2 className="size-5 text-ok" aria-hidden /> : <AlertTriangle className="size-5 text-bad" aria-hidden />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export const useToast = () => useContext(ToastCtx);

// ---- Pagination ---------------------------------------------------------------------------
export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (o: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-soft" aria-label="Pagination">
      <span>Page {page} of {pages} ({total} records)</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(offset - limit)}>Previous</Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </nav>
  );
}

// ---- KPI tile ----------------------------------------------------------------------------------
export function Stat({ label, value, icon, tone = 'info', hint }: {
  label: string; value: ReactNode; icon: ReactNode; tone?: keyof typeof tones; hint?: string;
}) {
  return (
    <div className="glass flex items-start gap-3 p-4">
      <div className={cx('grid size-10 shrink-0 place-items-center rounded-xl', tones[tone])}>{icon}</div>
      <div className="min-w-0">
        <p className="text-sm text-ink-soft">{label}</p>
        <p className="font-display text-2xl font-extrabold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-ink-faint">{hint}</p>}
      </div>
    </div>
  );
}
