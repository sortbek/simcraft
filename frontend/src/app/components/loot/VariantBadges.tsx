import { useLanguage } from '../../lib/i18n';
import Pill from '../ui/Pill';

/** Void Forged / Catalyst pills shown next to a drop's item name. Accepts any
 *  item carrying the variant markers (Drop Finder `DropItem` or roster `ReportItem`). */
export default function VariantBadges({
  item,
}: {
  item: {
    is_void_forge?: boolean;
    is_catalyst?: boolean;
    owned?: boolean;
    from_tier_token?: boolean;
  };
}) {
  const { t } = useLanguage();
  return (
    <>
      {item.is_void_forge && <Pill variant="epic">{t('loot.voidforged')}</Pill>}
      {item.owned && <Pill>{t('loot.alreadyOwned')}</Pill>}
      {item.is_catalyst && <Pill variant="info">{t('loot.catalyst')}</Pill>}
      {item.from_tier_token && (
        <span title={t('loot.tierTokenReason')}>
          <Pill variant="gold">{t('loot.tierToken')}</Pill>
        </span>
      )}
    </>
  );
}
