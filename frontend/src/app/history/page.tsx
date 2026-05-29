'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '../lib/routes';

/**
 * /history was merged into /sims (unified overview with stats panel,
 * batch grouping, and inline actions). This stub redirects so old
 * bookmarks keep working.
 */
export default function HistoryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(ROUTES.sims);
  }, [router]);
  return null;
}
