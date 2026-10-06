interface HeroMetaStatProps {
  label: string;
  value: string;
  note?: string;
}

export default function HeroMetaStat({ label, value, note }: HeroMetaStatProps) {
  return (
    <div className="px-9 py-4">
      <span className="lbl">{label}</span>
      <span className="mt-[7px] block font-headline text-base font-extrabold text-on-surface">
        {value}
        {note && (
          <span className="ml-1.5 font-sans text-[11px] font-semibold text-fg-4">{note}</span>
        )}
      </span>
    </div>
  );
}
