'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import SettingsPopover from '../sim-config/SettingsPopover';
import DesktopAppLink from './DesktopAppLink';
import SidebarCharacter from './SidebarCharacter';
import SidebarRoutes from './SidebarRoutes';

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

export default function Sidebar() {
  const pathname = usePathname();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  return (
    <aside className="desktop-no-drag fixed left-0 top-0 z-40 flex h-full w-56 flex-col border-r border-border/60 bg-surface">
      {/* Logo */}
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

      <SidebarCharacter />
      <SidebarRoutes />

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

      {/* Bottom */}
      <div className="shrink-0 border-t border-border/60 px-3 py-3">
        <div className="flex items-center justify-between">
          <SettingsPopover />
          <DesktopAppLink />
        </div>
      </div>
    </aside>
  );
}
