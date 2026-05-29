'use client';

import { usePathname } from 'next/navigation';
import TalentPicker from '../talents/TalentPicker';
import AdvancedOptions from './AdvancedOptions';
import { ROUTES } from '../../lib/routes';

const SIM_BUILDER_ROUTES: ReadonlySet<string> = new Set([
  ROUTES.quickSim,
  ROUTES.topGear,
  ROUTES.dropFinder,
  ROUTES.upgradeCompare,
]);

export default function SimSharedConfig() {
  const pathname = usePathname();
  if (!SIM_BUILDER_ROUTES.has(pathname)) return null;

  return (
    <div className="mb-6 space-y-4">
      <TalentPicker />
      <AdvancedOptions />
    </div>
  );
}
