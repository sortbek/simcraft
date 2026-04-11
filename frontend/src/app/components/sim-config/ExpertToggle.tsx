'use client';

import { useState } from 'react';
import { useLanguage } from '../../lib/i18n';

const EXPERT_TABS = [
  {
    key: 'header',
    labelKey: 'config.headerTab',
    descKey: 'config.headerDesc',
  },
  {
    key: 'base_player',
    labelKey: 'config.basePlayerTab',
    descKey: 'config.basePlayerDesc',
  },
  {
    key: 'raid_actors',
    labelKey: 'config.raidActorsTab',
    descKey: 'config.raidActorsDesc',
  },
  {
    key: 'post_combos',
    labelKey: 'config.postCombosTab',
    descKey: 'config.postCombosDesc',
  },
  {
    key: 'footer',
    labelKey: 'config.footerTab',
    descKey: 'config.footerDesc',
  },
] as const;

export type ExpertTabKey = (typeof EXPERT_TABS)[number]['key'];

export default function ExpertToggle({
  hasContent,
  activeTab,
  setActiveTab,
  expertValues,
  expertSetters,
  activeTabInfo,
  children,
}: {
  hasContent: boolean;
  activeTab: ExpertTabKey;
  setActiveTab: (v: ExpertTabKey) => void;
  expertValues: Record<ExpertTabKey, string>;
  expertSetters: Record<ExpertTabKey, (v: string) => void>;
  activeTabInfo: (typeof EXPERT_TABS)[number];
  children?: React.ReactNode;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(hasContent);

  return (
    <div className="space-y-3 border-t border-outline-variant/10 pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-2.5">
        <div
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            open ? 'bg-gold' : 'bg-surface-container-highest'
          }`}
        >
          <div
            className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
              open ? 'left-[18px] bg-black' : 'left-0.5 bg-on-surface-variant'
            }`}
          />
        </div>
        <span className="text-sm font-medium text-on-surface-variant">{t('config.expertMode')}</span>
        {!open && hasContent && (
          <span className="rounded-md bg-gold/10 px-1.5 py-0.5 text-[12px] font-medium text-gold">
            {t('config.modified')}
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3">
          <div className="flex gap-1 overflow-x-auto">
            {EXPERT_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                  activeTab === tab.key
                    ? 'bg-primary/10 text-primary'
                    : expertValues[tab.key].trim()
                      ? 'bg-primary/[0.06] text-gold hover:bg-primary/10'
                      : 'bg-surface-container-high text-on-surface-variant/60 hover:bg-surface-container-highest hover:text-on-surface-variant'
                }`}
              >
                {t(tab.labelKey)}
                {expertValues[tab.key].trim() && activeTab !== tab.key && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-gold" />
                )}
              </button>
            ))}
          </div>
          <textarea
            value={expertValues[activeTab]}
            onChange={(e) => expertSetters[activeTab](e.target.value)}
            placeholder={t('config.pasteSimcTab', { label: t(activeTabInfo.labelKey).toLowerCase() })}
            className="input-field h-32 resize-y font-mono text-xs"
          />
          <p className="text-[13px] text-on-surface-variant/40">{t(activeTabInfo.descKey)}</p>
          {children}
        </div>
      )}
    </div>
  );
}

export { EXPERT_TABS };
