'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import SettingsPopover from '../sim-config/SettingsPopover';
import DesktopAppLink from './DesktopAppLink';
import SidebarRoutes from './SidebarRoutes';

interface NavItem {
  href: string;
  label: string;
  matchPaths: string[];
  children?: { href: string; label: string }[];
}

const navItems: NavItem[] = [
  {
    href: '/quick-sim',
    label: 'QUICK SIM',
    matchPaths: ['/quick-sim'],
  },
  {
    href: '/top-gear',
    label: 'TOP GEAR',
    matchPaths: ['/top-gear'],
  },
  {
    href: '/drop-finder',
    label: 'UPGRADES',
    matchPaths: ['/drop-finder', '/upgrade-compare'],
    children: [
      { href: '/drop-finder', label: 'Drop Finder' },
      { href: '/upgrade-compare', label: 'Crest Upgrades' },
    ],
  },
  {
    href: '/history',
    label: 'HISTORY',
    matchPaths: ['/history'],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  return (
    <aside className="desktop-no-drag fixed left-0 top-0 z-40 flex h-full w-64 flex-col bg-[#0e0e0e] border-r border-outline-variant/20 shadow-[10px_0_30px_rgba(0,0,0,0.5)]">
      {/* Logo */}
      <div className="desktop-drag shrink-0 px-6 pt-6 pb-8">
        <div className="desktop-no-drag font-headline text-primary font-black tracking-tighter text-xl">
          SimHammer
        </div>
      </div>

      <SidebarRoutes />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto">
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
                className={`flex items-center gap-3 px-6 py-3 font-headline font-bold text-xs uppercase transition-all ${
                  isActive
                    ? 'bg-primary-container/10 text-primary border-r-4 border-primary'
                    : 'text-on-surface-variant hover:bg-surface hover:text-white'
                }`}
              >
                {item.label}
              </Link>

              {hasChildren && isExpanded && (
                <div className="ml-6 border-l border-outline-variant/20 mt-1 space-y-0.5">
                  {item.children!.map((child) => {
                    const childActive =
                      pathname === child.href || pathname.startsWith(child.href + '/');
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-3 pl-4 pr-6 py-2 font-headline font-bold text-[10px] uppercase transition-all ${
                          childActive
                            ? 'text-primary'
                            : 'text-on-surface-variant/60 hover:text-primary'
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
      <div className="mt-auto shrink-0 px-4 py-3 border-t border-outline-variant/20">
        <div className="flex items-center justify-between">
          <SettingsPopover />
          <DesktopAppLink />
        </div>
      </div>
    </aside>
  );
}
