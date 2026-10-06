'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import LanguageSelector from './LanguageSelector';
import { ScaleSelector } from './ContentScaler';
import ThemeSelector from './ThemeSelector';
import UpdateChecker from './UpdateChecker';
import { useIsDesktop } from '../../lib/useIsDesktop';
import { useLanguage } from '../../lib/i18n';
import { ROUTES, SIM_RESULT_PREFIX, isRouteActive } from '../../lib/routes';

const IPlay = () => (
  <svg className="h-3 w-3" viewBox="0 0 11 11" fill="none">
    <polygon points="1.5,1 10.5,5.5 1.5,10" fill="currentColor" />
  </svg>
);
const IGear = () => (
  <svg
    className="h-[15px] w-[15px]"
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
);
const IDiscord = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);
const IGitHub = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);
const IGlobe = () => (
  <svg
    className="h-3.5 w-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
  </svg>
);

interface NavItemProps {
  href: string;
  label: string;
  matchPaths?: readonly string[];
  pathname: string;
  icon?: ReactNode;
}

function NavItem({ href, label, matchPaths, pathname, icon }: NavItemProps) {
  const isActive = isRouteActive(pathname, matchPaths ?? [href]);
  return (
    <Link
      href={href}
      className={`relative flex h-10 items-center gap-2.5 px-[22px] font-headline text-[12.5px] font-bold uppercase tracking-[0.08em] transition-colors duration-[120ms] ${
        isActive
          ? 'bg-[image:var(--nav-on-bg)] text-gold [box-shadow:var(--nav-on-shadow)] after:absolute after:bottom-2 after:right-0 after:top-2 after:w-[3px] after:rounded-l-[3px] after:bg-gold-fill'
          : 'text-on-surface-variant hover:bg-overlay/[0.02] hover:text-on-surface'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`lbl mb-1.5 select-none px-[22px] ${className ?? 'mt-3.5'}`}>{children}</div>
  );
}

function FooterIcon({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center p-2 text-outline transition-colors hover:text-on-surface"
      title={label}
      aria-label={label}
    >
      {icon}
    </a>
  );
}

function FooterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[34px] items-center justify-between gap-3 px-[22px]">
      <span className="lbl shrink-0">{label}</span>
      <div className="flex min-w-0 flex-1 justify-end">{children}</div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const { t } = useLanguage();

  const isQuickSim = isRouteActive(pathname, [ROUTES.quickSim]);

  return (
    <aside className="desktop-no-drag fixed left-0 top-0 z-40 flex h-full w-[248px] flex-col border-r border-line/[0.06] bg-surface-container-lowest">
      <div className="desktop-drag flex h-16 shrink-0 items-center px-[22px]">
        <span className="desktop-no-drag font-headline text-[19px] font-extrabold uppercase tracking-[0.02em] text-gold">
          SimHammer
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <Link
          href={ROUTES.quickSim}
          className={`mx-3.5 mb-[18px] mt-1 flex h-[42px] items-center gap-2.5 rounded-[6px] border px-4 font-headline text-xs font-extrabold uppercase tracking-[0.14em] transition-colors duration-150 ${
            isQuickSim
              ? 'border-gold-fill bg-gold-fill text-on-primary'
              : 'border-gold-edge bg-gold-tint text-gold hover:border-gold/55 hover:bg-gold/20'
          }`}
        >
          <IPlay />
          {t('nav.quickSim')}
        </Link>

        <GroupLabel>{t('nav.simTools')}</GroupLabel>
        <NavItem href={ROUTES.topGear} label={t('nav.topGear')} pathname={pathname} />
        <NavItem href={ROUTES.dropFinder} label={t('nav.dropFinder')} pathname={pathname} />
        <NavItem href={ROUTES.upgradeCompare} label={t('nav.crestUpgrades')} pathname={pathname} />
        <NavItem href={ROUTES.raidRoster} label={t('nav.raidRoster')} pathname={pathname} />
        <NavItem href={ROUTES.advanced} label={t('nav.advancedSim')} pathname={pathname} />

        <GroupLabel className="mt-[22px]">{t('nav.library')}</GroupLabel>
        <NavItem href={ROUTES.routesManager} label={t('nav.routes')} pathname={pathname} />
        <NavItem
          href={ROUTES.sims}
          label={t('nav.mySims')}
          matchPaths={[ROUTES.sims, SIM_RESULT_PREFIX, ROUTES.history]}
          pathname={pathname}
        />
      </nav>

      <div className="mt-auto flex shrink-0 flex-col gap-1 border-t border-line/[0.06] py-2.5">
        {isDesktop && (
          <Link
            href={ROUTES.settings}
            className={`flex items-center gap-2.5 px-[22px] py-1.5 font-headline text-xs font-bold uppercase tracking-[0.1em] transition-colors ${
              isRouteActive(pathname, [ROUTES.settings])
                ? 'text-gold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <IGear />
            {t('common.settings')}
          </Link>
        )}

        <UpdateChecker />

        <div className="flex items-center justify-around px-[22px]">
          <FooterIcon
            href="https://discord.gg/grfTa87Jxa"
            label={t('nav.discord')}
            icon={<IDiscord />}
          />
          <FooterIcon
            href="https://github.com/sortbek/simcraft"
            label={t('nav.github')}
            icon={<IGitHub />}
          />
          <FooterIcon href="https://simhammer.com" label={t('nav.website')} icon={<IGlobe />} />
        </div>

        {/* Zoom, theme + language kept here until they migrate to /settings. */}
        <FooterRow label={t('layout.zoom')}>
          <ScaleSelector />
        </FooterRow>
        <FooterRow label={t('layout.theme')}>
          <ThemeSelector />
        </FooterRow>
        <FooterRow label={t('layout.language')}>
          <LanguageSelector />
        </FooterRow>
      </div>
    </aside>
  );
}
