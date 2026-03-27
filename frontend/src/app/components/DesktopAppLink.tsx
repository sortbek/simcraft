export default function DesktopAppLink() {
  return (
    <a
      href="https://github.com/sortbek/simcraft/releases/latest"
      target="_blank"
      rel="noopener noreferrer"
      className="web-only flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-gold transition-colors hover:text-white"
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 12V3M5 9l3 3 3-3M3 14h10" />
      </svg>
      Desktop App
    </a>
  );
}
