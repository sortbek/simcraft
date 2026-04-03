'use client';

import { useEffect, useRef } from 'react';

function classifyLine(line: string): string {
  if (line.startsWith('SimulationCraft ')) return 'text-gold/70';
  if (line.startsWith('Simulating...')) return 'text-gray-500';
  if (line.startsWith('Generating Baseline:') || line.startsWith('Generating Profileset:'))
    return 'text-gray-500';
  if (line.startsWith('Implementation Not Yet Verified')) return 'text-amber-500/60 italic';
  if (
    line.startsWith('Generating reports') ||
    line.startsWith('DPS Ranking:') ||
    line.startsWith('Profilesets (') ||
    line.startsWith('HPS Ranking:') ||
    line.startsWith('Baseline Performance:')
  )
    return 'text-gray-300';
  if (/^\s+\d+\.\d+\s*:\s*Combo\s/.test(line)) return 'text-gray-500';
  return 'text-gray-500';
}

export default function LogConsole({ lines }: { lines: string[] }) {
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
    <div className="w-full">
      <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-surface px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold/60" />
          <span className="text-[12px] font-medium uppercase tracking-wider text-gray-500">
            SimC Output
          </span>
        </div>
        <span className="font-mono text-[12px] tabular-nums text-gray-600">
          {lines.length} lines
        </span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-[320px] overflow-y-auto rounded-b-lg border border-border bg-[#0c0c0e] p-3 font-mono text-[13px] leading-[1.7]"
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
