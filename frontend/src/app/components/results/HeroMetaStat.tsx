interface HeroMetaStatProps {
  label: string;
  value: string;
  note?: string;
  border?: boolean;
}

export default function HeroMetaStat({ label, value, note, border }: HeroMetaStatProps) {
  return (
    <div className={`flex flex-col${border ? ' border-l border-outline-variant/10 pl-4' : ''}`}>
      <span className="font-headline text-[10px] font-bold uppercase text-on-surface-variant opacity-60">
        {label}
      </span>
      <span className="font-headline text-sm font-bold text-on-surface">
        {value}
        {note && (
          <span className="ml-1 text-[10px] font-normal text-on-surface-variant/40">{note}</span>
        )}
      </span>
    </div>
  );
}
