'use client';

import { buttonClass } from '../ui/Button';
import { useLanguage } from '../../lib/i18n';

export default function ForeverFooter({
  onSubmit,
  submitting,
  disabled,
  label,
  status,
}: {
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
  label: string;
  status?: string | null;
}) {
  const { t } = useLanguage();
  return (
    <div className="fixed bottom-0 left-[var(--sidebar-w)] right-0 z-30 transition-[left] duration-200">
      <div className="config-footer border-t border-line/[0.06] bg-background">
        <div className="mx-auto flex max-w-screen-2xl items-center gap-3.5 px-8 py-3.5">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-outline">
            {status}
          </span>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || submitting}
            className={buttonClass('solid', 'lg')}
          >
            {submitting ? t('config.running') : label}
          </button>
        </div>
      </div>
    </div>
  );
}
