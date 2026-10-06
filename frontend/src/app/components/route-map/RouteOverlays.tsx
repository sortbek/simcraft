'use client';

import { useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import Button from '../ui/Button';
import CardHeader from '../ui/CardHeader';
import { IPencil, IMerge, ITrash, ISave } from './routeIcons';
import type { EditMode } from './useRouteEditor';

interface ModeBannerProps {
  mode: Exclude<EditMode, 'view'>;
  pickCount: number;
  draftCount: number;
  onDone: () => void;
}
export function ModeBanner({ mode, pickCount, draftCount, onDone }: ModeBannerProps) {
  const { t } = useLanguage();
  const txt =
    mode === 'draw'
      ? t('route.banner.draw', { count: draftCount })
      : mode === 'merge'
        ? pickCount === 0
          ? t('route.banner.mergeEmpty')
          : t('route.banner.mergePick', { count: pickCount, remaining: 2 - pickCount })
        : t('route.banner.delete');
  const icon =
    mode === 'draw' ? <IPencil s={14} /> : mode === 'merge' ? <IMerge s={14} /> : <ITrash s={14} />;
  return (
    <div
      className={`absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-3 rounded-[10px] border bg-popover/[0.92] py-2 pl-4 pr-2.5 shadow-[0_6px_22px_rgb(var(--c-shade)/calc(0.5*var(--c-shade-k)))] backdrop-blur ${
        mode === 'delete' ? 'border-negative/50' : 'border-gold/35'
      }`}
    >
      <span className={`flex ${mode === 'delete' ? 'text-negative' : 'text-gold'}`}>{icon}</span>
      <span className="text-[12px] text-on-surface">{txt}</span>
      <Button variant="solid" size="sm" onClick={onDone}>
        {mode === 'draw' ? t('route.banner.makePull') : t('route.banner.done')}
      </Button>
    </div>
  );
}

export function Toast({ msg }: { msg: string }) {
  return (
    <>
      <style>{`@keyframes routeToastIn{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
      <div
        className="absolute bottom-[22px] left-1/2 z-[60] flex -translate-x-1/2 items-center gap-[9px] rounded-[10px] border border-gold/35 bg-popover/[0.96] px-4 py-2.5 shadow-[0_8px_28px_rgb(var(--c-shade)/calc(0.55*var(--c-shade-k)))]"
        style={{ animation: 'routeToastIn .25s ease' }}
      >
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gold-fill text-[11px] font-extrabold text-on-primary">
          ✓
        </span>
        <span className="text-[12px] text-on-surface">{msg}</span>
      </div>
    </>
  );
}

interface SaveModalProps {
  dungeonName: string;
  keystoneLevel: number;
  pullCount: number;
  enemyCount: number;
  onClose: () => void;
  onSave: (name: string) => void;
}
export function SaveModal({
  dungeonName,
  keystoneLevel,
  pullCount,
  enemyCount,
  onClose,
  onSave,
}: SaveModalProps) {
  const { t } = useLanguage();
  const [name, setName] = useState(`${dungeonName} +${keystoneLevel}`);
  return (
    <div
      onClick={onClose}
      className="absolute inset-0 z-50 flex items-center justify-center bg-shade/60"
    >
      <div onClick={(e) => e.stopPropagation()} className="popover w-[380px] overflow-hidden">
        <CardHeader
          title={
            <span className="flex items-center gap-[9px]">
              <span className="flex text-gold">
                <ISave s={15} />
              </span>
              {t('route.save.title')}
            </span>
          }
        />
        <div className="px-6 py-[18px]">
          <label className="label-text">{t('route.save.nameLabel')}</label>
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onSave(name.trim());
            }}
            className="input-field"
          />
          <div className="mt-3.5 flex gap-2 text-[12px] text-outline">
            <span>
              {dungeonName} +{keystoneLevel}
            </span>
            <span className="text-fg-4">·</span>
            <span>{t('route.row.pulls', { count: pullCount })}</span>
            <span className="text-fg-4">·</span>
            <span>{t('route.row.enemies', { count: enemyCount })}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-[18px]">
          <Button variant="quiet" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="solid" onClick={() => name.trim() && onSave(name.trim())}>
            {t('route.save.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
