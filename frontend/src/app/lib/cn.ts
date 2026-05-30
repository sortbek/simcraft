/**
 * Tiny class-name joiner. Filters falsy values and joins with a space.
 * Intentionally dependency-free (no clsx/cva) to keep the bundle lean and
 * match the project's existing template-literal class style. Use for
 * conditional Tailwind classes instead of nested ternaries in JSX.
 *
 *   cn('base', checked && 'bg-gold', disabled && 'opacity-40')
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
