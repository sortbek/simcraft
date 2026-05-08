'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSimContext } from '../sim-config/SimContext';
import {
  parseTalentLoadouts,
  SPEC_ID_TO_NAME,
  specDisplayName,
  classColorForSpec,
} from '../../lib/types';
import type { TalentLoadoutParsed } from '../../lib/types';
import { decodeHeader, decodeNodes } from '../../lib/talentDecode';
import { encodeTalentString } from '../../lib/talentEncode';
import { getPointsSpent, CLASS_POINTS, SPEC_POINTS } from '../../lib/talentRules';
import { useTalentTree } from '../../lib/useTalentTree';
import type { TalentTreeData } from '../../lib/useTalentTree';
import TalentTree from './TalentTree';
import { getCharacters, getTalentBuilds, type SavedTalentBuild } from '../../lib/saved-characters';
import { useLanguage } from '../../lib/i18n';

/** Check if a talent build has all points allocated. */
function getBuildStatus(
  talentString: string,
  tree: TalentTreeData | null
): { complete: boolean; classSpent: number; specSpent: number } | null {
  if (!tree || !talentString) return null;
  try {
    const header = decodeHeader(talentString);
    const orderedIds = tree.fullNodeOrder;
    if (!orderedIds) return null;
    const allNodes = [
      ...tree.classNodes,
      ...tree.specNodes,
      ...tree.heroNodes,
      ...(tree.subTreeNodes ?? []),
    ];
    const localMap = new Map(allNodes.map((n) => [n.id, n.maxRanks ?? 1]));
    const maxRanks = new Map(
      orderedIds.map((id) => [id, tree.fullNodeMaxRanks?.[id] ?? localMap.get(id) ?? 1])
    );
    const decoded = decodeNodes(header.bits, header.offset, orderedIds, maxRanks);
    // Auto-grant free nodes for accurate counting
    for (const node of [...tree.classNodes, ...tree.specNodes, ...tree.heroNodes]) {
      if (node.freeNode && !decoded.has(node.id)) {
        decoded.set(node.id, { ranks: node.maxRanks, choiceIndex: -1 });
      }
    }
    const classSpent = getPointsSpent(decoded, tree.classNodes);
    const specSpent = getPointsSpent(decoded, tree.specNodes);
    return {
      complete: classSpent >= CLASS_POINTS && specSpent >= SPEC_POINTS,
      classSpent,
      specSpent,
    };
  } catch {
    return null;
  }
}

type ViewMode = 'collapsed' | 'view' | 'edit';

