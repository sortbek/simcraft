interface SimcStatus {
  ready: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
}

/** The WoW Forever engine as the desktop app has it. */
interface ForeverEngineStatus {
  enabled: boolean;
  autoUpdate: boolean;
  /** The installed release tag, or null. */
  installed: string | null;
  engineCommit: string | null;
  clientBuild: string | null;
  /** An install or update is running. */
  busy: boolean;
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
  readClipboard: () => Promise<string>;
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
  getForeverStatus: () => Promise<ForeverEngineStatus>;
  checkForeverUpdate: () => Promise<{ latest: string; installed: string | null }>;
  installForeverLatest: () => Promise<ForeverEngineStatus>;
  setForeverEnabled: (value: boolean) => Promise<ForeverEngineStatus>;
  setForeverAutoUpdate: (value: boolean) => Promise<ForeverEngineStatus>;
  onForeverDownloadProgress: (callback: (progress: number) => void) => () => void;
  getSetting: <T>(key: string, defaultValue: T) => Promise<T>;
  /** A simhammer://sim/<id> link opened while the app runs; returns an unsubscribe. */
  onOpenShare?: (callback: (id: string) => void) => () => void;
  setSetting: <T>(key: string, value: T) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
