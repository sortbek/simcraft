'use client';

import { useLanguage } from '../../lib/i18n';
import { useEditShared } from '../../lib/share/useEditShared';
import Button from '../ui/Button';

/** Shown while a shared sim is loaded in place of the viewer's own setup. */
export default function SharedEditBanner() {
  const { t } = useLanguage();
  const { active, restore, dismiss } = useEditShared();
  if (!active) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gold-edge bg-gold-tint px-7 py-2.5">
      <p className="min-w-0 flex-1 text-sm text-on-surface">
        {t('shared.editingBanner', { character: active.playerName })}
      </p>
      <Button size="sm" onClick={restore}>
        {t('shared.restoreOwn')}
      </Button>
      <Button size="sm" variant="text" onClick={dismiss} title={t('shared.keepSharedHint')}>
        {t('shared.keepShared')}
      </Button>
    </div>
  );
}
