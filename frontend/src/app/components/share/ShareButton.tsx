'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../lib/i18n';
import type { SimResult } from '../../lib/simResultTypes';
import { shareSim, unshareSim } from '../../lib/share/api';
import { shareUrl } from '../../lib/share/link';
import { collectShareLookups } from '../../lib/share/lookups';
import { buildShareSummary, simcBuildOf } from '../../lib/share/summary';
import { usePopupDismissal } from '../loot/usePopupDismissal';
import { buttonClass } from '../ui/Button';
import Pill from '../ui/Pill';

// Visuals only — position comes from the portal wrapper's inline style (see `pos` below),
// since this panel is portaled to <body> to escape DpsHeroCard's overflow-hidden.
const PANEL = 'popover w-[min(360px,calc(100vw-32px))] p-4 text-left';
const HEAD =
  'mb-3.5 flex items-center justify-between gap-3 border-b border-line/[0.06] pb-3 h-card leading-none';
const DOT =
  'h-[7px] w-[7px] rounded-full bg-positive shadow-[0_0_0_3px_rgb(var(--c-positive)/0.15)]';

const COPIED_MS = 1600;

export default function ShareButton({
  jobId,
  result,
  shareId,
  onChange,
}: {
  jobId: string;
  result: SimResult;
  shareId: string | null;
  onChange: (shareId: string | null) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const [selectPending, setSelectPending] = useState(false);

  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const resetTransient = () => {
    setConfirming(false);
    setConfirmError('');
    setError('');
    setCopied(false);
    setCopyHint('');
    setSelectPending(false);
    clearTimeout(copiedTimer.current);
  };

  const closePanel = () => {
    setOpen(false);
    resetTransient();
  };

  usePopupDismissal(open, closePanel, containerRef, panelRef, triggerRef);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // The link input only exists once the shared view has rendered, which may be
  // after the clipboard write rejects (onChange's state update hasn't committed
  // yet). Defer the select-and-hint until the ref is actually there instead of
  // claiming the link is selected when `.select()` was a no-op.
  useEffect(() => {
    if (!selectPending || !linkInputRef.current) return;
    linkInputRef.current.select();
    setCopyHint(t('share.copyHint'));
    setSelectPending(false);
  }, [selectPending, shareId, t]);

  // Right-aligned under the control, 8px below it. Recomputed on open and while
  // open on scroll/resize, since the panel is fixed-position and portaled to
  // <body> (DpsHeroCard's section clips absolutely-positioned descendants).
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const toggleOpen = () => {
    if (open) {
      closePanel();
    } else {
      resetTransient();
      setOpen(true);
    }
  };

  const copy = async (id: string) => {
    setCopyHint('');
    try {
      await navigator.clipboard.writeText(shareUrl(id));
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setSelectPending(true);
    }
  };

  const doShare = async () => {
    setBusy(true);
    setError('');
    try {
      const id = await shareSim(
        jobId,
        buildShareSummary(result),
        simcBuildOf(result),
        collectShareLookups(result)
      );
      onChange(id);
      await copy(id);
    } catch (e) {
      setError(t('share.failed', { reason: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const doStop = async () => {
    setBusy(true);
    setConfirmError('');
    try {
      await unshareSim(jobId);
      onChange(null);
      closePanel();
    } catch (e) {
      setConfirmError(
        t('share.stopFailed', { reason: e instanceof Error ? e.message : String(e) })
      );
    } finally {
      setBusy(false);
    }
  };

  const panel = shareId ? (
    <>
      <h3 className={HEAD}>
        {t('share.title')}
        <Pill variant="positive">
          <span className="h-[5px] w-[5px] rounded-full bg-positive" />
          {t('share.shared')}
        </Pill>
      </h3>
      <div className="flex gap-2">
        <input
          ref={linkInputRef}
          readOnly
          value={shareUrl(shareId).replace(/^https?:\/\//, '')}
          aria-label={t('share.linkAriaLabel')}
          className="h-9 min-w-0 flex-1 rounded-[6px] border border-line/[0.06] bg-background px-3 font-mono text-[12.5px] text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
        <button onClick={() => copy(shareId)} className={`${buttonClass('solid')} shrink-0`}>
          {copied ? (
            `✓ ${t('share.copied')}`
          ) : (
            <>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
                <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
              </svg>
              {t('share.copy')}
            </>
          )}
        </button>
      </div>
      {copyHint && <p className="mt-2 text-xs text-outline">{copyHint}</p>}
      <a
        href={shareUrl(shareId)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1.5 font-headline text-[12.5px] font-bold text-gold hover:text-gold-light"
      >
        {t('share.openLink')}
      </a>
      {confirming ? (
        <div className="mt-3.5 rounded-[6px] border border-negative/25 bg-negative/[0.08] p-3">
          <p className="mb-2.5 text-[13px] text-on-surface-variant">{t('share.removeConfirm')}</p>
          {confirmError && <p className="mb-2.5 text-[13px] text-negative">{confirmError}</p>}
          <div className="flex justify-end gap-2">
            <button
              className={buttonClass('text', 'sm')}
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setConfirmError('');
              }}
            >
              {t('common.cancel')}
            </button>
            <button className={buttonClass('danger', 'sm')} disabled={busy} onClick={doStop}>
              {t('share.removeLink')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-line/[0.06] pt-3">
          <p className="text-xs leading-[1.45] text-outline">
            {t('share.footerViewers')}
            <br />
            {t('share.footerExpiry')}
          </p>
          <button className={buttonClass('danger', 'sm')} onClick={() => setConfirming(true)}>
            {t('share.stop')}
          </button>
        </div>
      )}
    </>
  ) : (
    <>
      <h3 className={HEAD}>{t('share.title')}</h3>
      <p className="mb-3.5 text-[13px] text-on-surface-variant">{t('share.confirmBody')}</p>
      {error && <p className="-mt-1 mb-3 text-[13px] text-negative">{error}</p>}
      <button className={`${buttonClass('solid')} w-full`} disabled={busy} onClick={doShare}>
        {busy ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-on-primary/35 border-t-on-primary" />
            {t('share.creatingLink')}
          </>
        ) : (
          t('share.createLink')
        )}
      </button>
    </>
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${buttonClass('gold')} aria-expanded:border-gold/55 aria-expanded:bg-gold/20`}
        onClick={toggleOpen}
      >
        {shareId ? (
          <>
            <span className={DOT} />
            {t('share.shared')}
          </>
        ) : (
          <>
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M13 4.5a2.5 2.5 0 1 1 .702 1.737L6.97 9.604a2.518 2.518 0 0 1 0 .792l6.733 3.367a2.5 2.5 0 1 1-.671 1.341l-6.733-3.367a2.5 2.5 0 1 1 0-3.475l6.733-3.366A2.52 2.52 0 0 1 13 4.5Z" />
            </svg>
            {t('share.share')}
          </>
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-30"
          >
            <div role="dialog" aria-label={t('share.title')} className={PANEL}>
              {panel}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
