import { API_URL } from './api';

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
  const res = await fetch(`${API_URL}/api/simc/versions`);
  if (!res.ok) throw new Error('Failed to fetch installed versions');
  return res.json();
}

/** Check for SimC updates via the backend (handles GitHub API + platform detection). */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const res = await fetch(`${API_URL}/api/simc/updates`);
  if (!res.ok) throw new Error('Failed to check for updates');
  return res.json();
}
