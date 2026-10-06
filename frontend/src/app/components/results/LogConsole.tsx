'use client';

import { type ReactNode, useEffect, useRef } from 'react';
import { useLanguage } from '../../lib/i18n';
import CardHeader from '../ui/CardHeader';

function classifyLine(line: string): string {
  if (line.startsWith('SimulationCraft ')) return 'text-primary/70';
  if (line.startsWith('✓ ')) return 'text-on-surface-variant';
  if (line.startsWith('Implementation Not Yet Verified')) return 'text-warning/60 italic';
  if (
    line.startsWith('Generating reports') ||
    line.startsWith('DPS Ranking:') ||
    line.startsWith('Profilesets (') ||
    line.startsWith('HPS Ranking:') ||
    line.startsWith('Baseline Performance:')
  )
    return 'text-on-surface-variant';
  return 'text-on-surface-variant/40';
}

export default function LogConsole({
  lines,
  totalLines,
  headerRight,
}: {
  lines: string[];
  /** Line count shown in the header, when `lines` is a filtered view. */
  totalLines?: number;
  headerRight?: ReactNode;
}) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoScroll = useRef(true);

  useEffect(() => {
    if (isAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAutoScroll.current = scrollHeight - scrollTop - clientHeight < 30;
  }

  return (
    <section className="card w-full overflow-hidden">
      <CardHeader
        title={t('results.simcOutput')}
        right={
          <div className="flex items-center gap-3">
            {headerRight}
            <span className="lbl tabular-nums">
              {t('results.logLines', { count: totalLines ?? lines.length })}
            </span>
          </div>
        }
      />
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-[320px] overflow-y-auto px-6 py-4 font-mono text-[12.5px] leading-[1.75]"
      >
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${classifyLine(line)}`}>
            {line || ' '}
          </div>
        ))}
      </div>
    </section>
  );
}
