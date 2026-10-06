import type { ReactNode } from 'react';

/** Page title block from the UI-polish mock: gold eyebrow `.lbl`, `.h-page`
 *  title, muted subtitle. */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div>
      <div className="lbl text-gold">{eyebrow}</div>
      <h1 className="mt-2 font-headline text-2xl font-extrabold leading-[1.1] tracking-[-0.01em] text-on-surface">
        {title}
      </h1>
      {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-on-surface-variant">{subtitle}</p>}
    </div>
  );
}
