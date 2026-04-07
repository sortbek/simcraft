'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useLanguage } from '../lib/i18n';

interface SimType {
  href: string;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  matchPaths: string[];
  children?: { href: string; labelKey: string; descriptionKey: string }[];
}

const simTypes: SimType[] = [
  {
    href: '/quick-sim',
    labelKey: 'page.quickSim',
    descriptionKey: 'page.quickSimDesc',
    icon: 'M13 8l-5 5-5-5M3 3h10',
    matchPaths: ['/quick-sim'],
  },
  {
    href: '/top-gear',
    labelKey: 'page.topGear',
    descriptionKey: 'page.topGearDesc',
    icon: 'M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z',
    matchPaths: ['/top-gear'],
  },
  {
    href: '/drop-finder',
    labelKey: 'page.upgrades',
    descriptionKey: 'page.upgradesDesc',
    icon: 'M7 7m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M10.5 10.5L14 14',
    matchPaths: ['/drop-finder', '/upgrade-compare'],
    children: [
      { href: '/drop-finder', labelKey: 'page.dropFinder', descriptionKey: 'page.dropFinderDesc' },
      { href: '/upgrade-compare', labelKey: 'page.crestUpgrades', descriptionKey: 'page.crestUpgradesDesc' },
    ],
  },
  {
    href: '/history',
    labelKey: 'page.history',
    descriptionKey: 'page.historyDesc',
    icon: 'M8 8m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M8 4.5V8l2.5 2.5',
    matchPaths: ['/history'],
  },
];

export default function SimTypeCards() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  return (
    <div className="mb-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      {simTypes.map((sim) => {
        const isActive = sim.matchPaths.some((p) => pathname === p || pathname.startsWith(p + '/'));
        const hasChildren = sim.children && sim.children.length > 0;
        const label = t(sim.labelKey);
        const isOpen = openMenu === sim.labelKey;

        return (
          <div
            key={sim.labelKey}
            className="relative"
            onMouseEnter={() => hasChildren && setOpenMenu(sim.labelKey)}
            onMouseLeave={() => setOpenMenu(null)}
          >
            <Link
              href={sim.href}
              className={`group relative block rounded-xl px-4 py-3.5 transition-all duration-200 ${
                isActive
                  ? 'bg-surface-container shadow-glow'
                  : 'bg-surface-container-low hover:bg-surface-container-high'
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
                      isActive ? 'text-gold' : 'text-on-surface group-hover:text-white'
                    }`}
                  >
                    {label}
                  </h2>
                  <p className="hidden truncate text-[13px] text-on-surface-variant/60 sm:block">
                    {t(sim.descriptionKey)}
                  </p>
                </div>
              </div>
            </Link>

            {hasChildren && isOpen && (
              <div className="absolute left-0 right-0 top-full z-50 pt-1">
                <div className="overflow-hidden rounded-lg bg-surface-container-high shadow-ambient">
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
                            : 'text-on-surface-variant hover:bg-white/[0.04] hover:text-on-surface'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium">{t(child.labelKey)}</p>
                          <p className="text-[12px] text-on-surface-variant/60">{t(child.descriptionKey)}</p>
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
