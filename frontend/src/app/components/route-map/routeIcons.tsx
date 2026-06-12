/* Icons ported from the Claude Design handoff (route-shared.jsx) so the viewer
 * matches the mock. 14x14 viewBox, stroke = currentColor. */
import type { CSSProperties } from 'react';

interface IconProps {
  s?: number;
  style?: CSSProperties;
}

const Svg = ({ s = 13, style, children }: IconProps & { children: React.ReactNode }) => (
  <svg width={s} height={s} viewBox="0 0 14 14" fill="none" style={style}>
    {children}
  </svg>
);

export const IBoss = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 4l2.2 1.5L7 2l2.8 3.5L12 4l-1 7H3L2 4z" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinejoin="round" />
  </Svg>
);
export const IPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 2.5l2 2L5 11l-2.5.5L3 9l6.5-6.5z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
  </Svg>
);
export const IMerge = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 2v3.5c0 1.5 1 2.5 2.5 2.5H11M11 8L8.5 5.5M11 8l-2.5 2.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const ITrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4h8M5.5 4V2.8h3V4M4 4l.5 7.2h5L10 4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
export const ISave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 2.5h6.5L11.5 4.5V11a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <rect x="4.5" y="2.5" width="4" height="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
    <rect x="4.5" y="7" width="5" height="3" stroke="currentColor" strokeWidth="1" fill="none" />
  </Svg>
);
export const IImport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 2v6.5M7 8.5L4.3 5.8M7 8.5l2.7-2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M2.5 9.5v1.5a1 1 0 001 1h7a1 1 0 001-1V9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </Svg>
);
export const IPlus = (p: IconProps) => (
  <Svg {...p}>
    <line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </Svg>
);
export const IMinus = (p: IconProps) => (
  <Svg {...p}>
    <line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </Svg>
);
export const IPlay = (p: IconProps) => (
  <Svg {...p}>
    <polygon points="3,2 11.5,7 3,12" fill="currentColor" />
  </Svg>
);
export const IList = (p: IconProps) => (
  <Svg {...p}>
    <line x1="2.5" y1="3.5" x2="11.5" y2="3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="2.5" y1="7" x2="11.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="2.5" y1="10.5" x2="8" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </Svg>
);