export default function TalentPicker({
  defaultView = 'collapsed',
  compact = false,
  hideCompare = false,
}: {
  defaultView?: ViewMode;
  compact?: boolean;
  hideCompare?: boolean;
}) {
  const { t } = useLanguage();
  const { simcInput, selectedTalent, setSelectedTalent, talentBuilds, setTalentBuilds } =
    useSimContext();
  const [viewMode, setViewMode] = useState<ViewMode>(defaultView);
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
    // Extract name+realm to find the character
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
        // Convert to TalentLoadoutParsed, filtering out builds already in addon loadouts
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

  // The spec from the active (equipped) talent in the simc input — stable reference for compare badges
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
    setViewMode('view');
  }, [importValue, customLoadouts.length, addCustomLoadout, specId, t]);

  // Start from scratch
  const handleBlankBuild = useCallback(() => {
    if (!specId || !tree) return;
    const blank = encodeTalentString(new Map(), tree, specId);
    const name = `Custom ${customLoadouts.length + 1}`;
    addCustomLoadout(name, blank);
    setViewMode('edit');
  }, [specId, tree, customLoadouts.length, addCustomLoadout]);

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
    const builds = [...compareIndices]
      .filter((idx) => idx < allLoadouts.length)
      .map((idx) => ({
        name: allLoadouts[idx].name,
        talentString: allLoadouts[idx].talentString,
      }));
    // Deduplicate by talent string (no point simming identical builds twice)
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

  if (allLoadouts.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/[0.08]">
            <svg
              className="h-3.5 w-3.5 text-gold/60"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 2h12v12H2zM5 6h6M5 10h4" />
            </svg>
          </div>
          <span className="text-xs font-medium text-on-surface-variant">Talents</span>
          {allLoadouts.length >= 2 && (
            <select
              value={selectedLoadoutIdx}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setSelectedLoadoutIdx(idx);
                setSelectedTalent(allLoadouts[idx].talentString);
                if (viewMode === 'edit') setViewMode('view');
              }}
              className="input-field !w-auto !border-transparent !bg-surface-container-high !px-2.5 !py-1 !text-[13px]"
            >
              {allLoadouts.map((l, i) => (
                <option key={`${l.name}-${i}`} value={i}>
                  {l.name}
                  {l.isActive ? ` ${t('talent.equipped')}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-1">
          {viewMode !== 'collapsed' && (
            <>
              {!hideCompare && (
                <button
                  onClick={() => setCompareMode((v) => !v)}
                  className={`rounded-md px-2.5 py-1 text-[13px] transition-all ${
                    compareMode
                      ? 'bg-gold/10 font-medium text-gold'
                      : 'text-on-surface-variant/60 hover:bg-surface-container-high hover:text-on-surface-variant'
                  }`}
                >
                  {t('talent.compare')}
                  {talentBuilds.length > 1 ? ` (${talentBuilds.length})` : ''}
                </button>
              )}
              <button
                onClick={() => setShowImport((v) => !v)}
                className={`rounded-md px-2.5 py-1 text-[13px] transition-all ${
                  showImport
                    ? 'bg-gold/10 font-medium text-gold'
                    : 'text-on-surface-variant/60 hover:bg-surface-container-high hover:text-on-surface-variant'
                }`}
              >
                {t('talent.import')}
              </button>
              <button
                onClick={handleBlankBuild}
                className="rounded-md px-2.5 py-1 text-[13px] text-on-surface-variant/60 transition-all hover:bg-surface-container-high hover:text-on-surface-variant"
              >
                {t('talent.blank')}
              </button>
              {!compareMode && (
                <button
                  onClick={() => setViewMode((v) => (v === 'edit' ? 'view' : 'edit'))}
                  className={`rounded-md px-2.5 py-1 text-[13px] transition-all ${
                    viewMode === 'edit'
                      ? 'bg-gold/10 font-medium text-gold'
                      : 'text-on-surface-variant/60 hover:bg-surface-container-high hover:text-on-surface-variant'
                  }`}
                >
                  {viewMode === 'edit' ? t('common.done') : t('talent.edit')}
                </button>
              )}
            </>
          )}
          <button
            onClick={() => {
              setViewMode((v) => (v === 'collapsed' ? 'view' : 'collapsed'));
              setShowImport(false);
            }}
            className="rounded-md px-2.5 py-1 text-[13px] text-on-surface-variant/60 transition-all hover:bg-surface-container-high hover:text-on-surface-variant"
          >
            {viewMode !== 'collapsed' ? t('common.hide') : t('common.show')}
          </button>
        </div>
      </div>

      {/* Import bar */}
      {showImport && viewMode !== 'collapsed' && (
        <div className="border-t border-outline-variant/10 px-4 py-3">
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
            <button
              onClick={handleImport}
              className="shrink-0 rounded-lg bg-gold/10 px-3 py-1.5 text-[13px] font-medium text-gold transition-colors hover:bg-gold/20"
            >
              {t('common.apply')}
            </button>
          </div>
          {importError && <p className="mt-1.5 text-[13px] text-red-400">{importError}</p>}
        </div>
      )}

      {/* Compare mode — talent tree card grid */}
      {compareMode && viewMode !== 'collapsed' && (
        <div className="border-t border-outline-variant/10 px-4 py-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[12px] font-medium uppercase tracking-wider text-muted">
              {t('talent.selectBuildsCompare')}
            </p>
            {talentBuilds.length > 1 && (
              <p className="text-[12px] text-gold/70">
                {t('talent.buildsGearCombos', { count: talentBuilds.length })}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {allLoadouts.map((l, i) => {
              const checked = compareIndices.has(i);
              const status = getBuildStatus(l.talentString, tree);
              // const incomplete = status && !status.complete;
              let loadoutSpecId: number | undefined;
              let loadoutSpecName: string | undefined;
              try {
                loadoutSpecId = decodeHeader(l.talentString).specId;
                loadoutSpecName = SPEC_ID_TO_NAME[loadoutSpecId];
              } catch {
                /* ignore */
              }
              return (
                <button
                  key={`${l.name}-${i}`}
                  onClick={() => toggleCompareLoadout(i)}
                  className={`group relative overflow-hidden rounded-lg border p-2 text-left transition-all ${
                    checked
                      ? 'border-gold/40 bg-gold/[0.04]'
                      : 'border-transparent bg-surface-container-low hover:bg-surface-container-high'
                  }`}
                >
                  {/* Spec label (only when different from base spec) */}
                  {loadoutSpecName && baseSpecId != null && loadoutSpecId !== baseSpecId && (
                    <div
                      className="absolute left-1.5 top-1.5 z-10 rounded px-1.5 py-px text-[10px] font-bold"
                      style={{
                        color: classColorForSpec(loadoutSpecName) ?? '#c4b5fd',
                        backgroundColor: `${classColorForSpec(loadoutSpecName) ?? '#8b5cf6'}20`,
                      }}
                    >
                      {specDisplayName(loadoutSpecName)}
                    </div>
                  )}
                  {/* Mini tree preview */}
                  <div className="pointer-events-none h-24">
                    <TalentTree talentString={l.talentString} mini />
                  </div>
                  {/* Label + checkbox */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <div
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                        checked
                          ? 'border-gold bg-gold'
                          : 'border-outline-variant group-hover:border-outline-variant/60'
                      }`}
                    >
                      {checked && (
                        <svg
                          className="h-2.5 w-2.5 text-black"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </div>
                    <span
                      className={`truncate text-[12px] font-medium ${checked ? 'text-on-surface' : 'text-on-surface-variant/60'}`}
                    >
                      {l.name}
                      {l.isActive ? ` ${t('talent.equippedShort')}` : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tree content */}
      {viewMode !== 'collapsed' && !compareMode && (
        <div
          className={`border-t border-outline-variant/10 p-4 ${compact ? 'max-h-[280px] overflow-auto' : ''}`}
        >
          {viewMode === 'view' && currentTalent && (
            <TalentTree talentString={currentTalent} bare vertical={compact} />
          )}
          {viewMode === 'edit' && specId && (
            <TalentTree
              talentString={selectedTalent || currentTalent}
              editable
              bare
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
