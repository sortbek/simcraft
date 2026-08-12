/**
 * Void Forge is hidden for now. The backend endpoints, query params and variant
 * generation are untouched — flipping this back to `true` restores the controls.
 *
 * Gear the user already owns still resolves: callers pass `void_forge: true`
 * when existing items are Void Forged, independently of this flag.
 */
export const VOID_FORGE_ENABLED = false;
