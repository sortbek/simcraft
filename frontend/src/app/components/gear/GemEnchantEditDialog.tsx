'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiUrl, fetchJsonOr } from '../../lib/api';
import type { ResolvedItem } from '../../lib/types';
import { localizedItemName, useGemInfo } from '../../lib/useItemInfo';
import { useLanguage } from '../../lib/i18n';
import GearItemRow from './GearItemRow';
import {
  ENCHANT_SLOTS,
  filterDiamonds,
  groupGemsByColor,
  statLabel,
  type GemOption,
  type ItemOption,
} from './itemOptions';

interface GemEnchantEditDialogProps {
  item: ResolvedItem;
  onClose: () => void;
  onConfirm: (gemIds: number[], enchantId: number) => Promise<void> | void;
}

function optionDetails(o: ItemOption): { text: string; color?: string }[] {
  if ((o.quality ?? 0) >= 4 && o.displayName) return [{ text: o.displayName }];
  if (o.stats && o.stats.length > 0) return [{ text: o.stats.map(statLabel).join(', ') }];
  return [];
}

export default function GemEnchantEditDialog({
  item,
  onClose,
  onConfirm,
}: GemEnchantEditDialogProps) {
  const { t, locale } = useLanguage();
  const socketCount = Math.max(item.sockets, item.gem_ids.length);
  const enchantable = ENCHANT_SLOTS.includes(item.slot);

  // gemIds is socket-indexed; 0 = empty socket.
  const [gemIds, setGemIds] = useState<number[]>(() =>
    Array.from({ length: socketCount }, (_, i) => item.gem_ids[i] ?? 0)
  );
  const [enchantId, setEnchantId] = useState(item.enchant_id);
  const [pickerFor, setPickerFor] = useState<number | 'enchant' | null>(null);
  const [gemOptions, setGemOptions] = useState<GemOption[]>([]);
  const [enchantOptions, setEnchantOptions] = useState<ItemOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (socketCount > 0) {
      fetchJsonOr<GemOption[]>(apiUrl('/api/gems?expansion=11'), []).then(setGemOptions);
    }
    if (enchantable) {
      fetchJsonOr<ItemOption[]>(
        apiUrl(`/api/enchants?expansion=11&slot=${encodeURIComponent(item.slot)}`),
        []
      ).then((options) =>
        setEnchantOptions(
          options
            .filter((e) => !e.craftingQuality || e.craftingQuality === 2)
            .sort((a, b) =>
              (a.itemName || a.displayName).localeCompare(b.itemName || b.displayName)
            )
        )
      );
    }
  }, [socketCount, enchantable, item.slot]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const gemInfo = useGemInfo(useMemo(() => [...item.gem_ids, ...gemIds], [item.gem_ids, gemIds]));
  const diamonds = useMemo(() => filterDiamonds(gemOptions), [gemOptions]);
  const gemGroups = useMemo(() => groupGemsByColor(gemOptions), [gemOptions]);

  const chosenGems = gemIds.filter((id) => id > 0);
  const unchanged =
    chosenGems.join('/') === item.gem_ids.join('/') && enchantId === item.enchant_id;

  const currentEnchant = enchantOptions.find((e) => e.id === enchantId);

  const pickGem = (socket: number, gemItemId: number) => {
    setGemIds((prev) => prev.map((g, i) => (i === socket ? gemItemId : g)));
    setPickerFor(null);
  };

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm(chosenGems, enchantId);
    } finally {
      setSaving(false);
    }
  };

  const gemRow = (socket: number) => {
    const gemId = gemIds[socket];
    const info = gemId > 0 ? gemInfo[gemId] : undefined;
    return (
      <div key={socket} className="flex items-center justify-between gap-2 py-1.5">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-widest text-muted">
            {t('gear.socketLabel', { n: socket + 1 })}
          </p>
          <p className="truncate text-[13px] text-on-surface">
            {gemId > 0
              ? localizedItemName(gemId, info?.name || `Gem ${gemId}`, locale)
              : t('gear.emptySocket')}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setPickerFor(pickerFor === socket ? null : socket)}
            className="rounded px-2 py-1 text-[12px] text-gold/80 transition-colors hover:bg-gold/10 hover:text-gold"
          >
            {t('common.change')}
          </button>
          {gemId > 0 && (
            <button
              type="button"
              onClick={() => pickGem(socket, 0)}
              className="rounded px-2 py-1 text-[12px] text-red-300/80 transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      </div>
    );
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-outline-variant/20 bg-surface-container shadow-2xl"
      >
        <div className="border-b border-outline-variant/20 px-5 py-3">
          <p className="text-[11px] uppercase tracking-widest text-muted">
            {t('gear.editGemsEnchant')}
          </p>
          <p className="truncate text-[14px] font-semibold" style={{ color: item.quality_color }}>
            {localizedItemName(item.item_id, item.name, locale)}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {Array.from({ length: socketCount }, (_, i) => gemRow(i))}

          {enchantable && (
            <div className="flex items-center justify-between gap-2 border-t border-outline-variant/10 py-1.5">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-widest text-muted">
                  {t('gear.enchantLabel')}
                </p>
                <p className="truncate text-[13px] text-emerald-400/80">
                  {enchantId > 0
                    ? currentEnchant
                      ? currentEnchant.itemName || currentEnchant.displayName
                      : enchantId === item.enchant_id
                        ? item.enchant_name
                        : `Enchant ${enchantId}`
                    : t('gear.noEnchant')}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => setPickerFor(pickerFor === 'enchant' ? null : 'enchant')}
                  className="rounded px-2 py-1 text-[12px] text-gold/80 transition-colors hover:bg-gold/10 hover:text-gold"
                >
                  {t('common.change')}
                </button>
                {enchantId > 0 && (
                  <button
                    type="button"
                    onClick={() => setEnchantId(0)}
                    className="rounded px-2 py-1 text-[12px] text-red-300/80 transition-colors hover:bg-red-500/10 hover:text-red-300"
                  >
                    {t('common.clear')}
                  </button>
                )}
              </div>
            </div>
          )}

          {typeof pickerFor === 'number' && (
            <div className="mt-1 rounded-lg border border-outline-variant/20 bg-surface p-2">
              {diamonds.length > 0 && (
                <div className="mb-2">
                  {diamonds.map((g) => (
                    <GearItemRow
                      key={g.id}
                      icon={g.itemIcon || ''}
                      name={g.itemName || g.displayName}
                      nameColor="#ff8000"
                      details={optionDetails(g)}
                      selectable
                      checked={gemIds[pickerFor] === g.itemId}
                      onToggle={() => pickGem(pickerFor, g.itemId!)}
                    />
                  ))}
                </div>
              )}
              {gemGroups.map(({ color, gems }) => (
                <div key={color} className="mb-2">
                  {gems.map((g) => (
                    <GearItemRow
                      key={g.id}
                      icon={g.itemIcon || ''}
                      name={g.itemName || g.displayName}
                      nameColor="#0070dd"
                      details={optionDetails(g)}
                      selectable
                      checked={gemIds[pickerFor] === g.itemId}
                      onToggle={() => pickGem(pickerFor, g.itemId!)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {pickerFor === 'enchant' && (
            <div className="mt-1 rounded-lg border border-outline-variant/20 bg-surface p-2">
              {enchantOptions.map((e) => (
                <GearItemRow
                  key={e.id}
                  icon={e.itemIcon || ''}
                  name={e.itemName || e.displayName}
                  nameColor="#1eff00"
                  details={optionDetails(e)}
                  selectable
                  checked={enchantId === e.id}
                  onToggle={() => {
                    setEnchantId(e.id);
                    setPickerFor(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-outline-variant/20 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-[13px] text-on-surface-variant transition-colors hover:bg-white/[0.05]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={unchanged || saving}
            onClick={confirm}
            className="rounded-lg bg-gold/20 px-3 py-1.5 text-[13px] font-semibold text-gold transition-colors hover:bg-gold/30 disabled:cursor-default disabled:opacity-40"
          >
            {t('gear.addAsOption')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
