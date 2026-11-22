import { useSyncExternalStore } from "react";
import type { OfflineQueue, QueueSnapshot } from "./queue";

/** The queue's current state for a screen; redraws when it changes. */
export function useQueue(queue: OfflineQueue): QueueSnapshot {
  return useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
}

/** "1 acción por enviar", "2 acciones por enviar". */
export function pendingLabel(count: number): string {
  return count === 1 ? "1 acción por enviar" : `${count} acciones por enviar`;
}
