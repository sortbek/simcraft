import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import Button from '../components/ui/Button';
import Switch from '../components/ui/Switch';

/** Shared pieces of the SimC and WoW Forever engine cards: a status strip on top,
 *  hairline rows below, a footnote. */

export type Tone = 'ok' | 'info' | 'warn' | 'err' | 'idle' | 'busy';

const TONE: Record<Tone, string> = {
  ok: 'bg-positive/[0.12] text-positive',
  info: 'bg-gold/[0.12] text-gold',
  warn: 'bg-warning/[0.12] text-warning',
  err: 'bg-negative/[0.12] text-negative',
  idle: 'bg-outline/[0.12] text-on-surface-variant',
  busy: 'bg-outline/[0.12] text-on-surface-variant',
};

const path = (d: ReactNode) => (
  <svg
    className="h-4 w-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d}
  </svg>
);

export const ICON = {
  check: path(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  down: path(<path d="M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" />),
  alert: path(
    <path d="M12 9v4.5m0 3v.01M10.3 3.9L2.6 17.5a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  ),
  refresh: path(<path d="M20 11a8 8 0 10-2.3 6.3M20 4v7h-7" />),
  code: path(<path d="M9 7l-5 5 5 5m6-10l5 5-5 5" />),
  power: path(<path d="M12 3v9m5.7-6.3a8 8 0 11-11.4 0" />),
  dot: path(<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />),
};

function Spinner() {
  return (
    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gold/25 border-t-gold" />
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn('h-1 overflow-hidden rounded-sm bg-surface-container-highest', className)}>
      <div className="h-full bg-gold transition-[width]" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

export interface EngineStatus {
  tone: Tone;
  icon?: ReactNode;
  title: ReactNode;
  sub: ReactNode;
  progress?: number;
}

export function StatusStrip({ status, action }: { status: EngineStatus; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 border-b border-line/[0.06] bg-surface-container-low px-6 py-3.5">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px]',
          TONE[status.tone]
        )}
      >
        {status.tone === 'busy' ? <Spinner /> : status.icon}
      </span>
      <div className="min-w-[150px] flex-1">
        <p className="text-[14.5px] font-semibold leading-snug text-on-surface">{status.title}</p>
        <p className="text-[12.5px] text-on-surface-variant">{status.sub}</p>
      </div>
      {action}
      {status.progress !== undefined && (
        <ProgressBar value={status.progress} className="basis-full" />
      )}
    </div>
  );
}

export function EngineRow({
  name,
  children,
  control,
  actions,
  dim,
}: {
  name: string;
  /** The version, or a help line that wraps under the name. */
  children: ReactNode;
  control: ReactNode;
  actions?: ReactNode;
  dim?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/[0.06] px-6 py-[13px] first:border-t-0',
        dim && 'opacity-45'
      )}
    >
      <div className="flex min-w-[220px] flex-1 flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
        <span className="min-w-[62px] text-sm font-semibold text-on-surface">{name}</span>
        {children}
      </div>
      {control}
      <div className="flex min-w-[150px] items-center justify-end gap-1">{actions}</div>
    </div>
  );
}

export function VersionText({ children }: { children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-[9px] gap-y-[3px] text-[13px]">
      {children}
    </span>
  );
}

export function Version({ date, commit }: { date: string | null; commit: string | null }) {
  return (
    <>
      {date && <span className="whitespace-nowrap font-semibold text-on-surface">{date}</span>}
      {commit && <code className="font-mono text-xs text-outline">{commit}</code>}
    </>
  );
}

export function UpToDateMark({ title }: { title: string }) {
  return (
    <span className="inline-flex text-positive [&_svg]:h-3.5 [&_svg]:w-3.5" title={title}>
      {ICON.check}
    </span>
  );
}

export function AutoSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  tip,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  ariaLabel: string;
  tip: string;
  disabled?: boolean;
}) {
  return (
    <label
      title={tip}
      className={cn(
        'inline-flex select-none items-center gap-[9px]',
        disabled ? 'opacity-45' : 'cursor-pointer'
      )}
    >
      <span className="whitespace-nowrap text-[12.5px] text-on-surface-variant">{label}</span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} aria-label={ariaLabel} />
    </label>
  );
}

export function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="text" className="hover:!text-negative" onClick={onClick}>
      {label}
    </Button>
  );
}

export function EngineFooter({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-line/[0.06] px-6 py-[11px] text-[12.5px] text-outline">
      {children}
    </p>
  );
}

export function EngineError({ message }: { message: string }) {
  return message ? (
    <p className="border-t border-line/[0.06] px-6 py-2.5 text-xs text-negative">{message}</p>
  ) : null;
}

/** "16 Nov 2026" from a release tag's date, or null when the tag carries none. */
export function tagDate(tag: string | null | undefined, locale: string): string | null {
  const m = tag?.match(/(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(locale.replace('_', '-'), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The short commit after a tag's date, e.g. `0d19401`. */
export function tagCommit(tag: string | null | undefined): string | null {
  const m = tag?.match(/\d{4}-?\d{2}-?\d{2}-([0-9a-f]+)/i);
  return m ? m[1].slice(0, 7) : null;
}
