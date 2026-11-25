import type { WorkboxPlugin } from "workbox-core";

const STARTUP_LOCK = "ha-frontend-startup";
// Failed boot or overlapping foreground tabs must not prevent installation.
const MAX_STARTUP_WAIT = 120_000;

export const supportsServiceWorker = () =>
  "serviceWorker" in navigator &&
  (location.protocol === "https:" || location.hostname === "localhost");

declare global {
  interface Window {
    releaseFrontendStartup?: () => void;
  }
}

/** Give a visible document priority while its initial panel is rendering. */
export const prioritizeFrontendStartup = async () => {
  if (document.hidden || window.releaseFrontendStartup) {
    return;
  }

  let release: (() => void) | undefined;
  let timeout: number | undefined;
  const finish = () => release?.();
  const visibilityChanged = () => {
    if (document.hidden) {
      finish();
    }
  };

  try {
    if (!supportsServiceWorker() || !navigator.locks) {
      return;
    }
    // The route can finish before a queued shared lock has been granted.
    const rendered = new Promise<void>((resolve) => {
      release = resolve;
    });
    window.releaseFrontendStartup = finish;
    window.addEventListener("pagehide", finish);
    document.addEventListener("visibilitychange", visibilityChanged);
    timeout = window.setTimeout(finish, MAX_STARTUP_WAIT);
    await navigator.locks.request(
      STARTUP_LOCK,
      { mode: "shared" },
      () => rendered
    );
  } catch {
    // Storage policies can deny access to Web Locks.
  } finally {
    window.clearTimeout(timeout);
    window.removeEventListener("pagehide", finish);
    document.removeEventListener("visibilitychange", visibilityChanged);
    delete window.releaseFrontendStartup;
  }
};

/** Workbox installs missing entries serially. Give each foreground boot a turn
 * between transfers, without blocking a fetch requested by the actual page. */
export const createStartupPrecachePlugin = (): WorkboxPlugin => {
  let remaining = MAX_STARTUP_WAIT;
  return {
    async requestWillFetch({ event, request }) {
      if (event.type !== "install" || remaining <= 0) {
        return request;
      }
      const started = performance.now();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!navigator.locks) {
          remaining = 0;
          return request;
        }
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), remaining);
        await navigator.locks.request(
          STARTUP_LOCK,
          { signal: controller.signal },
          () => undefined
        );
      } catch {
        // Keep installing if the browser denies a lock or the wait budget expires.
        remaining = 0;
      } finally {
        clearTimeout(timeout);
        remaining -= performance.now() - started;
      }
      return request;
    },
  };
};
