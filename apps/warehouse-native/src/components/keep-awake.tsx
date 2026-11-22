import { useKeepAwake } from "expo-keep-awake";

/**
 * Keeps the screen on while it is drawn: a worker walking the aisles with a
 * pick list open must not find the phone locked at the next bin. It ends
 * when the screen closes. Where the phone or browser refuses (the web
 * export, a browser without the Wake Lock API) nothing else changes.
 */
export function KeepAwake({ tag }: { tag: string }) {
  useKeepAwake(tag, { suppressDeactivateWarnings: true });
  return null;
}
