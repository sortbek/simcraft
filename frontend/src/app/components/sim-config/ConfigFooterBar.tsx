'use client';

import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';

interface ConfigFooterBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onSubmit: () => void;
  submitting: boolean;
  buttonLabel: string;
  disabled?: boolean;
}

export default function ConfigFooterBar({
  drawerOpen,
  onToggleDrawer,
  onSubmit,
  submitting,
  buttonLabel,
  disabled,
}: ConfigFooterBarProps) {
  const { t } = useLanguage();
  const { fightStyle, fightLength, targetCount } = useSimContext();
  const fightLengthLabel = `${Math.floor(fightLength / 60)}:${String(fightLength % 60).padStart(2, '0')}`;

  return (
    <div className="border-t border-outline-variant/10 bg-[#131313]/95 shadow-[0_-4px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <div className="mx-auto flex h-20 max-w-screen-2xl items-center gap-6 px-8">
        <div className="flex items-center gap-4 text-sm text-on-surface-variant">
          <span className="font-headline font-bold uppercase">{fightStyle}</span>
          <span className="h-4 w-px bg-outline-variant/30" />
          <span className="font-mono tabular-nums">{fightLengthLabel}</span>
          <span className="h-4 w-px bg-outline-variant/30" />
          <span className="font-mono tabular-nums">
            {targetCount} {targetCount === 1 ? t('config.boss') : t('config.bosses')}
          </span>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={onToggleDrawer}
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-xs font-bold uppercase tracking-widest transition-all ${
            drawerOpen
              ? 'bg-primary/10 text-primary'
              : 'text-on-surface-variant hover:bg-surface-container-high hover:text-primary'
          }`}
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="2" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
          </svg>
          {drawerOpen ? t('common.close') : t('common.options')}
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || submitting}
          className="flex items-center gap-3 rounded-lg bg-gradient-to-r from-primary to-primary-container px-12 py-4 font-headline text-sm font-black uppercase tracking-widest text-on-primary shadow-[0_4px_20px_rgba(200,153,42,0.3)] transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
        >
          {submitting ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
                <path
                  d="M14 8a6 6 0 00-6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {t('config.running')}
            </>
          ) : (
            buttonLabel
          )}
        </button>
      </div>
    </div>
  );
}
