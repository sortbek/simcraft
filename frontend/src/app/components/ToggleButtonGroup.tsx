interface ToggleButtonGroupProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: { key: T; label: string; sublabel?: string }[];
  size?: 'sm' | 'md';
}

export default function ToggleButtonGroup<T extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
}: ToggleButtonGroupProps<T>) {
  const padding = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-[13px]';

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt.key)}
          onClick={() => onChange(opt.key)}
          className={`rounded-lg border font-medium transition-all duration-150 ${padding} ${
            value === opt.key
              ? 'border-gold/40 bg-gold/[0.08] text-gold'
              : 'border-border bg-surface-2 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
          }`}
        >
          {opt.label}
          {opt.sublabel && <span className="ml-1 text-[10px] opacity-50">{opt.sublabel}</span>}
        </button>
      ))}
    </div>
  );
}
