/** The app's scroll area sits below the top bar rather than the window, so the
 *  scrollbar starts under it. Falls back to the document where there is no app
 *  shell (the viewer build). */
export const APP_SCROLL_ID = 'app-scroll';

export function scrollRoot(): HTMLElement {
  return (
    document.getElementById(APP_SCROLL_ID) ??
    (document.scrollingElement as HTMLElement | null) ??
    document.documentElement
  );
}

/** Where the scroll area's visible top sits in the viewport: 0 for the
 *  document, below the top bar for the app shell. */
export function scrollViewTop(root: HTMLElement = scrollRoot()): number {
  return root === document.scrollingElement || root === document.documentElement
    ? 0
    : root.getBoundingClientRect().top;
}
