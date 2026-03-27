interface DpsHeroCardProps {
  playerName: string;
  playerClass: string;
  dps: number;
  dpsError?: number;
  dpsErrorPct?: number;
  fightLength?: number;
  desiredTargets?: number;
  iterations?: number;
  targetError?: number;
  elapsedTime?: number;
  /** Optional content rendered between the DPS number and the metadata bar */
  children?: React.ReactNode;
}

export default function DpsHeroCard({
  playerName,
  playerClass,
  dps,
  dpsError,
  dpsErrorPct,
  fightLength,
  iterations,
  targetError,
  desiredTargets,
  elapsedTime,
  children,
}: DpsHeroCardProps) {
  const hasMetadata =
    (dpsError != null && dpsError > 0) ||
    fightLength != null ||
    (iterations != null && iterations > 0) ||
    elapsedTime != null;

  return (
    <div className="card overflow-hidden">
      <div className="px-8 pb-6 pt-8 text-center">
        <p className="mb-3 text-xs font-medium text-zinc-500">
          {playerName} &middot; {playerClass}
        </p>
        <p className="text-5xl font-bold tabular-nums tracking-tight text-white">
          {Math.round(dps).toLocaleString()}
        </p>
        <p className="mt-2 text-[10px] font-medium uppercase tracking-widest text-zinc-500">
          Damage Per Second
        </p>
        {children}
      </div>
      {hasMetadata && (
        <div className="flex items-center justify-center gap-px border-t border-border bg-surface-2">
          {dpsError != null && dpsError > 0 && (
            <MetaStat
              label="Margin of Error"
              value={`± ${Math.round(dpsError).toLocaleString()}`}
              note={dpsErrorPct != null ? `${dpsErrorPct}%` : undefined}
            />
          )}
          {fightLength != null && (
            <MetaStat label="Fight Length" value={formatDuration(fightLength)} />
          )}
          {desiredTargets != null && desiredTargets > 0 && (
            <MetaStat
              label="Targets"
              value={desiredTargets === 1 ? '1 Boss' : `${desiredTargets} Bosses`}
            />
          )}
          {iterations != null && iterations > 0 && (
            <MetaStat
              label="Iterations"
              value={iterations.toLocaleString()}
              note={targetError != null && targetError > 0 ? 'Smart Sim' : undefined}
            />
          )}
          {elapsedTime != null && <MetaStat label="Time" value={formatElapsed(elapsedTime)} />}
        </div>
      )}
    </div>
  );
}

function MetaStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex-1 px-4 py-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</p>
      <p className="mt-0.5 text-xs font-medium tabular-nums text-zinc-300">
        {value}
        {note && <span className="ml-1 text-[10px] font-normal text-zinc-600">{note}</span>}
      </p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = String(Math.round(seconds % 60)).padStart(2, '0');
  return `${min}:${sec}`;
}

function formatElapsed(seconds: number): string {
  if (seconds >= 60) {
    const min = Math.floor(seconds / 60);
    const sec = String(Math.round(seconds % 60)).padStart(2, '0');
    return `${min}:${sec}`;
  }
  return `${seconds.toFixed(1)}s`;
}
