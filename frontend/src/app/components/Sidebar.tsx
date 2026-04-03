'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSimContext } from './SimContext';
import SettingsPopover from './SettingsPopover';
import DesktopAppLink from './DesktopAppLink';
import { specDisplayName } from '../lib/types';
import {
  getSavedRoutes,
  saveRoute,
  deleteSavedRoute,
  type SavedRoute,
} from '../lib/saved-routes';
import {
  getCharacters,
  upsertCharacter,
  deleteCharacter,
  type SavedCharacter,
} from '../lib/saved-characters';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  matchPaths: string[];
  children?: { href: string; label: string }[];
}

const navItems: NavItem[] = [
  {
    href: '/quick-sim',
    label: 'Quick Sim',
    icon: 'M13 8l-5 5-5-5M3 3h10',
    matchPaths: ['/quick-sim'],
  },
  {
    href: '/top-gear',
    label: 'Top Gear',
    icon: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
    matchPaths: ['/top-gear'],
  },
  {
    href: '/drop-finder',
    label: 'Upgrades',
    icon: 'M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5L14 14',
    matchPaths: ['/drop-finder', '/upgrade-compare'],
    children: [
      { href: '/drop-finder', label: 'Drop Finder' },
      { href: '/upgrade-compare', label: 'Crest Upgrades' },
    ],
  },
  {
    href: '/history',
    label: 'History',
    icon: 'M8 8m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M8 4.5V8l2.5 2.5',
    matchPaths: ['/history'],
  },
];

function parseCharacterInfo(input: string) {
  if (!input) return null;
  const nameMatch = input.match(/^(\w+)="(.+)"$/m);
  const specMatch = input.match(/^spec=(\w+)/m);
  if (!nameMatch) return null;
  // Save last character to localStorage for history page
  const realmMatch = input.match(/^server=(.+)$/m);
  if (nameMatch[2] && realmMatch?.[1]) {
    try {
      localStorage.setItem(
        'simhammer_last_character',
        JSON.stringify({ name: nameMatch[2], realm: realmMatch[1] })
      );
    } catch {}
  }
  return {
    className: nameMatch[1],
    name: nameMatch[2],
    spec: specMatch?.[1] || 'unknown',
  };
}

