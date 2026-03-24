"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const simTypes = [
  {
    href: "/quick-sim",
    label: "Quick Sim",
    description: "Simulate your character as-is. Get DPS, ability breakdown, and stat weights.",
    icon: (
      <svg className="w-5 h-5 text-gold" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 8l-5 5-5-5M3 3h10" />
      </svg>
    ),
    matchPaths: ["/quick-sim"],
  },
  {
    href: "/top-gear",
    label: "Top Gear",
    description: "Find the best gear combination from your bags, bank, and vault.",
    icon: (
      <svg className="w-5 h-5 text-gold" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z" />
      </svg>
    ),
    matchPaths: ["/top-gear"],
  },
  {
    href: "/drop-finder",
    label: "Drop Finder",
    description: "Browse loot tables for raids and dungeons by slot.",
    icon: (
      <svg className="w-5 h-5 text-gold" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
    ),
    matchPaths: ["/drop-finder"],
  },
  {
    href: "/history",
    label: "History",
    description: "View your recent simulation results.",
    icon: (
      <svg className="w-5 h-5 text-gold" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 4.5V8l2.5 2.5" />
      </svg>
    ),
    matchPaths: ["/history"],
  },
];

export default function SimTypeCards() {
  const pathname = usePathname();

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
      {simTypes.map((sim) => {
        const isActive = sim.matchPaths.some(
          (p) => pathname === p || pathname.startsWith(p + "/")
        );
        return (
          <Link
            key={sim.href}
            href={sim.href}
            className={`card p-4 group transition-all ${
              isActive
                ? "border-gold/50 bg-gold/[0.03]"
                : "hover:border-gold/20"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                isActive ? "bg-gold/20" : "bg-gold/10"
              }`}>
                {sim.icon}
              </div>
              <div>
                <h2 className={`text-[15px] font-semibold transition-colors ${
                  isActive ? "text-gold" : "text-white group-hover:text-gold"
                }`}>
                  {sim.label}
                </h2>
                <p className="text-[11px] text-muted hidden sm:block">
                  {sim.description}
                </p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
