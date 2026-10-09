'use client';

import type { ReactNode } from 'react';
import ConfigFooterBar from './ConfigFooterBar';
import type { ComputeChoice } from '../../lib/useComputeChoice';

interface ConfigFooterProps {
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
  /** Optional status segment in the footer's left info group (e.g. combo count). */
  status?: ReactNode;
  /** Optional full-width notice pinned directly above the footer bar (e.g. a large-sim warning). */
  notice?: ReactNode;
}

export default function ConfigFooter({
  onSubmit,
  submitting,
  buttonLabel,
  disabled,
  showStatWeightsToggle,
  compute,
  onComputeChange,
  computeTargetDisabledReasons,
  subLabel,
  status,
  notice,
}: ConfigFooterProps) {
  return (
    <div className="fixed bottom-0 left-[var(--sidebar-w)] right-0 z-30 transition-[left] duration-200">
      {notice}

      <ConfigFooterBar
        onSubmit={onSubmit}
        submitting={submitting}
        buttonLabel={buttonLabel}
        disabled={disabled}
        showStatWeightsToggle={showStatWeightsToggle}
        compute={compute}
        onComputeChange={onComputeChange}
        computeTargetDisabledReasons={computeTargetDisabledReasons}
        subLabel={subLabel}
        status={status}
      />
    </div>
  );
}
