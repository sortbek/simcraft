'use client';

import Link from 'next/link';
import { useActiveSims } from '../../lib/useActiveSims';

export default function ActiveSimsIndicator() {
  const { activeCount } = useActiveSims();

  if (activeCount === 0) return null;

  return (
    <Link
      href="/sims"
      className="desktop-no-drag flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[12px] font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
      title={`${activeCount} sim${activeCount === 1 ? '' : 's'} running — click to view`}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
      {activeCount} running
    </Link>
  );
}
