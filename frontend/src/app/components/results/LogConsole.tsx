'use client';

import { useEffect, useRef } from 'react';
import { useLanguage } from '../../lib/i18n';

function classifyLine(line: string): string {
  if (line.startsWith('SimulationCraft ')) return 'text-primary/70';
  if (line.startsWith('Simulating...')) return 'text-on-surface-variant/40';
  if (line.startsWith('Generating Baseline:') || line.startsWith('Generating Profileset:'))
    return 'text-on-surface-variant/40';
  if (line.startsWith('Implementation Not Yet Verified')) return 'text-amber-500/60 italic';
  if (
    line.startsWith('Generating reports') ||
    line.startsWith('DPS Ranking:') ||
    line.startsWith('Profilesets (') ||
    line.startsWith('HPS Ranking:') ||
    line.startsWith('Baseline Performance:')
  )
    return 'text-on-surface-variant';
  if (/^\s+\d+\.\d+\s*:\s*Combo\s/.test(line)) return 'text-on-surface-variant/40';
  return 'text-on-surface-variant/40';
}

export default function LogConsole({ lines }: { lines: string[] }) {
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
    <div className="w-full overflow-hidden rounded-xl border border-outline-variant/10">
      <div className="flex items-center justify-between bg-surface-container-high px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/60" />
          <span className="text-[12px] font-medium uppercase tracking-wider text-on-surface-variant/60">
            {t('results.simcOutput')}
          </span>
        </div>
        <span className="font-mono text-[12px] tabular-nums text-on-surface-variant/40">
          {t('results.logLines', { count: lines.length })}
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-[320px] overflow-y-auto bg-surface-container-low p-4 font-mono text-[13px] leading-[1.7]"
      >
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all ${classifyLine(line)}`}>
            {line || '\u00A0'}
          </div>
        ))}
      </div>
    </div>
  );
}
