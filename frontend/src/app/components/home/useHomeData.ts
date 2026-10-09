import { useEffect, useState } from 'react';
import { fetchAllJobs, type JobOverviewSummary } from '../../lib/api';

/** This character's sims, newest first. Scoped by name and realm like My Sims on
 *  the web, so the page never lists anyone else's runs. */
export function useCharacterJobs(name: string | null, realm: string | null) {
  const [state, setState] = useState<{ key: string; jobs: JobOverviewSummary[] } | null>(null);
  const key = name && realm ? `${name}@${realm}` : '';

  useEffect(() => {
    if (!name || !realm) return;
    let cancelled = false;
    fetchAllJobs({ player: name, realm, limit: 100 })
      .then(
        (jobs) =>
          !cancelled && setState({ key: `${name}@${realm}`, jobs: Array.isArray(jobs) ? jobs : [] })
      )
      .catch(() => !cancelled && setState({ key: `${name}@${realm}`, jobs: [] }));
    return () => {
      cancelled = true;
    };
  }, [name, realm]);

  return { jobs: state?.key === key ? state.jobs : [], loading: !!key && state?.key !== key };
}

/** Recent sims for the home list: every character's on the desktop app (like My
 *  Sims there), only the loaded character's on the web. */
export function useRecentJobs(
  isDesktop: boolean,
  characterJobs: JobOverviewSummary[]
): JobOverviewSummary[] {
  const [all, setAll] = useState<JobOverviewSummary[] | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    fetchAllJobs({ limit: 100 })
      .then((jobs) => !cancelled && setAll(Array.isArray(jobs) ? jobs : []))
      .catch(() => !cancelled && setAll([]));
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);
  return isDesktop && all ? all : characterJobs;
}

export interface RotationDungeon {
  name: string;
  image_url: string;
}

const SEASON_URL = 'https://simhammer.com/api/blizzard/season';

/** This season's Mythic+ rotation with Blizzard's zone art; null offline. */
export function useSeasonRotation(): RotationDungeon[] | null {
  const [rotation, setRotation] = useState<RotationDungeon[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(SEASON_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { mplus_rotation?: RotationDungeon[] } | null) => {
        if (!cancelled && data?.mplus_rotation?.length) setRotation(data.mplus_rotation);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return rotation;
}

/** Blizzard's wide zone banner, with the small art underneath for zones that lack one. */
export function zoneBackground(imageUrl: string): string {
  return `url(${imageUrl.replace('-small.jpg', '-large.jpg')}), url(${imageUrl})`;
}
