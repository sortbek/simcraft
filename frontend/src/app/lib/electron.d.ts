interface SimcStatus {
  ready: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
}

interface SimcVersion {
  tag: string;
  type: string;
  binaryPath: string;
}

interface SimcVersionList {
  versions: SimcVersion[];
}

interface SimcAvailableUpdate {
  tag: string;
  type: string;
  assetUrl: string;
  installed: boolean;
}

interface ElectronAPI {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  checkForUpdate: () => Promise<{ version: string } | null>;
  downloadAndInstall: () => Promise<void>;
  onUpdateAvailable: (callback: (version: string) => void) => () => void;
  onDownloadProgress: (callback: (percent: number) => void) => () => void;
  startClipboardPolling: (intervalMs: number) => Promise<void>;
  stopClipboardPolling: () => Promise<void>;
  readClipboard: () => Promise<string>;
  onClipboardChange: (callback: (text: string) => void) => () => void;
  getSimcStatus: () => Promise<SimcStatus>;
  listSimcVersions: () => Promise<SimcVersionList>;
  checkSimcUpdates: () => Promise<SimcAvailableUpdate[]>;
  installSimcVersion: (release: {
    tag: string;
    assetUrl: string;
  }) => Promise<{ success: boolean; error?: string }>;
  removeSimcVersion: (tag: string) => Promise<{ success: boolean; error?: string }>;
  onSimcDownloadProgress: (callback: (progress: number) => void) => () => void;
  onSimcStatusChanged: (callback: (status: SimcStatus) => void) => () => void;
  getSetting: <T>(key: string, defaultValue: T) => Promise<T>;
  setSetting: <T>(key: string, value: T) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
