import { API_URL } from '../../lib/api';
import type { Instance } from './types';

interface InstanceListProps {
  instances: Instance[];
  selectedId: string;
  onSelect: (id: string) => void;
  allKey: string;
  allLabel: string;
}

function imgSrc(imageUrl: string): string {
  return imageUrl.startsWith('/') ? `${API_URL}${imageUrl}` : imageUrl;
}

export default function InstanceList({
  instances,
  selectedId,
  onSelect,
  allKey,
  allLabel,
}: InstanceListProps) {
  const imagesWithUrl = instances.filter((i) => i.image_url).slice(0, 4);

  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low overflow-hidden">
      <div className="flex items-center justify-between border-b border-outline-variant/10 p-4">
        <h3 className="font-headline font-black text-sm uppercase text-on-surface">Select Instance</h3>
        <button
          onClick={() => onSelect(allKey)}
          className="text-xs font-bold text-primary hover:underline"
        >
          Select All
        </button>
      </div>
      <div className="max-h-[calc(100vh-20rem)] overflow-y-auto p-2 space-y-1">
        {/* "All" option */}
        <button
          onClick={() => onSelect(allKey)}
          className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
            selectedId === allKey
              ? 'bg-surface-container-high border border-primary/20'
              : 'hover:bg-surface-container-highest'
          }`}
        >
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded">
            {imagesWithUrl.length > 0 ? (
              <div className="grid h-full w-full grid-cols-2 grid-rows-2 brightness-[0.5] saturate-[0.7]">
                {imagesWithUrl.map((inst) => (
                  <img key={inst.id} src={imgSrc(inst.image_url!)} alt="" className="h-full w-full object-cover" />
                ))}
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-primary-container/20">
                <svg className="h-5 w-5 text-primary" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 2h12v12H2zM5 5h6M5 8h6M5 11h3" />
                </svg>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-on-surface leading-tight">{allLabel}</p>
            <p className="text-[10px] uppercase text-on-surface-variant/60">All sources combined</p>
          </div>
          {selectedId === allKey && (
            <svg className="h-5 w-5 shrink-0 text-primary" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
          )}
        </button>

        {instances.map((inst) => {
          const isActive = selectedId === String(inst.id);
          return (
            <button
              key={inst.id}
              onClick={() => onSelect(String(inst.id))}
              className={`group flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                isActive
                  ? 'bg-surface-container-high border border-primary/20'
                  : 'hover:bg-surface-container-highest'
              }`}
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded">
                {inst.image_url ? (
                  <img
                    src={imgSrc(inst.image_url)}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className={`flex h-full w-full items-center justify-center ${isActive ? 'bg-primary-container/20' : 'bg-surface-container-highest'}`}>
                    <svg className={`h-5 w-5 ${isActive ? 'text-primary' : 'text-on-surface-variant'}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {inst.type === 'raid' ? (
                        <path d="M8 1l2 4 4.5.7-3.2 3.1.8 4.5L8 11l-4.1 2.3.8-4.5L1.5 5.7 6 5z" />
                      ) : (
                        <path d="M2 2h12v12H2zM5 5h6M5 8h6M5 11h3" />
                      )}
                    </svg>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-bold leading-tight transition-colors ${isActive ? 'text-on-surface' : 'text-on-surface group-hover:text-primary'}`}>
                  {inst.name}
                </p>
                <p className="text-[10px] uppercase text-on-surface-variant/60">
                  {inst.type === 'raid' ? 'Raid' : 'Dungeon'}
                </p>
              </div>
              {isActive && (
                <svg className="h-5 w-5 shrink-0 text-primary" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
