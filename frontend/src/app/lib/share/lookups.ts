import * as overview from '../../components/gear/gearOverviewUtils';
import * as topGear from '../../components/gear/topGearResultsUtils';
import { spellIconNames } from '../../components/results/useSpellIcons';
import { isGearComparisonResult, type SimResult } from '../simResultTypes';
import { decodeHeader } from '../talentDecode';
import { type ItemLookups, primeItemLookups, snapshotItemLookups } from '../useItemInfo';
import { cachedTalentTree, primeTalentTrees, type TalentTreeData } from '../useTalentTree';

export interface ShareLookups extends ItemLookups {
  talentTrees?: Record<number, TalentTreeData>;
}

function specIdOf(talentString?: string): number | null {
  if (!talentString) return null;
  try {
    return decodeHeader(talentString).specId;
  } catch {
    return null;
  }
}

/** Display data the shared report needs, taken from what the open report already loaded. */
export function collectShareLookups(result: SimResult): ShareLookups {
  const [items, enchants, gems] = isGearComparisonResult(result)
    ? [
        topGear.collectItemQueries(result.results, result.equipped_gear),
        topGear.collectEnchantIds(result.results, result.equipped_gear),
        topGear.collectGemIds(result.results, result.equipped_gear),
      ]
    : [
        overview.collectItemQueries(result.equipped_gear ?? {}),
        overview.collectEnchantIds(result.equipped_gear ?? {}),
        overview.collectGemIds(result.equipped_gear ?? {}),
      ];
  const specId = specIdOf(result.talent_string);
  const tree = specId != null ? cachedTalentTree(specId) : undefined;
  const talentIcons = tree
    ? [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes].flatMap((n) =>
        n.entries.map((e) => e.icon)
      )
    : [];
  const setupIcons = Object.values(result.setup?.consumables ?? {}).map((c) => c?.icon);
  return {
    ...snapshotItemLookups(items, enchants, gems, [
      ...talentIcons,
      ...spellIconNames(),
      ...setupIcons,
    ]),
    ...(tree && specId != null ? { talentTrees: { [specId]: tree } } : {}),
  };
}

export function primeShareLookups(l: ShareLookups): void {
  primeItemLookups(l);
  primeTalentTrees(l.talentTrees ?? {});
}
