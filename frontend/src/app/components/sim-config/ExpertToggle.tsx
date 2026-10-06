'use client';

import { useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import Pill from '../ui/Pill';
import Switch from '../ui/Switch';
import { TABS_TRACK, tabClass } from '../ui/ToggleButtonGroup';

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
  embedded = false,
}: {
  hasContent: boolean;
  activeTab: ExpertTabKey;
  setActiveTab: (v: ExpertTabKey) => void;
  expertValues: Record<ExpertTabKey, string>;
  expertSetters: Record<ExpertTabKey, (v: string) => void>;
  activeTabInfo: (typeof EXPERT_TABS)[number];
  children?: React.ReactNode;
  /** Skip the collapsible toggle and render the panel directly — used when this
   *  lives in its own dedicated tab rather than inline. */
  embedded?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(hasContent);

  return (
    <div className={embedded ? 'space-y-3' : 'space-y-3 border-t border-line/[0.06] pt-3'}>
      {!embedded && (
        <label className="flex cursor-pointer items-center gap-2.5">
          <Switch checked={open} onChange={setOpen} aria-expanded={open} />
          <span className="text-sm font-medium text-on-surface-variant">
            {t('config.expertMode')}
          </span>
          {!open && hasContent && <Pill variant="gold">{t('config.modified')}</Pill>}
        </label>
      )}
      {(embedded || open) && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <div className={TABS_TRACK}>
              {EXPERT_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  aria-pressed={activeTab === tab.key}
                  className={`whitespace-nowrap ${tabClass(activeTab === tab.key)}`}
                >
                  {t(tab.labelKey)}
                  {expertValues[tab.key].trim() && activeTab !== tab.key && (
                    <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-fill align-middle" />
                  )}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={expertValues[activeTab]}
            onChange={(e) => expertSetters[activeTab](e.target.value)}
            placeholder={t('config.pasteSimcTab', {
              label: t(activeTabInfo.labelKey).toLowerCase(),
            })}
            className="input-field h-32 resize-y font-mono text-xs"
          />
          <p className="text-[13px] text-outline">{t(activeTabInfo.descKey)}</p>
          {children}
        </div>
      )}
    </div>
  );
}

export { EXPERT_TABS };
