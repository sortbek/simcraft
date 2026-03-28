'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface SimType {
  href: string;
  label: string;
  description: string;
  icon: string;
  matchPaths: string[];
  children?: { href: string; label: string; description: string }[];
}

const simTypes: SimType[] = [
  {
    href: '/quick-sim',
    label: 'Quick Sim',
    description: 'DPS, ability breakdown, and stat weights.',
    icon: 'M13 8l-5 5-5-5M3 3h10',
    matchPaths: ['/quick-sim'],
  },
  {
    href: '/top-gear',
    label: 'Top Gear',
    description: 'Find the best gear from your bags.',
    icon: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
    matchPaths: ['/top-gear'],
  },
  {
    href: '/drop-finder',
    label: 'Upgrades',
    description: 'Find and sim gear upgrades.',
    icon: 'M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5L14 14',
    matchPaths: ['/drop-finder', '/upgrade-compare'],
    children: [
      { href: '/drop-finder', label: 'Drop Finder', description: 'Sim raid & dungeon loot' },
      { href: '/upgrade-compare', label: 'Crest Upgrades', description: 'Best Dawncrest path' },
    ],
  },
  {
    href: '/history',
    label: 'History',
    description: 'View recent simulation results.',
    icon: 'M8 8m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M8 4.5V8l2.5 2.5',
    matchPaths: ['/history'],
  },
];

export default function SimTypeCards() {
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <div className="mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {simTypes.map((sim) => {
        const isActive = sim.matchPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
        const hasChildren = sim.children && sim.children.length > 0;
        const isOpen = openMenu === sim.label;

        return (
          <div
            key={sim.label}
            className="relative"
            onMouseEnter={() => hasChildren && setOpenMenu(sim.label)}
            onMouseLeave={() => setOpenMenu(null)}
          >
            <Link
              href={sim.href}
              className={`group relative block rounded-xl border px-4 py-3.5 transition-all duration-200 ${
                isActive
                  ? 'border-gold/40 bg-gold/[0.04] shadow-glow'
                  : 'border-border bg-surface hover:border-zinc-600 hover:bg-surface-2'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                    isActive ? 'bg-gold/20' : 'bg-gold/[0.06] group-hover:bg-gold/[0.12]'
                  }`}
                >
                  <svg
                    className={`h-4 w-4 transition-colors ${isActive ? 'text-gold' : 'text-gold/50 group-hover:text-gold'}`}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={sim.icon} />
                  </svg>
                </div>
                <div className="min-w-0">
                  <h2
                    className={`text-sm font-semibold transition-colors ${
                      isActive ? 'text-gold' : 'text-zinc-200 group-hover:text-white'
                    }`}
                  >
                    {sim.label}
                  </h2>
                  <p className="hidden truncate text-[11px] text-zinc-500 sm:block">
                    {sim.description}
                  </p>
                </div>
              </div>
            </Link>

            {hasChildren && isOpen && (
              <div className="absolute left-0 right-0 top-full z-50 pt-1">
                <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  {sim.children!.map((child) => {
                    const childActive =
                      pathname === child.href || pathname.startsWith(child.href + '/');
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-2.5 px-3.5 py-2.5 transition-colors ${
                          childActive
                            ? 'bg-gold/[0.08] text-gold'
                            : 'text-zinc-300 hover:bg-white/[0.04] hover:text-white'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium">{child.label}</p>
                          <p className="text-[10px] text-zinc-500">{child.description}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
