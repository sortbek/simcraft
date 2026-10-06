'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { onSetupRestored } from '../../lib/share/editShared';

/** Remounts its page after "Restore my setup". Wraps only the pages that read
 *  their saved state on mount (Top Gear, Drop Finder); elsewhere a remount would
 *  just throw state away (a live sim view's log cursor, for one). */
export default function RemountOnRestore({ children }: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0);
  useEffect(() => onSetupRestored(() => setGeneration((g) => g + 1)), []);
  return <Fragment key={generation}>{children}</Fragment>;
}
