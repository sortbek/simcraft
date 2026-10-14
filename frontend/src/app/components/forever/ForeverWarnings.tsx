'use client';

/** Import warnings (missing ranged slot, random suffixes, build mismatch). */
export default function ForeverWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="card list-disc space-y-1 py-4 pl-10 pr-6 text-sm text-warning">
      {warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}
