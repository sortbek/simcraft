import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Standard 58px card header row: uppercase title on the left, an optional
 *  meta/actions slot right-aligned, bottom hairline. Matches the UI-polish
 *  mock's `.ch` / `.h-card`. */
export default function CardHeader({
  title,
  right,
  className,
}: {
  title: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-[58px] items-center justify-between gap-3 border-b border-line/[0.06] px-6',
        className
      )}
    >
      <span className="h-card">{title}</span>
      {right}
    </div>
  );
}
