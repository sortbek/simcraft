import { API_URL } from '../lib/api';
import type { Instance } from './types';

interface DungeonGridProps {
  value: string;
  onChange: (value: string) => void;
  instances: Instance[];
  allKey: string;
  allLabel: string;
}

function imgSrc(imageUrl: string): string {
  return imageUrl.startsWith('/') ? `${API_URL}${imageUrl}` : imageUrl;
}

export default function DungeonGrid({
  value,
  onChange,
  instances,
  allKey,
  allLabel,
}: DungeonGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {/* "All" tile */}
      <button
        onClick={() => onChange(allKey)}
        className={`group relative flex aspect-[16/9] items-end overflow-hidden rounded-lg border transition-all duration-150 ${
          value === allKey
            ? 'border-gold/50 shadow-[0_0_12px_rgba(200,153,42,0.15)]'
            : 'border-border hover:border-gold/20'
        }`}
      >
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 brightness-[0.5] saturate-[0.7]">
          {instances
            .filter((inst) => inst.image_url)
            .slice(0, 4)
            .map((inst) => (
              <img
                key={inst.id}
                src={imgSrc(inst.image_url!)}
                alt=""
                className="h-full w-full object-cover"
              />
            ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />
        <div className="relative w-full px-3 pb-3 pt-1">
          <p
            className={`text-base font-bold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${value === allKey ? 'text-gold' : 'text-white'}`}
          >
            {allLabel}
          </p>
        </div>
      </button>

      {/* Individual dungeon tiles */}
      {instances.map((inst) => (
        <button
          key={inst.id}
          onClick={() => onChange(String(inst.id))}
          className={`group relative flex aspect-[16/9] items-end overflow-hidden rounded-lg border transition-all duration-150 ${
            value === String(inst.id)
              ? 'border-gold/50 shadow-[0_0_12px_rgba(200,153,42,0.15)]'
              : 'border-border hover:border-gold/20'
          }`}
        >
          <div className="absolute inset-0 bg-surface-2" />
          {inst.image_url && (
            <img
              src={imgSrc(inst.image_url)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover brightness-[0.6] saturate-[0.8] transition-all duration-300 group-hover:scale-105 group-hover:brightness-75"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <div className="relative w-full px-3 pb-3 pt-1">
            <p
              className={`text-base font-bold leading-snug drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] ${
                value === String(inst.id) ? 'text-gold' : 'text-white'
              }`}
            >
              {inst.name}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
