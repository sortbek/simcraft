'use client';

import { useCallback, useState, type ReactNode } from 'react';
import type { ExpertTabKey } from './ExpertToggle';
import ConfigDrawer from './ConfigDrawer';
import ConfigFooterBar from './ConfigFooterBar';
import type { ComputeChoice } from '../../lib/useComputeChoice';

interface ConfigFooterProps {
  children?: ReactNode;
  onSubmit: () => void;
  submitting: boolean;
  buttonLabel: string;
  disabled?: boolean;
  /** Render a stat-weights toggle in the footer bar (Quick Sim only). */
  showStatWeightsToggle?: boolean;
  compute: ComputeChoice;
  onComputeChange: (v: ComputeChoice) => void;
  computeTargetDisabledReasons?: Record<string, string>;
  /** Optional second line for the Run button (e.g. cloud cost estimate). */
  subLabel?: ReactNode;
}

export default function ConfigFooter({
  children,
  onSubmit,
  submitting,
  buttonLabel,
  disabled,
  showStatWeightsToggle,
  compute,
  onComputeChange,
  computeTargetDisabledReasons,
  subLabel,
}: ConfigFooterProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'simulation' | 'buffs'>('simulation');
  const [expertActiveTab, setExpertActiveTab] = useState<ExpertTabKey>('footer');
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);

  const toggleDrawer = useCallback(() => {
    setDrawerOpen((current) => !current);
  }, []);

  return (
    <div className="fixed bottom-0 left-64 right-0 z-30">
      {drawerOpen && (
        <ConfigDrawer
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          expertActiveTab={expertActiveTab}
          onExpertActiveTabChange={setExpertActiveTab}
          availableBranches={availableBranches}
          onAvailableBranchesChange={setAvailableBranches}
        >
          {children}
        </ConfigDrawer>
      )}

      <ConfigFooterBar
        drawerOpen={drawerOpen}
        onToggleDrawer={toggleDrawer}
        onSubmit={onSubmit}
        submitting={submitting}
        buttonLabel={buttonLabel}
        disabled={disabled}
        showStatWeightsToggle={showStatWeightsToggle}
        compute={compute}
        onComputeChange={onComputeChange}
        computeTargetDisabledReasons={computeTargetDisabledReasons}
        subLabel={subLabel}
      />
    </div>
  );
}
