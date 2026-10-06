import type { QuickSelectEntry } from './topGearSelection';

interface TopGearQuickSelectBarProps {
  vaultUids: QuickSelectEntry[];
  lootUids: QuickSelectEntry[];
  catalystUids: QuickSelectEntry[];
  selectedUids: Record<string, Set<string>>;
  onToggleGroup: (entries: QuickSelectEntry[]) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export default function TopGearQuickSelectBar({
  vaultUids,
  lootUids,
  catalystUids,
  selectedUids,
  onToggleGroup,
  t,
}: TopGearQuickSelectBarProps) {
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
          className={`chip ${allVaultSelected ? 'chip-on' : ''}`}
        >
          {t('gear.vault')}
        </button>
      )}
      {lootUids.length > 0 && (
        <button
          type="button"
          onClick={() => onToggleGroup(lootUids)}
          className={`chip ${allLootSelected ? 'chip-on' : ''}`}
        >
          Loot
        </button>
      )}
      {catalystUids.length > 0 && (
        <button
          type="button"
          onClick={() => onToggleGroup(catalystUids)}
          className={`chip ${allCatalystSelected ? 'chip-on' : ''}`}
        >
          {t('gear.catalyst')}
        </button>
      )}
    </div>
  );
}
