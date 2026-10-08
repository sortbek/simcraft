'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { APP_SCROLL_ID } from '../../lib/scrollRoot';

/** The scroll area under the top bar. A new page starts at its top, as the
 *  window would when it did the scrolling. */
export default function AppScroll({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div id={APP_SCROLL_ID} ref={ref} className="min-h-0 flex-1 overflow-y-auto">
      {children}
    </div>
  );
}
