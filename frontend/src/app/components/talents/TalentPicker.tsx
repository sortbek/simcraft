'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buttonClass } from '../ui/Button';
import { useSimContext } from '../sim-config/SimContext';
import { parseTalentLoadouts, SPEC_ID_TO_NAME, specDisplayName } from '../../lib/types';
import type { TalentLoadoutParsed } from '../../lib/types';
import { decodeHeader } from '../../lib/talentDecode';
import { encodeTalentString } from '../../lib/talentEncode';
import { useTalentTree } from '../../lib/useTalentTree';
import TalentTree from './TalentTree';
import BuildPicker, {
  displayName,
  HeroIcon,
  type BuildGroup,
  type BuildOption,
} from './BuildPicker';
import TalentChanges from './TalentChanges';
import { SummaryCells, TreeToggleCell, useTreeOpen } from './TalentSummaryRow';
import { getCharacters, getTalentBuilds } from '../../lib/saved-characters';
import { useLanguage } from '../../lib/i18n';
import { decodeSelections, diffBuilds, summarizeBuild } from '../../lib/talentSummary';

/** Header toggle: gold-edged while on, text-only while off. */
const toggleBtn = (on: boolean) => buttonClass(on ? 'gold' : 'text');

/** The page's talent card: a one-row summary of the chosen build (picker, hero
 *  tree, choices and capstones, points) with the full tree on demand. */
