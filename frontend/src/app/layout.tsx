import type { Metadata } from 'next';
import Script from 'next/script';
import DesktopAppLink from './components/DesktopAppLink';
import SettingsPopover from './components/SettingsPopover';
import { SimProvider } from './components/SimContext';
import SimSharedConfig from './components/SimSharedConfig';
import SimTypeCards from './components/SimTypeCards';
import UpdateChecker from './components/UpdateChecker';
import WindowControls from './components/WindowTitlebar';
import './globals.css';
import packageJson from '../../package.json';

export const metadata: Metadata = {
  title: 'SimHammer',
  description: 'Run SimulationCraft simulations from your browser',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if(window.electronAPI)document.documentElement.setAttribute("data-desktop","")`,
          }}
        />
        <Script
          id="wowhead-config"
          strategy="afterInteractive"
        >{`const whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };`}</Script>
        <Script src="https://wow.zamimg.com/js/tooltips.js" strategy="afterInteractive" />
      </head>
      <body className="min-h-screen">
        <UpdateChecker />
        <SimProvider>
          <header className="desktop-drag sticky top-0 z-50 border-b border-border/80 bg-bg/90 backdrop-blur-xl">
            <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
              <a
                href="https://simhammer.com"
                target="_blank"
                rel="noopener noreferrer"
                className="desktop-no-drag group flex items-center gap-2.5"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-b from-gold to-gold-dark shadow-sm">
                  <svg className="h-3.5 w-3.5 text-black" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3 2l10 6-10 6V2z" />
                  </svg>
                </div>
                <span className="text-[15px] font-bold tracking-tight text-gray-100 transition-colors group-hover:text-white">
                  SimHammer
                </span>
              </a>
              <div className="desktop-no-drag flex items-center gap-1.5">
                <SettingsPopover />
                <DesktopAppLink />
                <WindowControls />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-6 py-8">
            <SimTypeCards />
            <SimSharedConfig />
            {children}
          </main>
        </SimProvider>
        <footer className="mt-20 border-t border-border/40 py-8">
          <p className="mx-auto max-w-md text-center text-[11px] leading-relaxed text-zinc-600">
            SimHammer is a pet project held together by coffee, duct tape, and prayers to the RNG
            gods. Bugs are not features — but they might sim higher than your gear. Use at your own
            risk. Not affiliated with Blizzard, Raidbots, or anyone who knows what they&apos;re
            doing.
          </p>
          <p className="mt-3 text-center text-[10px] text-zinc-700">v{packageJson.version}</p>
        </footer>
      </body>
    </html>
  );
}
