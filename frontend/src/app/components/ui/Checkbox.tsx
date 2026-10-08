import { cn } from '../../lib/cn';

interface CheckboxProps {
  checked: boolean;
  onChange?: () => void;
  /** Render size. */
  size?: 'sm' | 'md';
  /** `neutral` marks a baseline that is always included (e.g. the equipped item)
   *  so it reads differently from a pick. */
  tone?: 'gold' | 'neutral';
  disabled?: boolean;
  /** Accessible label (no visible text). */
  'aria-label'?: string;
  className?: string;
}

const BOX_BASE =
  'flex shrink-0 items-center justify-center transition-colors disabled:cursor-not-allowed';

const SIZE: Record<NonNullable<CheckboxProps['size']>, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-5 w-5',
};

/**
 * Accessible checkbox with role="checkbox" + aria-checked + keyboard activation.
 * Without `onChange` (presentational, e.g. inside a parent button) renders a `div` to avoid nested-button invalid HTML.
 */
export default function Checkbox({
  checked,
  onChange,
  size = 'md',
  tone = 'gold',
  disabled = false,
  className,
  ...aria
}: CheckboxProps) {
  const box = cn(
    'rounded-[3px] border',
    checked
      ? cn(
          tone === 'neutral'
            ? 'border-on-surface-variant bg-on-surface-variant'
            : 'border-gold-fill bg-gold-fill',
          size === 'sm'
            ? 'shadow-[inset_0_0_0_2px_var(--cb-ring)]'
            : 'shadow-[inset_0_0_0_3px_var(--cb-ring)]'
        )
      : 'border-outline-variant hover:border-outline group-hover:border-outline'
  );

  const checkmark = checked ? (
    <svg
      className={cn(
        size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3',
        tone === 'neutral' ? 'text-surface-container' : 'text-on-primary'
      )}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5L6.5 10.5L4 8" />
    </svg>
  ) : null;

  const sharedClass = cn(BOX_BASE, SIZE[size], box, className);
  const sharedAria = {
    role: 'checkbox' as const,
    'aria-checked': checked,
    'aria-label': aria['aria-label'],
  };

  if (!onChange) {
    return (
      <div {...sharedAria} className={sharedClass}>
        {checkmark}
      </div>
    );
  }

  return (
    <button
      type="button"
      {...sharedAria}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={sharedClass}
    >
      {checkmark}
    </button>
  );
}
