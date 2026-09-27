/**
 * The loading splash is plain markup in index.html, so that it paints with the
 * document's first frame instead of waiting for a bundle.  Nothing in React
 * owns it, which leaves this module as the only thing that talks to it: it
 * takes the splash away once the scene has actually drawn.
 */

const BOOT_ID = "boot";

/** How long the splash's fade-out takes, matching the CSS transition. */
const FADE_MS = 560;

let dismissed = false;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Fades the splash out and removes it.
 *
 * Idempotent on purpose: StrictMode's double mount, a late failure and the
 * scene's own handoff can all reach this, and only the first call should count.
 */
export function dismissBoot() {
  if (dismissed) return;
  dismissed = true;

  const boot = document.getElementById(BOOT_ID);
  if (!boot) return;

  if (prefersReducedMotion()) {
    boot.remove();
    return;
  }

  boot.dataset.state = "done";
  window.setTimeout(() => boot.remove(), FADE_MS);
}
