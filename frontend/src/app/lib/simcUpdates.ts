import { apiUrl, fetchJson } from './api';

export interface InstalledVersions {
  branches: string[];
  default_branch: string;
  versions: Record<string, { tag: string }>;
}

export interface AvailableUpdate {
  branch: string;
  tag: string;
  asset_url: string;
  installed: boolean;
  installed_tag: string | null;
}

export interface UpdateCheckResult {
  updates: AvailableUpdate[];
  asset_name: string;
}

/** Fetch installed SimC versions from the backend. */
export async function fetchInstalledVersions(): Promise<InstalledVersions> {
  return fetchJson<InstalledVersions>(apiUrl('/api/simc/versions'));
}

/** Check for SimC updates via the backend (handles GitHub API + platform detection). */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  return fetchJson<UpdateCheckResult>(apiUrl('/api/simc/updates'));
}
