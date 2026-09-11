/** Small "i" badge with a hover tooltip. Shared by the Top Gear option chips and
 *  the gem option switches. Clicks are swallowed so it can sit inside a
 *  clickable row without triggering it. */
export default function InfoIcon({ tooltip }: { tooltip: string }) {
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      className="group/tip relative inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full bg-on-surface-variant/10 text-on-surface-variant/50 transition-colors hover:bg-on-surface-variant/20 hover:text-on-surface-variant"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-2.5 w-2.5"
      >
        <path
          fillRule="evenodd"
          d="M15 8A7 7 0 1 1 1 8a7 7 0 0 1 14 0Zm-6 3.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM7.293 5.293a1 1 0 1 1 .99 1.667c-.15.09-.293.21-.293.443V8a.75.75 0 1 0 1.5 0v-.297a2.5 2.5 0 1 0-3.447-2.66.75.75 0 0 0 1.5 0 1 1 0 0 1-.25-.75Z"
          clipRule="evenodd"
        />
      </svg>
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 whitespace-normal rounded-lg border border-outline-variant/20 bg-surface-container-highest px-3 py-2 text-center text-xs font-normal normal-case tracking-normal text-on-surface opacity-0 shadow-xl transition-opacity group-hover/tip:opacity-100">
        {tooltip}
      </span>
    </span>
  );
}
