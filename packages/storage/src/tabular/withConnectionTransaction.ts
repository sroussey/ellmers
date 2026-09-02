/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util";
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

/** Identity dedupe, first occurrence wins (`Set` preserves insertion order). */
function dedupeByIdentity(participants: readonly AnyTabularStorage[]): AnyTabularStorage[] {
  return Array.from(new Set(participants));
}

/**
 * Runs `fn` inside one native transaction spanning every enlisted tabular
 * storage that shares a connection handle.
 *
 * An EMPTY participant list throws: a caller that built its list dynamically
 * and ended up with none asked for atomicity and would silently not get it.
 *
 * A list of only best-effort backends (InMemory, IndexedDB, FsFolder, …)
 * invokes `fn` with NO transaction and no atomicity — those backends have no
 * native transaction to open. That is deliberate (it keeps one call site
 * working across a native and a best-effort wiring) and is logged at debug.
 * Mixing a native-transaction backend with a best-effort backend in one call
 * throws. Participants bound to different connection handles also throw.
 *
 * Calling this from inside an open connection-scoped transaction on the SAME
 * connection throws `NestedConnectionTransactionError` — SQLite and Postgres
 * have no autonomous `BEGIN`, so hoist the participants into the outer call or
 * use a `SAVEPOINT`. "From inside" is literal: a call from another task that
 * merely OVERLAPS an open transaction in time is not nesting and is not
 * refused, whatever its participant list. On a single-session backend it waits
 * for the open transaction to commit and then opens its own.
 *
 * Inside `fn`, call ordinary methods on the original storage instances — not a
 * `tx` proxy. Enlisted writes join the open `BEGIN`; a write from a storage
 * that was not passed in throws `ConnectionReentryError` instead of quietly
 * landing outside the transaction.
 *
 * That refusal reaches async DESCENDANTS of `fn` — the callers whose writes
 * could otherwise escape the transaction. An unrelated concurrent caller on
 * the same connection is a different matter and is not refused here: on a
 * pooled backend it simply runs on another client, and on a single-session
 * backend the connection chain makes it wait. The one exception is the
 * browser's synchronous ALS shim, whose store is gone at the body's first
 * `await`: it cannot tell the two apart and refuses both.
 */
export async function withConnectionTransaction<T>(
  participants: readonly AnyTabularStorage[],
  fn: () => Promise<T>
): Promise<T> {
  const unique = dedupeByIdentity(participants);
  if (unique.length === 0) {
    throw new Error("withConnectionTransaction requires at least one participant");
  }

  const hosts: Array<AnyTabularStorage & ConnectionTransactionHost> = [];
  const bestEffort: AnyTabularStorage[] = [];
  for (const participant of unique) {
    if (isConnectionTransactionHost(participant)) {
      hosts.push(participant);
    } else {
      bestEffort.push(participant);
    }
  }

  if (hosts.length === 0) {
    getLogger().debug(
      "withConnectionTransaction: every participant is a best-effort storage; running without a transaction",
      { tables: unique.map((p) => (p as { readonly table?: string }).table ?? "unnamed") }
    );
    return fn();
  }
  if (bestEffort.length > 0) {
    throw new Error(
      "withConnectionTransaction: cannot mix native-transaction storages with best-effort storages"
    );
  }

  return hosts[0].runConnectionTransaction(unique, fn);
}
