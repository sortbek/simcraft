'use client';

import { useMemo } from 'react';
import TalentTree from './TalentTree';
import { SummaryCells, TreeToggleCell, useTreeOpen } from './TalentSummaryRow';
import { decodeHeader } from '../../lib/talentDecode';
import { decodeSelections, summarizeBuild } from '../../lib/talentSummary';
import { useTalentTree } from '../../lib/useTalentTree';
import { useLanguage } from '../../lib/i18n';

/** A sim result's talents: the summary row the sim pages use, without the build
 *  picker, and the full tree on demand. */
export default function TalentBuildCard({ talentString }: { talentString: string }) {
  const { t } = useLanguage();
  const specId = useMemo(() => {
    try {
      return decodeHeader(talentString).specId;
    } catch {
      return null;
    }
  }, [talentString]);
  const tree = useTalentTree(specId);
  const summary = useMemo(() => {
    const sel = tree ? decodeSelections(talentString, tree) : null;
    return sel && tree ? summarizeBuild(sel, tree) : null;
  }, [talentString, tree]);
  const [open, setOpen] = useTreeOpen();

  if (!tree || !summary) return null;

  return (
    <section className="card">
      <div className="talent-summary">
        <div className="talent-summary-cell">
          <span className="lbl">{t('config.talents')}</span>
          <span className="flex min-h-[38px] items-center text-[13.5px] font-semibold text-on-surface">
            {tree.specName} {tree.className}
          </span>
        </div>
        <SummaryCells summary={summary} />
        <TreeToggleCell open={open} onToggle={() => setOpen(!open)} />
      </div>
      {open && (
        <div className="border-t border-line/[0.06] p-4">
          <TalentTree talentString={talentString} />
        </div>
      )}
    </section>
  );
}
