'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSimContext } from './SimContext';
import { useLanguage } from '../../lib/i18n';
import { DEFAULT_PROFILE_DATA, RAID_BUFF_LIST } from '../../lib/sim-config-defaults';
import type { ReactNode } from 'react';
import { PROFILE_SECTION_FIELDS, type ProfileSection } from '../../lib/profile-sections';
import { buttonClass } from '../ui/Button';
import ActiveRouteIndicator from './ActiveRouteIndicator';
import AdvancedSettings from './AdvancedSettings';
import ConsumablePickers, { ConsumableIconStrip } from './ConsumablePickers';
import FightSettings from './FightSettings';
import { FIGHT_STYLES } from './FightStyleSelector';
import ProfileMenu, { useProfileActions, type ProfileMenuMode } from './ProfileMenu';
import RaidBuffToggles from './RaidBuffToggles';
import { COLUMN_TITLE, formatFightLength } from './settingsUi';
import { scrollRoot } from '../../lib/scrollRoot';

const OPEN_KEY = 'simhammer_sim_settings_open';
/** Dispatched by the footer's "Edit settings" to open and reveal the block. */
export const OPEN_SIM_SETTINGS_EVENT = 'simhammer:open-sim-settings';

/** Short texts describing the shared config, for the collapsed header and the footer. */
export function useSimSettingsSummary() {
  const { t } = useLanguage();
  const ctx = useSimContext();
  const {
    fightStyle,
    fightLength,
    targetCount,
    isDungeonRoute,
    activeRoute,
    consumables,
    raidBuffs,
  } = ctx;
  const style = FIGHT_STYLES.find((f) => f.value === fightStyle);
  const fight =
    isDungeonRoute && activeRoute?.name
      ? activeRoute.name
      : [
          style ? t(style.labelKey) : fightStyle,
          ...(isDungeonRoute
            ? []
            : [
                formatFightLength(fightLength),
                `${targetCount} ${targetCount === 1 ? t('config.boss') : t('config.bosses')}`,
              ]),
        ].join(' · ');
  const values = Object.values(consumables);
  const consumablesSet = values.filter((v) => v && v !== 'disabled').length;
  const consumablesOff = values.filter((v) => v === 'disabled').length;
  const consumablesText =
    [
      consumablesSet ? t('simSettings.consumablesSet', { count: consumablesSet }) : '',
      consumablesOff ? t('simSettings.consumablesOff', { count: consumablesOff }) : '',
    ]
      .filter(Boolean)
      .join(' · ') || t('simSettings.auto');
  const buffsOn = RAID_BUFF_LIST.filter(({ key }) => raidBuffs[key]).length;
  // Every Advanced field is a primitive with the same name in the context.
  const live = ctx as unknown as Record<string, unknown>;
  const advancedCustom = PROFILE_SECTION_FIELDS.advanced.some(
    (field) => live[field] !== DEFAULT_PROFILE_DATA[field]
  );
  return {
    fight,
    consumables: consumablesText,
    buffs: t('simSettings.buffsShort', { on: buffsOn, total: RAID_BUFF_LIST.length }),
    buffsCount: `${buffsOn}/${RAID_BUFF_LIST.length}`,
    advancedCustom,
  };
}

const Chevron = ({ up }: { up: boolean }) => (
  <svg
    className="h-3.5 w-3.5"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} />
  </svg>
);

/** The shared sim config as one block on every sim page: fight, consumables,
 *  raid buffs and an Advanced fold-out, with the active profile and its save
 *  state in the header. Replaces the footer's options drawer. */
