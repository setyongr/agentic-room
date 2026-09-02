/**
 * Activity feed — pure entry creation and bounded appending.
 *
 * Entries are assembled exclusively from caller-provided metadata
 * (id/timestamp/type/message plus optional instance/product/amount), so the
 * feed only ever contains what the application itself reports — nothing is
 * synthesized here. The feed keeps the newest entries and never grows
 * beyond a fixed bound (50 by default).
 */

import type { ActivityEntry, ActivityType } from './types';

/** Default cap on the activity feed length: the newest 50 entries. */
export const ACTIVITY_FEED_LIMIT = 50;

/** Caller-provided metadata for one activity entry. */
export interface ActivityEntryMeta {
  /** caller-supplied entry id (deterministic for tests/replay) */
  id: string;
  type: ActivityType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** human-readable summary of what happened */
  message: string;
  /** affected placed furniture instance */
  instanceId?: string;
  /** affected product */
  productId?: string;
  /** numeric payload, e.g. a budget value or price delta */
  amount?: number;
}

/** Assemble one activity entry from caller-provided metadata. */
export function createActivityEntry(meta: ActivityEntryMeta): ActivityEntry {
  return {
    id: meta.id,
    type: meta.type,
    timestamp: meta.timestamp,
    message: meta.message,
    ...(meta.instanceId !== undefined ? { instanceId: meta.instanceId } : {}),
    ...(meta.productId !== undefined ? { productId: meta.productId } : {}),
    ...(meta.amount !== undefined ? { amount: meta.amount } : {}),
  };
}

/**
 * Append one entry to the feed, retaining only the newest `maxEntries`
 * entries (default {@link ACTIVITY_FEED_LIMIT}). Returns a new array with
 * the oldest entry dropped when the bound is reached; the input is never
 * mutated. A non-positive bound yields an empty feed.
 */
export function appendActivity(
  entries: readonly ActivityEntry[],
  entry: ActivityEntry,
  maxEntries: number = ACTIVITY_FEED_LIMIT,
): readonly ActivityEntry[] {
  if (maxEntries <= 0) {
    return [];
  }
  if (entries.length < maxEntries) {
    return [...entries, entry];
  }
  return [...entries.slice(entries.length - (maxEntries - 1)), entry];
}
