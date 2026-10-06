interface ToggleButtonGroupProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: { key: T; label: string; sublabel?: string }[];
  size?: 'sm' | 'md';
}

/** Track and tab classes of the segmented control, for tab rows that need
 *  extra per-tab content (dots, hints) the generic group can't render. */
export const TABS_TRACK =
  'inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-[8px] border border-line/[0.06] bg-background p-[3px]';

export function tabClass(active: boolean, size: 'sm' | 'md' = 'md') {
  const button = size === 'sm' ? 'h-6 px-2.5 text-[11px]' : 'h-7 px-3 text-xs';
  return `rounded-[5px] font-headline font-extrabold uppercase tracking-[0.12em] transition-colors ${button} ${
    active
      ? 'bg-[color:var(--tab-on-bg)] text-on-surface [box-shadow:var(--tab-on-shadow)]'
      : 'text-outline hover:text-on-surface-variant'
  }`;
}

export default function ToggleButtonGroup<T extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
}: ToggleButtonGroupProps<T>) {
  return (
    <div className={TABS_TRACK}>
      {options.map((opt) => (
        <button
          key={String(opt.key)}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={tabClass(value === opt.key, size)}
        >
          {opt.label}
          {opt.sublabel && <span className="ml-1 opacity-50">{opt.sublabel}</span>}
        </button>
      ))}
    </div>
  );
}
