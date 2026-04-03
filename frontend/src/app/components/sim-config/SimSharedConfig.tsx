'use client';

import { usePathname } from 'next/navigation';
import TalentPicker from '../talents/TalentPicker';
import AdvancedOptions from './AdvancedOptions';

export default function SimSharedConfig() {
  const pathname = usePathname();

  const showConfig =
    pathname === '/quick-sim' ||
    pathname === '/top-gear' ||
    pathname === '/drop-finder' ||
    pathname === '/upgrade-compare';
  if (!showConfig) return null;

  return (
    <div className="mb-6 space-y-4">
      <TalentPicker />
      <AdvancedOptions />
    </div>
  );
}
