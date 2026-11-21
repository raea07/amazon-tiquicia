/**
 * The web export's session storage: the browser's localStorage.
 *
 * The web export exists to test the screens in a browser; it is not how the
 * shop is offered on the web (that is apps/web, whose session cookie is
 * HttpOnly). A browser has no secure store, so nothing here is encrypted, and
 * this file must not be taken as the model for a public website.
 */

import type { SessionStorage } from "./secure-session-storage";

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage blocked (private mode, a sandboxed frame)
  }
}

const store: SessionStorage = {
  getItem: async (key) => local()?.getItem(key) ?? null,
  setItem: async (key, value) => {
    local()?.setItem(key, value);
  },
  removeItem: async (key) => {
    local()?.removeItem(key);
  },
};

export const sessionStorage: SessionStorage = store;
export const appStorage: SessionStorage = store;