export default function Sidebar() {
  const pathname = usePathname();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [characterOpen, setCharacterOpen] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [routeName, setRouteName] = useState('');
  const [routeString, setRouteString] = useState('');
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>([]);
  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const { simcInput, setSimcInput, setFightStyle, simcFooter, setSimcFooter } = useSimContext();

  const characterInfo = useMemo(() => parseCharacterInfo(simcInput), [simcInput]);

  const refreshRoutes = useCallback(() => {
    getSavedRoutes().then(setSavedRoutes);
  }, []);

  const refreshCharacters = useCallback(() => {
    getCharacters().then(setCharacters);
  }, []);

  useEffect(() => {
    refreshRoutes();
    refreshCharacters();
  }, [refreshRoutes, refreshCharacters]);

  // Auto-save character when SimC input changes (debounced)
  useEffect(() => {
    if (!simcInput.trim()) return;
    const timeout = setTimeout(() => {
      upsertCharacter(simcInput).then((result) => {
        if (result) refreshCharacters();
      });
    }, 1000);
    return () => clearTimeout(timeout);
  }, [simcInput, refreshCharacters]);

  const activeRouteName = useMemo(() => {
    if (!simcFooter) return null;
    const match = savedRoutes.find((r) => r.mdt_string === simcFooter);
    return match?.name ?? null;
  }, [simcFooter, savedRoutes]);

  const handleLoadRoute = useCallback(
    (mdtString: string) => {
      setSimcFooter(mdtString);
      setFightStyle('DungeonRoute');
    },
    [setSimcFooter, setFightStyle]
  );

  const handleSaveRoute = useCallback(() => {
    if (!routeName.trim() || !routeString.trim()) return;
    saveRoute(routeName.trim(), routeString.trim()).then(() => {
      setRouteName('');
      setRouteString('');
      setShowRouteForm(false);
      refreshRoutes();
    });
  }, [routeName, routeString, refreshRoutes]);

  return (
    <aside className="desktop-no-drag fixed left-0 top-0 z-40 flex h-full w-56 flex-col border-r border-border/60 bg-surface">
      {/* Logo — draggable on desktop */}
      <div className="desktop-drag flex h-14 shrink-0 items-center gap-2.5 px-5">
        <div className="desktop-no-drag flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-b from-gold to-gold-dark shadow-sm">
            <svg className="h-3.5 w-3.5 text-black" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 2l10 6-10 6V2z" />
            </svg>
          </div>
          <span className="text-[15px] font-bold tracking-tight text-gray-100">SimHammer</span>
        </div>
      </div>

      {/* Character section */}
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <button
          onClick={() => setCharacterOpen((v) => !v)}
          className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] font-medium transition-all duration-150 ${
            characterOpen
              ? 'bg-gold/[0.08] text-gold'
              : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
          }`}
        >
          <svg
            className={`h-4 w-4 shrink-0 transition-colors ${
              characterOpen ? 'text-gold' : 'text-zinc-600 group-hover:text-zinc-400'
            }`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="5" r="3" />
            <path d="M2 14c0-3.3 2.7-5 6-5s6 1.7 6 5" />
          </svg>
          <div className="min-w-0 flex-1">
            {characterInfo ? (
              <>
                <div className="truncate text-[14px] leading-tight">{characterInfo.name}</div>
                <div className="truncate text-[11px] font-normal text-zinc-500">
                  {specDisplayName(characterInfo.spec)} {characterInfo.className}
                </div>
              </>
            ) : (
              'Character'
            )}
          </div>
          <svg
            className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-200 ${characterOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </button>

        {characterOpen && (
          <div className="mt-1.5 space-y-1.5 px-1 pb-1">
            {/* Saved characters list */}
            {characters.length > 0 && (
              <div className="space-y-0.5">
                {characters.map((char) => {
                  const isActive =
                    characterInfo?.name === char.name &&
                    simcInput.includes(`server=${char.realm}`);
                  return (
                    <div
                      key={char.id}
                      className={`flex items-center justify-between rounded-md px-2.5 py-1.5 ${
                        isActive ? 'bg-gold/[0.08]' : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <button
                        onClick={() => setSimcInput(char.simc_input)}
                        className={`min-w-0 flex-1 text-left transition-colors ${
                          isActive ? 'text-gold' : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        <div className="truncate text-[13px] font-medium">{char.name}</div>
                        <div className="truncate text-[11px] text-zinc-600">
                          {specDisplayName(char.spec)} {char.class}
                        </div>
                      </button>
                      <button
                        onClick={() => deleteCharacter(char.id).then(refreshCharacters)}
                        className="ml-2 shrink-0 text-[13px] text-zinc-700 hover:text-red-400 transition-colors"
                      >
                        &times;
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* SimC input textarea */}
            <textarea
              value={simcInput}
              onChange={(e) => setSimcInput(e.target.value)}
              placeholder="Paste SimC addon export..."
              className="h-28 w-full resize-y rounded-lg border border-border bg-surface-2 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-zinc-300 placeholder-zinc-600 focus:border-gold/30 focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Routes section */}
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <button
          onClick={() => setRoutesOpen((v) => !v)}
          className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[14px] font-medium transition-all duration-150 ${
            routesOpen
              ? 'bg-gold/[0.08] text-gold'
              : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
          }`}
        >
          <svg
            className={`h-4 w-4 shrink-0 transition-colors ${
              routesOpen ? 'text-gold' : 'text-zinc-600 group-hover:text-zinc-400'
            }`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 3h12M2 8h8M2 13h10" />
          </svg>
          <div className="min-w-0 flex-1">
            {activeRouteName ? (
              <>
                <div className="truncate text-[14px] leading-tight">Routes</div>
                <div className="truncate text-[11px] font-normal text-zinc-500">
                  {activeRouteName}
                </div>
              </>
            ) : (
              'Routes'
            )}
          </div>
          <svg
            className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-200 ${routesOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M3 4.5l3 3 3-3" />
          </svg>
        </button>

        {routesOpen && (
          <div className="mt-1.5 space-y-1 px-1 pb-1">
            {/* Saved route list */}
            {savedRoutes.map((route) => {
              const isActive = simcFooter === route.mdt_string;
              return (
                <div
                  key={route.id}
                  className={`flex items-center justify-between rounded-md px-2.5 py-1.5 ${
                    isActive ? 'bg-gold/[0.08]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <button
                    onClick={() => handleLoadRoute(route.mdt_string)}
                    className={`min-w-0 truncate text-[13px] transition-colors ${
                      isActive ? 'font-medium text-gold' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {route.name}
                  </button>
                  <button
                    onClick={() => {
                      deleteSavedRoute(route.id).then(refreshRoutes);
                    }}
                    className="ml-2 shrink-0 text-[13px] text-zinc-700 hover:text-red-400 transition-colors"
                  >
                    &times;
                  </button>
                </div>
              );
            })}

            {/* Save new route form */}
            {showRouteForm ? (
              <div className="space-y-1.5 rounded-lg bg-surface-2 p-2">
                <input
                  type="text"
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="Route name..."
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-[12px] text-zinc-300 placeholder-zinc-600 focus:border-gold/30 focus:outline-none"
                  autoFocus
                />
                <textarea
                  value={routeString}
                  onChange={(e) => setRouteString(e.target.value)}
                  placeholder="Paste MDT route string..."
                  className="h-20 w-full resize-y rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] text-zinc-300 placeholder-zinc-600 focus:border-gold/30 focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleSaveRoute}
                    disabled={!routeName.trim() || !routeString.trim()}
                    className="rounded bg-gold/10 px-2.5 py-1 text-[12px] font-medium text-gold transition-colors hover:bg-gold/20 disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setShowRouteForm(false);
                      setRouteName('');
                      setRouteString('');
                    }}
                    className="rounded px-2.5 py-1 text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowRouteForm(true)}
                className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-zinc-500 transition-colors hover:text-zinc-300"
              >
                <span className="text-[15px] leading-none">+</span>
                Save new route
              </button>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {navItems.map((item) => {
          const isActive = item.matchPaths.some(
            (p) => pathname === p || pathname.startsWith(p + '/')
          );
          const hasChildren = item.children && item.children.length > 0;
          const isExpanded = expandedGroup === item.label || isActive;

          return (
            <div key={item.label}>
              <Link
                href={item.href}
                onClick={() => {
                  if (hasChildren) {
                    setExpandedGroup(isExpanded && !isActive ? null : item.label);
                  }
                }}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-gold/[0.08] text-gold'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <svg
                  className={`h-4 w-4 shrink-0 transition-colors ${
                    isActive ? 'text-gold' : 'text-zinc-600 group-hover:text-zinc-400'
                  }`}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>

              {/* Child links */}
              {hasChildren && isExpanded && (
                <div className="ml-[26px] mt-0.5 space-y-0.5 border-l border-border/60 pl-3">
                  {item.children!.map((child) => {
                    const childActive =
                      pathname === child.href || pathname.startsWith(child.href + '/');
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`block rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                          childActive
                            ? 'font-medium text-gold'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="shrink-0 border-t border-border/60 px-3 py-3">
        <div className="flex items-center justify-between">
          <SettingsPopover />
          <DesktopAppLink />
        </div>
      </div>
    </aside>
  );
}
