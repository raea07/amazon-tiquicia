/**
 * "Su cuenta fue eliminada", said once on the start screen the app returns
 * to after a deletion (the web's /cuenta-eliminada). Held in memory only:
 * nothing about the deleted account is written to the phone, and a restart
 * simply starts on the ordinary sign-in screen.
 */

let deleted = false;
const listeners = new Set<() => void>();

const announce = () => {
  for (const listener of listeners) listener();
};

export const accountDeletedNotice = {
  /** Called once the deletion went through, before the sign-out returns the app to its start. */
  mark(): void {
    deleted = true;
    announce();
  },
  /** The person read it, or started something else (signing in, creating an account). */
  dismiss(): void {
    if (!deleted) return;
    deleted = false;
    announce();
  },
  current: (): boolean => deleted,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
