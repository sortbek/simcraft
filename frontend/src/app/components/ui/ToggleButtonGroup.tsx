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
  const padding = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-[15px]';

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt.key)}
          onClick={() => onChange(opt.key)}
          className={`rounded-lg font-medium transition-all duration-150 ${padding} ${
            value === opt.key
              ? 'bg-primary/10 text-primary'
              : 'bg-surface-container-high text-on-surface-variant/60 hover:bg-surface-container-highest hover:text-on-surface-variant'
          }`}
        >
          {opt.label}
          {opt.sublabel && <span className="ml-1 text-[12px] opacity-50">{opt.sublabel}</span>}
        </button>
      ))}
    </div>
  );
}
