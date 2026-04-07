import type { Metadata } from 'next';
import Script from 'next/script';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import FooterDisclaimer from './components/layout/FooterDisclaimer';
import { SimProvider } from './components/sim-config/SimContext';
import { LanguageProvider } from './lib/i18n';
import UpdateChecker from './components/layout/UpdateChecker';
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
        <LanguageProvider>
          <SimProvider>
            <Sidebar />
            <div className="pl-64">
              <TopBar />
              <main className="mx-auto max-w-screen-2xl px-8 py-8">
                {children}
              </main>
              <FooterDisclaimer version={packageJson.version} />
            </div>
          </SimProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
