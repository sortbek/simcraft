function Spinner() {
  return (
    <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3 2l10 6-10 6V2z" />
    </svg>
  );
}

interface FloatingSubmitButtonProps {
  onClick: () => void;
  disabled?: boolean;
  submitting: boolean;
  label: string;
  submittingLabel?: string;
}

export default function FloatingSubmitButton({
  onClick,
  disabled,
  submitting,
  label,
  submittingLabel = 'Starting sim…',
}: FloatingSubmitButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || submitting}
      className="btn-primary group fixed right-4 top-1/2 z-[90] flex w-10 -translate-y-1/2 items-center gap-0 overflow-hidden rounded-full px-2.5 py-2.5 text-sm shadow-lg shadow-black/50 transition-all duration-200 hover:w-auto hover:gap-2 hover:rounded-xl hover:px-4"
    >
      {submitting ? <Spinner /> : <PlayIcon />}
      <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[10rem] group-hover:opacity-100">
        {submitting ? submittingLabel : label}
      </span>
    </button>
  );
}
