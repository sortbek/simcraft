import type { Metadata } from 'next';
import Script from 'next/script';
import Sidebar from './components/Sidebar';
import { SimProvider } from './components/SimContext';
import SimSharedConfig from './components/SimSharedConfig';
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
          <Sidebar />
          <div className="pl-56">
            {/* Desktop titlebar: draggable strip + window controls */}
            <div className="desktop-only">
              <div className="desktop-drag sticky top-0 z-50 flex h-11 items-center justify-end border-b border-border/40 bg-bg/80 backdrop-blur-sm">
                <WindowControls />
              </div>
            </div>
            <main className="mx-auto max-w-5xl px-8 py-8">
              <SimSharedConfig />
              {children}
            </main>
            <footer className="mt-16 border-t border-border/40 py-8">
              <p className="mx-auto max-w-md text-center text-[13px] leading-relaxed text-zinc-600">
                SimHammer is a pet project held together by coffee, duct tape, and prayers to the
                RNG gods. Bugs are not features — but they might sim higher than your gear. Use at
                your own risk. Not affiliated with Blizzard, Raidbots, or anyone who knows what
                they&apos;re doing.
              </p>
              <p className="mt-3 text-center text-[12px] text-zinc-600">v{packageJson.version}</p>
            </footer>
          </div>
        </SimProvider>
      </body>
    </html>
  );
}