export default function SimSettingsBlock() {
  const { t } = useLanguage();
  const { activeProfile, profileDirty, profileDirtySections, raidBuffs } = useSimContext();
  const summary = useSimSettingsSummary();
  const actions = useProfileActions();
  const [open, setOpen] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMode, setMenuMode] = useState<ProfileMenuMode>('list');
  const rootRef = useRef<HTMLElement>(null);

  // Read after mount: the server render has no localStorage, and reading it in
  // the initializer would hydrate a different tree than the server sent.
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === 'false') setOpen(false);
    } catch {}
  }, []);

  // Viewport offset of the block when its toggle was clicked. Restored after
  // the change, so the block stays put while what is below it moves: without
  // this, scroll anchoring can shift the page and the block jumps.
  const keepTopRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const before = keepTopRef.current;
    keepTopRef.current = null;
    const el = rootRef.current;
    if (before == null || !el) return;
    const restore = () => {
      const delta = el.getBoundingClientRect().top - before;
      if (Math.abs(delta) > 0.5) scrollRoot().scrollBy(0, delta);
    };
    restore();
    // Scroll anchoring may still adjust after layout; settle once more.
    requestAnimationFrame(restore);
  }, [open]);

  const changeOpen = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, String(next));
    } catch {}
  }, []);

  useEffect(() => {
    const reveal = () => {
      changeOpen(true);
      requestAnimationFrame(() =>
        rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      );
    };
    window.addEventListener(OPEN_SIM_SETTINGS_EVENT, reveal);
    return () => window.removeEventListener(OPEN_SIM_SETTINGS_EVENT, reveal);
  }, [changeOpen]);

  const dot = (section: ProfileSection) =>
    profileDirtySections.includes(section) && (
      <span
        title={t('profiles.edited')}
        className="inline-block h-1.5 w-1.5 rounded-full bg-gold-fill"
      />
    );

  const openSaveAs = () => {
    setMenuMode('saveAs');
    setMenuOpen(true);
  };

  let status = null;
  if (activeProfile && profileDirty) {
    status = (
      <>
        <span className="flex items-center gap-1.5 text-xs font-bold text-gold">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-fill" />
          <span className="sim-settings-hide-sm">{t('simSettings.unsaved')}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {actions.isBuiltin ? (
            <button
              type="button"
              onClick={openSaveAs}
              title={t('profiles.defaultSaveHint')}
              className={buttonClass('gold', 'sm')}
            >
              {t('profiles.saveAsNew')}
            </button>
          ) : (
            <button
              type="button"
              onClick={actions.save}
              disabled={!actions.canSave}
              className={buttonClass('gold', 'sm')}
            >
              {t('profiles.save')}
            </button>
          )}
          <button
            type="button"
            onClick={actions.revert}
            title={t('profiles.revert')}
            className={buttonClass('quiet', 'sm')}
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 4L2 7l3 3M2.5 7H10a3.5 3.5 0 0 1 0 7H7" />
            </svg>
            <span className="sim-settings-hide-sm">{t('profiles.revertShort')}</span>
          </button>
        </span>
      </>
    );
  } else if (activeProfile && actions.justSaved) {
    // Only right after a save: shown permanently, "Saved" read as a stuck
    // confirmation when nothing had been saved.
    status = (
      <span className="flex items-center gap-1.5 text-xs font-bold text-outline">
        <svg
          className="h-3 w-3 text-positive"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
        <span className="sim-settings-hide-sm">{t('simSettings.saved')}</span>
      </span>
    );
  }

  const summaryItems: { label: string; value: ReactNode; section: ProfileSection }[] = [
    { label: t('simSettings.fight'), value: summary.fight, section: 'fight' },
    {
      label: t('config.consumables'),
      value: (
        <>
          <ConsumableIconStrip />
          <span className="ml-1.5">{summary.consumables}</span>
        </>
      ),
      section: 'buffs',
    },
    {
      label: t('config.raidBuffs'),
      value: (
        <>
          <span className="mr-1.5 flex gap-[2px]">
            {RAID_BUFF_LIST.map(({ key }) => (
              <span
                key={key}
                className={`h-3 w-[5px] rounded-[2px] ${raidBuffs[key] ? 'bg-gold-fill' : 'bg-surface-container-highest'}`}
              />
            ))}
          </span>
          {summary.buffsCount}
        </>
      ),
      section: 'buffs',
    },
    {
      label: t('simSettings.advanced'),
      value: summary.advancedCustom ? t('simSettings.custom') : t('simSettings.default'),
      section: 'advanced',
    },
  ];

  return (
    <section
      ref={rootRef}
      id="sim-settings"
      aria-label={t('simSettings.title')}
      className={`card sim-settings scroll-mt-24 ${profileDirty ? '!border-gold/35' : ''}`}
    >
      <div
        className={`flex items-start gap-3 rounded-t-[10px] py-2.5 pl-5 pr-3 ${
          profileDirty ? 'bg-gradient-to-r from-gold/[0.06] to-transparent to-70%' : ''
        }`}
      >
        {/* Wraps on its own so the collapse toggle stays pinned top-right. Every
            item on the title line is the same fixed height, so the line is
            equally tall open or collapsed and nothing on it moves when the
            summary appears; narrow, the summary wraps to its own line. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="h-card">{t('simSettings.title')}</h2>
            <ProfileMenu
              open={menuOpen}
              onOpenChange={setMenuOpen}
              mode={menuMode}
              onModeChange={setMenuMode}
              actions={actions}
            />
            {status}
            {actions.error && (
              <span role="alert" className="text-xs font-semibold text-negative">
                {actions.error}
              </span>
            )}
          </div>
          {!open && (
            <div className="sim-settings-summary">
              {summaryItems.map((item) => (
                <div key={item.label} className="sim-settings-summary-item">
                  <span className="lbl flex items-center gap-1.5">
                    {item.label}
                    {dot(item.section)}
                  </span>
                  <b className="flex min-w-0 items-center truncate font-headline text-[13px] font-extrabold text-on-surface">
                    {item.value}
                  </b>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            keepTopRef.current = rootRef.current?.getBoundingClientRect().top ?? null;
            changeOpen(!open);
          }}
          aria-expanded={open}
          aria-label={open ? t('simSettings.collapse') : t('simSettings.expand')}
          className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-line/[0.11] text-on-surface-variant transition-colors hover:border-line/20 hover:text-on-surface"
        >
          <Chevron up={open} />
        </button>
      </div>

      {open && (
        <>
          <div className="border-t border-line/[0.06] px-5 py-4 empty:hidden">
            <ActiveRouteIndicator />
          </div>
          <div className="sim-settings-grid">
            <div className="sim-settings-col sim-settings-fight">
              <h3 className={COLUMN_TITLE}>
                {t('simSettings.fight')}
                {dot('fight')}
              </h3>
              <FightSettings />
            </div>
            <div className="sim-settings-col sim-settings-cons">
              <h3 className={COLUMN_TITLE}>
                {t('config.consumables')}
                {dot('buffs')}
              </h3>
              <ConsumablePickers />
            </div>
            <div className="sim-settings-col sim-settings-buffs">
              <h3 className={COLUMN_TITLE}>
                {t('config.raidBuffs')}
                {dot('buffs')}
              </h3>
              <RaidBuffToggles />
            </div>
          </div>
          <div className="border-t border-line/[0.06]">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              aria-expanded={advancedOpen}
              className="flex h-11 w-full items-center gap-2 px-5 text-left font-headline text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-outline transition-colors hover:text-on-surface"
            >
              <Chevron up={advancedOpen} />
              {t('simSettings.advanced')}
              {dot('advanced')}
              <span className="sim-settings-hide-sm ml-1.5 font-sans text-xs font-medium normal-case tracking-normal">
                {t('simSettings.advancedHint')}
              </span>
            </button>
            {advancedOpen && (
              <div className="px-5 pb-5 pt-1">
                <AdvancedSettings />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
