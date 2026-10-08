import { cn } from '../../lib/cn';

/** Shared look for the drops header's dropdown triggers: label, value, chevron. */
export function filterTriggerClass(active: boolean, interactive = true): string {
  return cn(
    'flex h-8 list-none items-center gap-2 whitespace-nowrap rounded-[7px] border px-3 transition-colors [&::-webkit-details-marker]:hidden',
    active ? 'border-gold-edge bg-gold-tint' : 'border-line/[0.11]',
    interactive ? 'cursor-pointer hover:border-line/20' : 'cursor-default'
  );
}

export const FILTER_LABEL = 'lbl !text-[10px]';

export function filterValueClass(active: boolean): string {
  return cn('text-[12.5px] font-semibold', active ? 'text-gold' : 'text-on-surface');
}