export default function TalentPicker({
  compact = false,
  hideCompare = false,
}: {
  compact?: boolean;
  hideCompare?: boolean;
}) {
  const { t } = useLanguage();
  const { simcInput, selectedTalent, setSelectedTalent, talentBuilds, setTalentBuilds } =
    useSimContext();
  const [treeOpen, setTreeOpen] = useTreeOpen();
  const [editing, setEditing] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState('');
  const [customLoadouts, setCustomLoadouts] = useState<TalentLoadoutParsed[]>([]);
  const [savedBuilds, setSavedBuilds] = useState<TalentLoadoutParsed[]>([]);
  const [selectedLoadoutIdx, setSelectedLoadoutIdx] = useState(() => {
    const loadouts = parseTalentLoadouts(simcInput);
    const idx = loadouts.findIndex((l) => l.isActive);
    return idx >= 0 ? idx : 0;
  });

  const addonLoadouts = useMemo(() => parseTalentLoadouts(simcInput), [simcInput]);

  // Fetch saved talent builds for the current character
  useEffect(() => {
    if (!simcInput) {
      setSavedBuilds([]);
      return;
    }
    const nameMatch = simcInput.match(/^\w+="(.+)"$/m);
    const realmMatch = simcInput.match(/^server=(.+)$/m);
    if (!nameMatch || !realmMatch) {
      setSavedBuilds([]);
      return;
    }
    const charName = nameMatch[1];
    const charRealm = realmMatch[1];

    getCharacters().then((chars) => {
      const char = chars.find((c) => c.name === charName && c.realm === charRealm);
      if (!char) {
        setSavedBuilds([]);
        return;
      }
      getTalentBuilds(char.id).then((builds) => {
        // Drop builds already present in the addon loadouts
        const addonStrings = new Set(parseTalentLoadouts(simcInput).map((l) => l.talentString));
        const extra: TalentLoadoutParsed[] = builds
          .filter((b) => !addonStrings.has(b.talent_string))
          .map((b) => ({
            name: `[${specDisplayName(b.spec)}] ${b.name}`,
            talentString: b.talent_string,
            isActive: false,
          }));
        setSavedBuilds(extra);
      });
    });
  }, [simcInput]);

  // Merge addon loadouts + saved builds from DB + custom (imported/blank) loadouts
  const allLoadouts = useMemo(
    () => [...addonLoadouts, ...savedBuilds, ...customLoadouts],
    [addonLoadouts, savedBuilds, customLoadouts]
  );

  const currentTalent = allLoadouts[selectedLoadoutIdx]?.talentString || '';

  useEffect(() => {
    if (allLoadouts.length === 0) {
      if (selectedTalent) setSelectedTalent('');
      return;
    }
    if (currentTalent && selectedTalent !== currentTalent) {
      setSelectedTalent(currentTalent);
    }
  }, [currentTalent, allLoadouts.length, selectedTalent, setSelectedTalent]);

  // Reset custom loadouts when input changes
  useEffect(() => {
    setCustomLoadouts([]);
    const idx = addonLoadouts.findIndex((l) => l.isActive);
    setSelectedLoadoutIdx(idx >= 0 ? idx : 0);
  }, [simcInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const specId = useMemo(() => {
    if (!currentTalent) return null;
    try {
      return decodeHeader(currentTalent).specId;
    } catch {
      return null;
    }
  }, [currentTalent]);

  const tree = useTalentTree(specId);

  // The equipped build's spec: the build list and its change counts are read against it.
  const baseSpecId = useMemo(() => {
    const active = addonLoadouts.find((l) => l.isActive);
    if (!active?.talentString) return null;
    try {
      return decodeHeader(active.talentString).specId;
    } catch {
      return null;
    }
  }, [addonLoadouts]);

  const handleEditorChange = useCallback(
    (s: string) => {
      setSelectedTalent(s);
      // Update the custom loadout's talent string if we're editing one
      const customStartIdx = addonLoadouts.length;
      if (selectedLoadoutIdx >= customStartIdx) {
        const customIdx = selectedLoadoutIdx - customStartIdx;
        setCustomLoadouts((prev) => {
          const next = [...prev];
          next[customIdx] = { ...next[customIdx], talentString: s };
          return next;
        });
      }
    },
    [setSelectedTalent, addonLoadouts.length, selectedLoadoutIdx]
  );

  const addCustomLoadout = useCallback(
    (name: string, talentStr: string) => {
      const newLoadout: TalentLoadoutParsed = {
        name,
        talentString: talentStr,
        isActive: false,
      };
      setCustomLoadouts((prev) => [...prev, newLoadout]);
      const newIdx = addonLoadouts.length + customLoadouts.length;
      setSelectedLoadoutIdx(newIdx);
      setSelectedTalent(talentStr);
    },
    [addonLoadouts.length, customLoadouts.length, setSelectedTalent]
  );

  // Import a talent string (raw hash or wowhead URL)
  const handleImport = useCallback(() => {
    setImportError('');
    let talentStr = importValue.trim();
    if (!talentStr) return;

    // Extract from Wowhead URL
    const wowheadMatch = talentStr.match(/[?&]loadout=([A-Za-z0-9+/]+)/);
    if (wowheadMatch) talentStr = wowheadMatch[1];
    const calcMatch = talentStr.match(/talent-calc\/[^/]+\/[^/]+\/([A-Za-z0-9+/]+)/);
    if (calcMatch) talentStr = calcMatch[1];

    let importedSpecId: number;
    try {
      const header = decodeHeader(talentStr);
      if (!header.specId) throw new Error('Invalid');
      importedSpecId = header.specId;
    } catch {
      setImportError(t('talent.invalidString'));
      return;
    }

    // If imported build is a different spec, prefix the name with the spec
    const importedSpecName = SPEC_ID_TO_NAME[importedSpecId];
    const isDifferentSpec = specId != null && importedSpecId !== specId;
    const prefix =
      isDifferentSpec && importedSpecName ? `${specDisplayName(importedSpecName)} ` : '';
    const name = `${prefix}Import ${customLoadouts.length + 1}`;
    addCustomLoadout(name, talentStr);
    setShowImport(false);
    setImportValue('');
    setTreeOpen(true);
  }, [importValue, customLoadouts.length, addCustomLoadout, specId, t, setTreeOpen]);

  // Start from scratch
  const handleBlankBuild = useCallback(() => {
    if (!specId || !tree) return;
    const blank = encodeTalentString(new Map(), tree, specId);
    const name = `Custom ${customLoadouts.length + 1}`;
    addCustomLoadout(name, blank);
    setEditing(true);
    setTreeOpen(true);
  }, [specId, tree, customLoadouts.length, addCustomLoadout, setTreeOpen]);

  // Track selected indices for compare mode (avoids duplicate talent string issues)
  const [compareIndices, setCompareIndices] = useState<Set<number>>(new Set());

  const toggleCompareLoadout = useCallback((idx: number) => {
    setCompareIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  // Sync talentBuilds from compareIndices
  useEffect(() => {
    if (!compareMode) return;
    // Sort by loadout index, not click order: the backend treats the first
    // build as the "Currently Equipped" baseline, and the equipped loadout is
    // always allLoadouts[0], so ascending order keeps it as the baseline.
    const builds = [...compareIndices]
      .sort((a, b) => a - b)
      .filter((idx) => idx < allLoadouts.length)
      .map((idx) => ({
        name: allLoadouts[idx].name,
        talentString: allLoadouts[idx].talentString,
      }));
    // Deduplicate by talent string — no point simming identical builds twice
    const seen = new Set<string>();
    const unique = builds.filter((b) => {
      if (seen.has(b.talentString)) return false;
      seen.add(b.talentString);
      return true;
    });
    setTalentBuilds(unique);
  }, [compareIndices, compareMode, allLoadouts, setTalentBuilds]);

  // Clear compare state when leaving compare mode
  useEffect(() => {
    if (!compareMode) {
      setTalentBuilds([]);
      setCompareIndices(new Set());
    }
  }, [compareMode, setTalentBuilds]);

  // The equipped build every other build is measured against.
  const equippedTalent = addonLoadouts.find((l) => l.isActive)?.talentString ?? '';
  const baseTree = useTalentTree(baseSpecId);
  const equippedSel = useMemo(
    () => (baseTree && equippedTalent ? decodeSelections(equippedTalent, baseTree) : null),
    [baseTree, equippedTalent]
  );

  const buildOptions = useMemo<BuildOption[]>(() => {
    const groupOf = (i: number, isActive: boolean): BuildGroup =>
      i < addonLoadouts.length
        ? isActive
          ? 'active'
          : 'game'
        : i < addonLoadouts.length + savedBuilds.length
          ? 'saved'
          : 'custom';
    return allLoadouts.map((l, i) => {
      const sel = baseTree ? decodeSelections(l.talentString, baseTree) : null;
      const summary = sel && baseTree ? summarizeBuild(sel, baseTree) : null;
      let specLabel: string | undefined;
      if (baseTree && !sel) {
        try {
          const name = SPEC_ID_TO_NAME[decodeHeader(l.talentString).specId];
          specLabel = name ? specDisplayName(name) : undefined;
        } catch {}
      }
      return {
        index: i,
        name: l.name,
        group: groupOf(i, l.isActive),
        heroName: summary?.heroName,
        heroIcon: summary?.heroIcon,
        specLabel,
        changes:
          sel && equippedSel && baseTree ? diffBuilds(equippedSel, sel, baseTree).count : null,
      };
    });
  }, [allLoadouts, addonLoadouts.length, savedBuilds.length, baseTree, equippedSel]);

  // The chosen build, read against its own spec's tree.
  const shownTalent = (editing && selectedTalent) || currentTalent;
  const currentSel = useMemo(
    () => (tree && shownTalent ? decodeSelections(shownTalent, tree) : null),
    [tree, shownTalent]
  );
  const summary = useMemo(
    () => (currentSel && tree ? summarizeBuild(currentSel, tree) : null),
    [currentSel, tree]
  );
  const diff = useMemo(
    () =>
      currentSel && equippedSel && baseTree && tree?.specId === baseTree.specId
        ? diffBuilds(equippedSel, currentSel, tree)
        : null,
    [currentSel, equippedSel, baseTree, tree]
  );
  const equippedSummary = useMemo(
    () => (equippedSel && baseTree ? summarizeBuild(equippedSel, baseTree) : null),
    [equippedSel, baseTree]
  );
  const isEquipped = !editing && currentTalent === equippedTalent;

  if (allLoadouts.length === 0) return null;

  const selectBuild = (idx: number) => {
    setSelectedLoadoutIdx(idx);
    setSelectedTalent(allLoadouts[idx].talentString);
    setEditing(false);
  };

  const compare = hideCompare
    ? undefined
    : {
        on: compareMode,
        onToggle: (on: boolean) => {
          setCompareMode(on);
          // Start from the build in view, so the picker reads as one build checked.
          if (on) setCompareIndices(new Set([selectedLoadoutIdx]));
        },
        checked: compareIndices,
        onCheck: toggleCompareLoadout,
      };

  // A hovered build in the picker: what it would change against the equipped one.
  const renderPreview = (i: number) => {
    const option = buildOptions[i];
    const sel = baseTree ? decodeSelections(allLoadouts[i].talentString, baseTree) : null;
    const preview = sel && baseTree ? summarizeBuild(sel, baseTree) : null;
    const previewDiff =
      sel && equippedSel && baseTree ? diffBuilds(equippedSel, sel, baseTree) : null;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <HeroIcon icon={preview?.heroIcon} className="h-8 w-8" />
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold text-on-surface">
              {displayName(option.name)}
            </div>
            <div className="text-[11.5px] text-outline">
              {option.specLabel ??
                (preview &&
                  `${preview.heroName ?? ''} · ${preview.points.class} · ${preview.points.spec} · ${preview.points.hero}`)}
            </div>
          </div>
        </div>
        {option.specLabel ? (
          <p className="text-[12.5px] text-outline">{t('talent.otherSpec')}</p>
        ) : (
          <TalentChanges
            diff={previewDiff}
            isEquipped={option.group === 'active'}
            heroFrom={equippedSummary}
            heroTo={preview}
            max={14}
          />
        )}
      </div>
    );
  };

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-1">
      <button onClick={() => setShowImport((v) => !v)} className={toggleBtn(showImport)}>
        {t('talent.import')}
      </button>
      <button onClick={handleBlankBuild} className={buttonClass('text')}>
        {t('talent.new')}
      </button>
      <button onClick={() => setEditing((v) => !v)} className={toggleBtn(editing)}>
        {editing ? t('common.done') : t('talent.edit')}
      </button>
    </div>
  );

  return (
    <div className="card">
      <div className="talent-summary">
        <div className="talent-summary-cell talent-summary-picker">
          <span className="lbl">{t('config.talents')}</span>
          <BuildPicker
            options={buildOptions}
            selected={selectedLoadoutIdx}
            onSelect={selectBuild}
            compare={compare}
            renderPreview={renderPreview}
          />
        </div>
        {summary && <SummaryCells summary={summary} />}
        <TreeToggleCell
          open={treeOpen}
          onToggle={() => {
            setTreeOpen(!treeOpen);
            if (treeOpen) setShowImport(false);
          }}
        />
      </div>

      {treeOpen && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line/[0.06] px-[18px] py-2.5">
          <TalentChanges
            diff={isEquipped ? null : diff}
            isEquipped={isEquipped}
            heroFrom={equippedSummary}
            heroTo={summary}
          />
          {actionButtons}
        </div>
      )}

      {showImport && treeOpen && (
        <div className="border-t border-line/[0.06] px-[18px] py-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={importValue}
              onChange={(e) => {
                setImportValue(e.target.value);
                setImportError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleImport()}
              placeholder={t('talent.pasteExportPlaceholder')}
              className="input-field !py-1.5 !text-[13px]"
              autoFocus
            />
            <button onClick={handleImport} className={`shrink-0 ${buttonClass('gold')}`}>
              {t('common.apply')}
            </button>
          </div>
          {importError && <p className="mt-1.5 text-[13px] text-negative">{importError}</p>}
        </div>
      )}

      {treeOpen && (
        <div
          className={`border-t border-line/[0.06] p-4 ${compact ? 'max-h-[280px] overflow-auto' : ''}`}
        >
          {!editing && currentTalent && (
            <TalentTree
              talentString={currentTalent}
              vertical={compact}
              baseTalentString={isEquipped ? undefined : equippedTalent}
            />
          )}
          {editing && specId && (
            <TalentTree
              talentString={selectedTalent || currentTalent}
              editable
              vertical={compact}
              specId={specId}
              onTalentStringChange={handleEditorChange}
            />
          )}
        </div>
      )}
    </div>
  );
}
