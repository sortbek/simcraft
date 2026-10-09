import type { ReactNode } from 'react';

const PATHS: Record<string, ReactNode> = {
  quick: <path d="M7 4l10 6-10 6z" fill="currentColor" stroke="none" />,
  top: (
    <>
      <path d="M4 15l4-5 3 3 5-7" />
      <path d="M13 6h3v3" />
    </>
  ),
  drop: (
    <>
      <path d="M10 3l6 4v6l-6 4-6-4V7z" />
      <path d="M10 7v6M7 10h6" />
    </>
  ),
  crest: <path d="M10 3l2.2 4.6 5 .6-3.7 3.4 1 5L10 14l-4.5 2.6 1-5L2.8 8.2l5-.6z" />,
  arrow: <path d="M5 10h10M11 6l4 4-4 4" />,
};

export type HomeIconName = keyof typeof PATHS;

export function HomeIcon({
  name,
  className = 'h-5 w-5',
}: {
  name: HomeIconName;
  className?: string;
}) {
  return (
    <svg
      className={`shrink-0 ${className}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
