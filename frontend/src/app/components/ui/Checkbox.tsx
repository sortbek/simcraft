import { cn } from '../../lib/cn';

interface CheckboxProps {
  checked: boolean;
  onChange?: () => void;
  /** Visual family. `gold` = GearItemRow/TalentPicker, `primary` = loot table. */
  variant?: 'gold' | 'primary';
  /** Render size. */
  size?: 'sm' | 'md';
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
 * Accessible checkbox. Previously hand-rolled (input.sr-only + styled div, or a
 * bare button with an SVG) in 4+ places with no role/aria. This primitive adds
 * role="checkbox" + aria-checked + keyboard activation.
 *
 * When no `onChange` is provided (presentational, e.g. inside a parent button),
 * renders as a `div` to avoid invalid nested-button HTML.
 */
export default function Checkbox({
  checked,
  onChange,
  variant = 'gold',
  size = 'md',
  disabled = false,
  className,
  ...aria
}: CheckboxProps) {
  const gold = variant === 'gold';
  const box = gold
    ? cn(
        'rounded-[3px] border',
        checked
          ? 'border-gold bg-gold'
          : 'border-outline-variant group-hover:border-outline-variant/40'
      )
    : cn(
        'rounded border-2',
        checked
          ? 'border-primary bg-primary'
          : 'border-outline-variant/40 bg-transparent hover:border-on-surface-variant/60'
      );

  const checkmark = checked ? (
    <svg
      className={cn(
        size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3',
        gold ? 'text-black' : 'text-on-primary'
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

  // Presentational mode: render as div to avoid nested-button invalid HTML.
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
