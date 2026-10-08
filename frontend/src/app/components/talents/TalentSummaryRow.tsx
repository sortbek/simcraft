'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { buttonClass } from '../ui/Button';
import { HeroIcon } from './BuildPicker';
import { useLanguage } from '../../lib/i18n';
import { readStoredJson } from '../../lib/storage';
import { useWowheadTooltips } from '../../lib/useWowheadTooltips';
import type { BuildSummary } from '../../lib/talentSummary';

const TREE_OPEN_KEY = 'simhammer_talent_tree_open';

/** Whether the full tree is open, remembered per page (a result's id doesn't
 *  count as its own page); closed until opened. */
export function useTreeOpen(): [boolean, (open: boolean) => void] {
  const page = `/${usePathname().split('/')[1] ?? ''}`;
  const key = `${TREE_OPEN_KEY}:${page}`;
  const [open, setOpenState] = useState(false);
  useEffect(() => setOpenState(readStoredJson<boolean>(key, false) === true), [key]);
  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState(value);
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },
    [key]
  );
  return [open, setOpen];
}

/** The hero, choices & capstones and points cells of a talent summary row. */
export function SummaryCells({ summary }: { summary: BuildSummary }) {
  const { t } = useLanguage();
  useWowheadTooltips([summary]);
  return (
    <>
      <div className="talent-summary-cell">
        <span className="lbl">{t('talent.hero')}</span>
        <span className="flex min-h-[38px] items-center gap-2 text-[13.5px] font-semibold text-on-surface">
          <HeroIcon icon={summary.heroIcon} className="h-6 w-6" />
          {summary.heroName ?? '—'}
        </span>
      </div>
      <div className="talent-summary-cell talent-summary-highlights">
        <span className="lbl">{t('talent.choicesCapstones')}</span>
        <span className="flex min-h-[38px] flex-wrap items-center gap-1">
          {summary.highlights.map(({ node, entry }) => (
            <a
              key={node.id}
              href={`https://www.wowhead.com/spell=${entry.spellId}`}
              data-wowhead={entry.spellId ? `spell=${entry.spellId}` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.preventDefault()}
              aria-label={entry.name}
            >
              <HeroIcon icon={entry.icon} className="h-6 w-6 border-[1.5px] border-gold-edge" />
            </a>
          ))}
        </span>
      </div>
      <div className="talent-summary-cell talent-summary-points">
        <span className="lbl">{t('talent.points')}</span>
        <span className="flex min-h-[38px] items-center font-headline text-[13.5px] font-extrabold tabular-nums text-on-surface">
          {summary.points.class} · {summary.points.spec} · {summary.points.hero}
        </span>
      </div>
    </>
  );
}

/** The View tree / Hide tree cell that ends a talent summary row. */
export function TreeToggleCell({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="talent-summary-cell talent-summary-toggle">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={buttonClass(open ? 'gold' : 'quiet')}
      >
        {open ? t('talent.hideTree') : t('talent.viewTree')}
      </button>
    </div>
  );
}
