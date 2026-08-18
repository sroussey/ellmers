/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyTabularStorage } from "./ITabularStorage";

/**
 * Host API implemented by SQLite / Postgres / DuckDB tabular storages so a
 * connection-scoped transaction can `BEGIN` once on the shared handle and
 * let every enlisted participant's ordinary `put`/`delete` join it.
 */
export interface ConnectionTransactionHost {
  sharedConnectionHandle(): object | null;
  runConnectionTransaction<T>(
    participants: readonly AnyTabularStorage[],
    fn: () => Promise<T>
  ): Promise<T>;
}

export function isConnectionTransactionHost(
  value: AnyTabularStorage
): value is AnyTabularStorage & ConnectionTransactionHost {
  const host = value as unknown as ConnectionTransactionHost;
  return (
    typeof host.runConnectionTransaction === "function" &&
    typeof host.sharedConnectionHandle === "function"
  );
}

function dedupeByIdentity(participants: readonly AnyTabularStorage[]): AnyTabularStorage[] {
  const seen = new Set<AnyTabularStorage>();
  const unique: AnyTabularStorage[] = [];
  for (const participant of participants) {
    if (seen.has(participant)) continue;
    seen.add(participant);
    unique.push(participant);
  }
  return unique;
}

/**
 * Runs `fn` inside one native transaction spanning every enlisted tabular
 * storage that shares a connection handle.
 *
 * An empty list, or a list of only best-effort backends (InMemory, IndexedDB,
 * FsFolder, …), invokes `fn` with no extra wrapping. Mixing a native-transaction
 * backend with a best-effort backend in one call throws. Participants bound to
 * different connection handles also throw.
 *
 * Inside `fn`, call ordinary methods on the original storage instances — not a
 * `tx` proxy. Enlisted writes join the open `BEGIN`; a storage that was not
 * passed in still throws `ConnectionReentryError`.
 */
export async function withConnectionTransaction<T>(
  participants: readonly AnyTabularStorage[],
  fn: () => Promise<T>
): Promise<T> {
  const unique = dedupeByIdentity(participants);
  if (unique.length === 0) return fn();

  const hosts: Array<AnyTabularStorage & ConnectionTransactionHost> = [];
  const bestEffort: AnyTabularStorage[] = [];
  for (const participant of unique) {
    if (isConnectionTransactionHost(participant)) {
      hosts.push(participant);
    } else {
      bestEffort.push(participant);
    }
  }

  if (hosts.length === 0) return fn();
  if (bestEffort.length > 0) {
    throw new Error(
      "withConnectionTransaction: cannot mix native-transaction storages with best-effort storages"
    );
  }

  return hosts[0].runConnectionTransaction(unique, fn);
}
