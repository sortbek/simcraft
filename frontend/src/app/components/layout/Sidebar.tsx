'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SidebarRoutes from './SidebarRoutes';
import LanguageSelector from './LanguageSelector';
import { ScaleSelector } from './ContentScaler';
import { useIsDesktop } from '../../lib/useIsDesktop';
import { useLanguage } from '../../lib/i18n';

export default function Sidebar() {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const { t } = useLanguage();

  const navItems = [
    {
      href: '/quick-sim',
      label: t('nav.quickSim'),
      matchPaths: ['/quick-sim'],
    },
    {
      href: '/top-gear',
      label: t('nav.topGear'),
      matchPaths: ['/top-gear'],
    },
    {
      href: '/drop-finder',
      label: t('nav.dropFinder'),
      matchPaths: ['/drop-finder'],
    },
    {
      href: '/upgrade-compare',
      label: t('nav.crestUpgrades'),
      matchPaths: ['/upgrade-compare'],
    },
    {
      href: '/advanced',
      label: t('nav.advanced'),
      matchPaths: ['/advanced'],
    },
    {
      href: '/history',
      label: t('nav.history'),
      matchPaths: ['/history'],
    },
  ];

  return (
    <aside className="desktop-no-drag fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-outline-variant/20 bg-[#0e0e0e] shadow-[10px_0_30px_rgba(0,0,0,0.5)]">
      {/* Logo */}
      <div className="desktop-drag shrink-0 px-6 pb-8 pt-6">
        <div className="desktop-no-drag font-headline text-xl font-black tracking-tighter text-primary">
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

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-6 py-3 font-headline text-xs font-bold uppercase transition-all ${
                isActive
                  ? 'border-r-4 border-primary bg-primary-container/10 text-primary'
                  : 'text-on-surface-variant hover:bg-surface hover:text-white'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom links + settings */}
      <div className="mt-auto shrink-0 border-t border-outline-variant/20">
        <div className="px-5 py-2">
          <ScaleSelector />
        </div>
        <div className="border-t border-outline-variant/20 px-4 py-3">
          <LanguageSelector />
        </div>
        <div className="space-y-1 border-t border-outline-variant/20 px-4 py-3">
          <a
            href="https://discord.gg/grfTa87Jxa"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2 font-headline text-[10px] font-bold uppercase text-on-surface-variant/60 transition-all hover:text-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            {t('nav.discord')}
          </a>
          <a
            href="https://github.com/sortbek/simcraft"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2 font-headline text-[10px] font-bold uppercase text-on-surface-variant/60 transition-all hover:text-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            {t('nav.github')}
          </a>
          <a
            href="https://simhammer.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2 font-headline text-[10px] font-bold uppercase text-on-surface-variant/60 transition-all hover:text-primary"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            {t('nav.website')}
          </a>
        </div>
        {isDesktop && (
          <div className="border-t border-outline-variant/20 px-4 py-3">
            <Link
              href="/settings"
              className={`flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors ${
                pathname === '/settings'
                  ? 'text-primary'
                  : 'text-on-surface-variant/60 hover:bg-surface-container-high hover:text-on-surface-variant'
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="8" cy="8" r="2" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
              </svg>
              <span className="text-[13px] font-medium">{t('common.settings')}</span>
            </Link>
          </div>
        )}
        {!isDesktop && (
          <div className="border-t border-outline-variant/20 px-4 py-3">
            <Link
              href="/admin"
              className={`flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors ${
                pathname === '/admin'
                  ? 'text-primary'
                  : 'text-on-surface-variant/60 hover:bg-surface-container-high hover:text-on-surface-variant'
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 1L8 3M8 13L8 15M3 8L1 8M15 8L13 8" />
                <rect x="4" y="4" width="8" height="8" rx="1" />
                <path d="M6 7h4M6 9h4" />
              </svg>
              <span className="text-[13px] font-medium">Admin</span>
            </Link>
          </div>
        )}
      </div>
    </aside>
  );
}
