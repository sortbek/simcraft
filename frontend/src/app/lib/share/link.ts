// NEXT_PUBLIC_SHARE_ORIGIN points the app at a local website for testing; the
// viewer is hosted by the website itself, so it stays same-origin.
export const SHARE_ORIGIN = process.env.NEXT_PUBLIC_VIEWER_BUILD
  ? ''
  : (process.env.NEXT_PUBLIC_SHARE_ORIGIN || 'https://simhammer.com').replace(/\/+$/, '');
const ID = '([A-Za-z0-9]{10})';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = [
  new RegExp(`^${ID}$`),
  new RegExp(`^(?:https?://)?(?:www\\.)?simhammer\\.com/sim/${ID}(?:[/?#].*)?$`),
  new RegExp(`^${escapeRe(SHARE_ORIGIN)}/sim/${ID}(?:[/?#].*)?$`),
  new RegExp(`^simhammer://sim/${ID}/?$`),
];

export function parseShareInput(text: string): string | null {
  const t = text.trim();
  for (const re of PATTERNS) {
    const m = t.match(re);
    if (m) return m[1];
  }
  return null;
}

export function shareUrl(id: string): string {
  return `${SHARE_ORIGIN}/sim/${id}`;
}
