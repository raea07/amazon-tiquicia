/**
 * Working with a poor signal: a queue of actions sent when the connection
 * returns, and the last good answer to a read kept for reading offline.
 * See docs/research/expo-native-apps.md §4f.
 */
export {
  createOfflineQueue,
  type EntryStatus,
  type FlushResult,
  type OfflineQueue,
  type QueueEntry,
  type QueueOptions,
  type QueueSnapshot,
  type QueueStore,
  type Send,
  type SendOutcome,
} from "./queue";
export { pendingLabel, useQueue } from "./react";
export { createSnapshotCache, type Snapshot, type SnapshotCache } from "./snapshot";
