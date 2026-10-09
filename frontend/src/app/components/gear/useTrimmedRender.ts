import { useEffect, useState } from 'react';

/** Where simhammer.com's cropped render sat in Blizzard's full canvas. */
export interface RenderBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  canvasWidth: number;
}

/** `X-Render-Bounds: x,y,w,h` and `X-Render-Size: w,h`; null when absent or malformed. */
export function parseRenderBounds(bounds: string | null, size: string | null): RenderBounds | null {
  const b = bounds?.split(',').map(Number);
  const s = size?.split(',').map(Number);
  if (!b || !s || b.length !== 4 || s.length !== 2) return null;
  if ([...b, ...s].some((n) => !Number.isFinite(n)) || b[2] <= 0 || b[3] <= 0) return null;
  return { x: b[0], y: b[1], width: b[2], height: b[3], canvasWidth: s[0] };
}

/** Percent of the crop's width to shift left so the canvas centre, where Blizzard
 *  stands the body, lands on the anchor. A weapon held out to one side then
 *  doesn't pull the character off centre. */
export function renderCentreShift(b: RenderBounds): number {
  return ((b.canvasWidth / 2 - b.x) / b.width) * 100;
}

export type TrimmedRender =
  | { status: 'loading' }
  | { status: 'trimmed'; src: string; bounds: RenderBounds }
  /** The API sent no bounds: show the full canvas the old way. */
  | { status: 'full' }
  | { status: 'missing' };

/** Fetches `render?trim=1` so the bounds headers can be read, which an <img> can't. */
export function useTrimmedRender(url: string | null | undefined): TrimmedRender {
  const [state, setState] = useState<{ url: string; render: TrimmedRender } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      let render: TrimmedRender = { status: 'full' };
      try {
        const res = await fetch(`${url}?trim=1`);
        const bounds = parseRenderBounds(
          res.headers.get('X-Render-Bounds'),
          res.headers.get('X-Render-Size')
        );
        if (res.status === 404) render = { status: 'missing' };
        else if (res.ok && bounds) {
          objectUrl = URL.createObjectURL(await res.blob());
          render = { status: 'trimmed', src: objectUrl, bounds };
        }
      } catch {
        // Network or CORS trouble: let the plain <img> try the full canvas.
      }
      if (cancelled) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      setState({ url, render });
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (!url) return { status: 'missing' };
  return state?.url === url ? state.render : { status: 'loading' };
}
