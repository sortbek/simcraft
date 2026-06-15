'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '../lib/routes';

/** /history was merged into /sims; this stub redirects so old bookmarks keep working. */
export default function HistoryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(ROUTES.sims);
  }, [router]);
  return null;
}
