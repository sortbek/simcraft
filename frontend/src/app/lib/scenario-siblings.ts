const STORAGE_KEY = 'simhammer_scenario_siblings';

const FIGHT_STYLE_LABELS: Record<string, string> = {
  Patchwerk: 'Patchwerk',
  HecticAddCleave: 'Hectic Add Cleave',
  LightMovement: 'Light Movement',
};

export interface ScenarioSibling {
  id: string;
  fightStyle: string;
  targetCount: number;
  fightLength: number;
}

export function formatScenarioLabel(s: ScenarioSibling): string {
  const style = FIGHT_STYLE_LABELS[s.fightStyle] || s.fightStyle;
  const bosses = s.targetCount === 1 ? '1 boss' : `${s.targetCount} bosses`;
  const min = Math.floor(s.fightLength / 60);
  const sec = String(s.fightLength % 60).padStart(2, '0');
  return `${style} / ${bosses} / ${min}:${sec}`;
}

export function storeScenarioSiblings(siblings: ScenarioSibling[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(siblings));
  } catch {}
}

export function clearScenarioSiblings(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function getScenarioSiblings(): ScenarioSibling[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 1 ? parsed : null;
  } catch {
    return null;
  }
}
