import type { Metadata } from 'next';
import Script from 'next/script';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import AppScroll from './components/layout/AppScroll';
import { SimProvider } from './components/sim-config/SimContext';
import { VIEWER_BUILD } from './lib/featureFlags';
import { LanguageProvider } from './lib/i18n';
import { ActiveSimsProvider } from './lib/useActiveSims';
import ContentScaler, { ScaleProvider } from './components/layout/ContentScaler';
import { ThemeProvider } from './components/layout/ThemeSelector';
import ViewerGate from './components/layout/ViewerGate';
import SharedEditBanner from './components/share/SharedEditBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'SimHammer',
  description: 'Run SimulationCraft simulations from your browser',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="forge"
      suppressHydrationWarning
      style={VIEWER_BUILD ? { background: 'transparent' } : undefined}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            // The share viewer on simhammer.com is dark-only, so it keeps the default theme.
            __html: VIEWER_BUILD
              ? ''
              : `if(window.electronAPI)document.documentElement.setAttribute("data-desktop","");try{var t=localStorage.getItem("simhammer_theme");if(t==="daylight")t="parchment";if(t!=="forge"&&t!=="parchment")t="forge";localStorage.setItem("simhammer_theme",t);document.documentElement.setAttribute("data-theme",t);if(localStorage.getItem("simhammer_sidebar")==="collapsed")document.documentElement.setAttribute("data-sidebar","collapsed")}catch(e){document.documentElement.setAttribute("data-theme","forge")}`,
          }}
        />
        <Script
          id="wowhead-config"
          strategy="afterInteractive"
        >{`const whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };`}</Script>
        <Script src="https://wow.zamimg.com/js/tooltips.js" strategy="afterInteractive" />
      </head>
      <body
        className="min-h-screen"
        style={VIEWER_BUILD ? { background: 'transparent' } : undefined}
      >
        <LanguageProvider>
          <ThemeProvider>
            <ScaleProvider>
              {VIEWER_BUILD ? (
                <ContentScaler>
                  <ViewerGate>{children}</ViewerGate>
                </ContentScaler>
              ) : (
                <SimProvider>
                  <ActiveSimsProvider>
                    <Sidebar />
                    <div className="flex h-screen flex-col pl-[var(--sidebar-w)] transition-[padding] duration-200">
                      <TopBar />
                      <AppScroll>
                        <SharedEditBanner />
                        <ContentScaler>{children}</ContentScaler>
                      </AppScroll>
                    </div>
                  </ActiveSimsProvider>
                </SimProvider>
              )}
            </ScaleProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
