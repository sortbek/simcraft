import type { QuickSelectEntry } from './topGearSelection';

interface TopGearQuickSelectBarProps {
  vaultUids: QuickSelectEntry[];
  lootUids: QuickSelectEntry[];
  catalystUids: QuickSelectEntry[];
  selectedUids: Record<string, Set<string>>;
  comboLabel: string;
  comboColorClass: string;
  onToggleGroup: (entries: QuickSelectEntry[]) => void;
  onDeselectAll: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export default function TopGearQuickSelectBar({
  vaultUids,
  lootUids,
  catalystUids,
  selectedUids,
  comboLabel,
  comboColorClass,
  onToggleGroup,
  onDeselectAll,
  t,
}: TopGearQuickSelectBarProps) {
  const hasSelection = Object.values(selectedUids).some((values) => values.size > 0);
  const allVaultSelected =
    vaultUids.length > 0 && vaultUids.every((entry) => selectedUids[entry.slot]?.has(entry.uid));
  const allLootSelected =
    lootUids.length > 0 && lootUids.every((entry) => selectedUids[entry.slot]?.has(entry.uid));
  const allCatalystSelected =
    catalystUids.length > 0 &&
    catalystUids.every((entry) => selectedUids[entry.slot]?.has(entry.uid));

  return (
    <div className="flex items-center gap-1.5">
      {vaultUids.length > 0 && (
        <button
          type="button"
          onClick={() => onToggleGroup(vaultUids)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            allVaultSelected
              ? 'bg-amber-400/15 text-amber-300'
              : 'text-amber-400/60 hover:bg-amber-400/10 hover:text-amber-300'
          }`}
        >
          {t('gear.vault')}
        </button>
      )}
      {lootUids.length > 0 && (
        <button
          type="button"
          onClick={() => onToggleGroup(lootUids)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            allLootSelected
              ? 'bg-sky-400/15 text-sky-300'
              : 'text-sky-400/60 hover:bg-sky-400/10 hover:text-sky-300'
          }`}
        >
          Loot
        </button>
      )}
      {catalystUids.length > 0 && (
        <button
          type="button"
          onClick={() => onToggleGroup(catalystUids)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            allCatalystSelected
              ? 'bg-purple-400/15 text-purple-300'
              : 'text-purple-400/60 hover:bg-purple-400/10 hover:text-purple-300'
          }`}
        >
          {t('gear.catalyst')}
        </button>
      )}
      {hasSelection && (
        <button
          type="button"
          onClick={onDeselectAll}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-on-surface-variant/50 transition-colors hover:bg-white/[0.04] hover:text-on-surface"
        >
          {t('common.clear')}
        </button>
      )}
      <span className={`rounded-md px-2.5 py-1 font-mono text-xs ${comboColorClass}`}>
        {comboLabel}
      </span>
    </div>
  );
}
