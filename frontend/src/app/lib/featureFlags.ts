/**
 * Void Forge controls (S2: Ascendant Venomstone). Set to `false` to hide them
 * between seasons; the backend endpoints and variant generation stay untouched.
 *
 * Gear the user already owns still resolves: callers pass `void_forge: true`
 * when existing items are Void Forged, independently of this flag.
 */
export const VOID_FORGE_ENABLED = true;

/** Static share viewer hosted on simhammer.com/viewer — no app backend to call. */
export const VIEWER_BUILD = !!process.env.NEXT_PUBLIC_VIEWER_BUILD;
