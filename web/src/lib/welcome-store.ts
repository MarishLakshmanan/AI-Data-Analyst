export const WELCOME_KEY = "ai-data-analyst:welcome-seen:v1";
export type WelcomeState = "seen" | "unseen";

/** Tracks whether the visitor has dismissed the welcome page. Storage can be missing or blocked
 *  (private windows, disabled site data), so there is an in-memory fallback: the page then
 *  still disappears after "Continue" and only comes back on a full reload. */
export function createWelcomeStore(getStorage: () => Storage | undefined) {
  let memory = false;
  const listeners = new Set<() => void>();

  const getSnapshot = (): WelcomeState => {
    if (memory) return "seen";
    try {
      return getStorage()?.getItem(WELCOME_KEY) ? "seen" : "unseen";
    } catch {
      return "unseen";
    }
  };
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };
  const dismiss = () => {
    memory = true;
    try {
      getStorage()?.setItem(WELCOME_KEY, "1");
    } catch {}
    listeners.forEach((l) => l());
  };
  return { getSnapshot, subscribe, dismiss };
}

/** sessionStorage: shown once per browser tab session. Swap for localStorage to show it only once ever. */
export const welcomeStore = createWelcomeStore(() =>
  typeof window === "undefined" ? undefined : window.sessionStorage,
);
