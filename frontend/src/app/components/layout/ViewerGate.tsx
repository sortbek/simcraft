'use client';

import { usePathname } from 'next/navigation';

// The viewer build still exports every route, but only /shared may render:
// the rest need the sim config providers the viewer leaves out.
export default function ViewerGate({ children }: { children: React.ReactNode }) {
  return usePathname() === '/shared' ? children : null;
}
