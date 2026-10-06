import { cn } from '../../lib/cn';

interface SwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
  /** Set when the switch also shows/hides a panel. */
  'aria-expanded'?: boolean;
  className?: string;
}

/** Accessible toggle switch rendered as the mock's `.tog` track/thumb. */
export default function Switch({
  checked,
  onChange,
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
      aria-expanded={aria['aria-expanded']}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('tog disabled:cursor-not-allowed', checked && 'tog-on', className)}
    />
  );
}
