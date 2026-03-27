'use client';

import { useCallback } from 'react';
import ErrorAlert from '../components/ErrorAlert';
import { useSimContext } from '../components/SimContext';
import { useSimSubmit } from '../lib/useSimSubmit';

export default function QuickSimPage() {
  const { simcInput } = useSimContext();

  const buildPayload = useCallback(
    () => ({
      simc_input: simcInput,
      sim_type: 'quick',
    }),
    [simcInput]
  );

  const validate = useCallback(() => {
    if (simcInput.trim().length < 10) {
      return 'SimC input is too short. Paste your full addon export.';
    }
    return null;
  }, [simcInput]);

  const { submit, submitting, error, buttonLabel } = useSimSubmit({
    endpoint: '/api/sim',
    buildPayload,
    validate,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      <ErrorAlert message={error} />

      <button
        type="submit"
        disabled={submitting || simcInput.trim().length < 10}
        className="btn-primary w-full py-3 text-sm"
      >
        {submitting ? 'Running…' : buttonLabel('Run Simulation')}
      </button>
    </form>
  );
}
