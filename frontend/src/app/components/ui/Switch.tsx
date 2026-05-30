import { cn } from '../../lib/cn';

interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Tailwind bg class for the ON track, e.g. 'bg-gold', 'bg-amber-500', 'bg-primary'. */
  onColor?: string;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
}

/**
 * Accessible toggle switch. Replaces three hand-rolled clickable-div switches in
 * EnchantGemSelector (and is the shared primitive for TopGearScreen's Toggle).
 * Geometry matches the existing 18×32 track + 12px knob exactly.
 */
export default function Switch({
  checked,
  onChange,
  onColor = 'bg-gold',
  disabled = false,
  className,
  ...aria
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[18px] w-8 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed',
        checked ? onColor : 'bg-surface-container-highest',
        className
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] h-3 w-3 rounded-full transition-all',
          checked ? 'right-[3px] bg-white' : 'left-[3px] bg-on-surface-variant'
        )}
      />
    </button>
  );
}
