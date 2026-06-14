'use client';

import { useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { T } from './routeTheme';
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
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        padding: '8px 10px 8px 15px',
        borderRadius: 9,
        background: 'rgba(20,20,20,0.92)',
        backdropFilter: 'blur(10px)',
        border: `1px solid ${mode === 'delete' ? 'rgba(224,82,74,0.5)' : T.goldBord}`,
        boxShadow: '0 6px 22px rgba(0,0,0,0.5)',
      }}
    >
      <span style={{ display: 'flex', color: mode === 'delete' ? T.red : T.gold }}>{icon}</span>
      <span style={{ fontSize: 11.5, color: T.text }}>{txt}</span>
      <button
        type="button"
        onClick={onDone}
        style={{
          padding: '4px 11px',
          borderRadius: 6,
          fontFamily: 'inherit',
          fontSize: 10.5,
          fontWeight: 700,
          background: T.gold,
          color: '#141414',
          border: 'none',
          cursor: 'pointer',
          letterSpacing: '0.04em',
        }}
      >
        {mode === 'draw' ? t('route.banner.makePull') : t('route.banner.done')}
      </button>
    </div>
  );
}

export function Toast({ msg }: { msg: string }) {
  return (
    <>
      <style>{`@keyframes routeToastIn{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
      <div
        style={{
          position: 'absolute',
          bottom: 22,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '10px 16px',
          borderRadius: 9,
          background: 'rgba(26,26,26,0.96)',
          border: `1px solid ${T.goldBord}`,
          boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
          animation: 'routeToastIn .25s ease',
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: T.gold,
            color: '#141414',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          ✓
        </span>
        <span style={{ fontSize: 11.5, color: T.text }}>{msg}</span>
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
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          background: T.panel,
          border: `1px solid ${T.borderHi}`,
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '17px 20px 14px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ color: T.gold, display: 'flex' }}>
              <ISave s={15} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
              {t('route.save.title')}
            </span>
          </div>
        </div>
        <div style={{ padding: '18px 20px' }}>
          <label
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: T.muted,
            }}
          >
            {t('route.save.nameLabel')}
          </label>
          <input
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onSave(name.trim());
            }}
            style={{
              width: '100%',
              marginTop: 7,
              padding: '9px 12px',
              borderRadius: 7,
              background: T.surface,
              border: `1px solid ${T.borderHi}`,
              color: T.text,
              fontSize: 12.5,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 14, fontSize: 10.5, color: T.muted }}>
            <span>
              {dungeonName} +{keystoneLevel}
            </span>
            <span style={{ color: T.dim }}>·</span>
            <span>{t('route.row.pulls', { count: pullCount })}</span>
            <span style={{ color: T.dim }}>·</span>
            <span>{t('route.row.enemies', { count: enemyCount })}</span>
          </div>
        </div>
        <div
          style={{ display: 'flex', justifyContent: 'flex-end', gap: 9, padding: '0 20px 18px' }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 7,
              fontFamily: 'inherit',
              fontSize: 11.5,
              fontWeight: 600,
              background: 'transparent',
              border: `1px solid ${T.borderHi}`,
              color: T.text2,
              cursor: 'pointer',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => name.trim() && onSave(name.trim())}
            style={{
              padding: '8px 18px',
              borderRadius: 7,
              fontFamily: 'inherit',
              fontSize: 11.5,
              fontWeight: 700,
              background: T.gold,
              border: 'none',
              color: '#141414',
              cursor: 'pointer',
            }}
          >
            {t('route.save.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
