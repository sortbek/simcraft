import type { Metadata } from "next";
import Script from "next/script";
import DesktopAppLink from "./components/DesktopAppLink";
import SettingsPopover from "./components/SettingsPopover";
import { SimProvider } from "./components/SimContext";
import SimSharedConfig from "./components/SimSharedConfig";
import SimTypeCards from "./components/SimTypeCards";
import UpdateChecker from "./components/UpdateChecker";
import WindowControls from "./components/WindowTitlebar";
import "./globals.css";
import packageJson from "../../package.json";

export const metadata: Metadata = {
  title: "SimHammer",
  description: "Run SimulationCraft simulations from your browser",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if(window.electronAPI)document.documentElement.setAttribute("data-desktop","")`,
          }}
        />
        <Script
          id="wowhead-config"
          strategy="beforeInteractive"
        >{`const whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };`}</Script>
        <Script
          src="https://wow.zamimg.com/js/tooltips.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className="min-h-screen">
        <UpdateChecker />
        <SimProvider>
          <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur-xl desktop-drag">
            <div className="px-6 h-12 flex items-center justify-between">
              <a href="https://simhammer.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 group desktop-no-drag">
                <div className="w-5 h-5 rounded bg-gold/90 flex items-center justify-center">
                  <svg className="w-3 h-3 text-black" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M3 2l10 6-10 6V2z" />
                  </svg>
                </div>
                <span className="text-sm font-semibold text-gray-200 group-hover:text-white transition-colors">
                  SimHammer
                </span>
              </a>
              <div className="flex items-center gap-2 desktop-no-drag">
                <SettingsPopover />
                <DesktopAppLink />
                <WindowControls />
              </div>
            </div>
          </header>
          <main className="max-w-5xl mx-auto px-6 py-10">
            <SimTypeCards />
            <SimSharedConfig />
            {children}
          </main>
        </SimProvider>
        <footer className="border-t border-border/50 mt-16 py-6">
          <p className="text-center text-[11px] text-gray-500 max-w-lg mx-auto leading-relaxed">
            SimHammer is a pet project held together by coffee, duct tape, and prayers to the RNG gods.
            Bugs are not features — but they might sim higher than your gear. Use at your own risk.
            Not affiliated with Blizzard, Raidbots, or anyone who knows what they&apos;re doing.
          </p>
          <p className="text-center text-[11px] text-gray-600 mt-2">v{packageJson.version}</p>
        </footer>
      </body>
    </html>
  );
}
