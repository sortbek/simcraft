// The showcase build (SHOWCASE_BUILD=1) runs the whole app on simhammer.com with
// no backend: every /api call is answered from a recorded session in
// /showcase/showcase-data.json, and the session's character comes from
// showcase-storage.json (both made by scripts/showcase). Calls the recording
// repeats with different answers (a sim's status while it runs) play back in
// order; a POST that starts a job rewinds that job's answers so it can run again.

type Answer = { s: number; t: string; body: string | null; b64?: boolean };
type Route = {
  m: string;
  host: string;
  p: string;
  req: string | null;
  r: Answer[];
};
type Storage = {
  local: Record<string, string>;
  session: Record<string, string>;
};

const DATA_URL = '/showcase/showcase-data.json';
const STORAGE_URL = '/showcase/showcase-storage.json';
const NOT_RECORDED =
  'This part of the tour needs the SimHammer app. Download it free at simhammer.com.';

let installed = false;

function decode(a: Answer): BodyInit | null {
  if (a.body == null) return null;
  if (!a.b64) return a.body;
  const bin = atob(a.body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Seeds storage with the recorded character, then answers /api calls from the recording. */
export function installShowcase() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  const data: Promise<{ routes: Route[] }> = realFetch(DATA_URL).then((r) => r.json());

  // Where a started sim is in its recorded answers. Kept in sessionStorage: the
  // result page loads in full right after the sim starts. A sim nobody started
  // here (one opened from the history) answers with its final state.
  const cursorKey = (r: Route) => `showcase_step:${r.p}`;
  const setCursor = (r: Route, i: number) => sessionStorage.setItem(cursorKey(r), String(i));
  const next = (r: Route): Answer => {
    const stored = r.r.length > 1 ? sessionStorage.getItem(cursorKey(r)) : null;
    if (stored == null) return r.r[r.r.length - 1];
    const i = Number(stored);
    setCursor(r, i + 1);
    return r.r[Math.min(i, r.r.length - 1)];
  };

  // Storage first, synchronously: the providers read it on mount.
  const xhr = new XMLHttpRequest();
  xhr.open('GET', STORAGE_URL, false);
  try {
    xhr.send();
    const storage = JSON.parse(xhr.responseText) as Storage;
    for (const [k, v] of Object.entries(storage.local))
      if (localStorage.getItem(k) == null) localStorage.setItem(k, v);
    for (const [k, v] of Object.entries(storage.session))
      if (sessionStorage.getItem(k) == null) sessionStorage.setItem(k, v);
  } catch {
    // Without storage the app starts with no character; the tour still runs.
  }

  const find = (routes: Route[], method: string, host: string, p: string, req: string | null) => {
    const same = routes.filter((r) => r.m === method && r.host === host && r.p === p);
    return same.find((r) => r.req === req) ?? same[0];
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : String(input), window.location.href);
    const local = url.origin === window.location.origin;
    if (!url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/data/static/')) {
      return realFetch(input, init);
    }
    // Any sim the visitor starts gets the recorded one's answers, whatever its settings.
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : req ? await req.clone().text() : null;
    const host = local ? '' : url.host;
    const route = find((await data).routes, method, host, url.pathname + url.search, body || null);
    if (!route) {
      // Nothing leaves the page but reads of the character's art; no sim, upload or save ever runs.
      if (!local && method === 'GET' && url.pathname.startsWith('/api/blizzard/'))
        return realFetch(input, init);
      return new Response(JSON.stringify({ detail: NOT_RECORDED }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    const answer = next(route);
    if (method === 'POST' && answer.body && !answer.b64) {
      const id = /"(?:id|job_id)"\s*:\s*"([0-9a-f-]{36})"/.exec(answer.body)?.[1];
      if (id)
        for (const r of (await data).routes)
          if (r.r.length > 1 && r.p.includes(id)) setCursor(r, 0);
    }
    // A little latency, so loading states show as they would against a server.
    await new Promise((res) => setTimeout(res, 120));
    const empty = answer.s === 204 || answer.s === 205 || answer.s === 304;
    return new Response(empty ? null : decode(answer), {
      status: answer.s,
      headers: { 'content-type': answer.t },
    });
  };
}
