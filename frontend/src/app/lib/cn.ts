/**
 * Tiny class-name joiner (filters falsy, joins with space). Dependency-free
 * (no clsx/cva) to keep the bundle lean. For conditional Tailwind classes:
 *
 *   cn('base', checked && 'bg-gold', disabled && 'opacity-40')
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
