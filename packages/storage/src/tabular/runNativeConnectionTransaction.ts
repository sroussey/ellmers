/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getAlsStore, runInTransactionOnConnection } from "./ConnectionMutex.server";
import type { AnyTabularStorage } from "./ITabularStorage";
import {
  isConnectionTransactionHost,
  type ConnectionTransactionHost,
} from "./withConnectionTransaction";

export function assertSharedConnectionHandle(
  lead: ConnectionTransactionHost & { readonly table?: string },
  participants: readonly AnyTabularStorage[]
): object {
  const handle = lead.sharedConnectionHandle();
  if (handle === null) {
    throw new Error(
      `withConnectionTransaction: ${lead.table ?? "storage"} has no shared connection handle`
    );
  }
  for (const participant of participants) {
    const other = isConnectionTransactionHost(participant)
      ? participant.sharedConnectionHandle()
      : undefined;
    if (other !== handle) {
      const otherTable = (participant as { readonly table?: string }).table ?? "other";
      throw new Error(
        `withConnectionTransaction: participants do not share a connection handle (${lead.table ?? "storage"} vs ${otherTable})`
      );
    }
  }
  return handle;
}

/**
 * Hosts a connection-scoped transaction: one chain slot, one ALS store, one
 * BEGIN/COMMIT on the shared handle. Callers flush deferred `put` events in
 * `afterCommit` via {@link safeEmit} (not `emitPut`, which would re-queue
 * while the store is still active).
 */
export async function runNativeConnectionTransaction<T>(options: {
  readonly handle: object;
  readonly participants: readonly AnyTabularStorage[];
  readonly begin: () => Promise<void> | void;
  readonly commit: () => Promise<void> | void;
  readonly rollback: () => Promise<void> | void;
  readonly afterCommit: () => void;
  readonly afterRollback: () => void;
  readonly fn: () => Promise<T>;
}): Promise<T> {
  return runInTransactionOnConnection(options.handle, options.participants, async () => {
    await options.begin();
    try {
      const result = await options.fn();
      await options.commit();
      options.afterCommit();
      return result;
    } catch (err) {
      try {
        await options.rollback();
      } catch {
        // prefer the original error if rollback fails
      }
      options.afterRollback();
      throw err;
    }
  });
}

export function enqueueDeferredPut(owner: object, entity: unknown): boolean {
  const store = getAlsStore();
  if (store === undefined || !store.owners.has(owner)) return false;
  let queue = store.deferredPuts.get(owner);
  if (queue === undefined) {
    queue = [];
    store.deferredPuts.set(owner, queue);
  }
  queue.push(entity);
  return true;
}

export function takeDeferredPuts(owner: object): unknown[] {
  const store = getAlsStore();
  const queue = store?.deferredPuts.get(owner);
  if (queue === undefined) return [];
  store!.deferredPuts.delete(owner);
  return queue;
}

export function discardDeferredPuts(owner: object): void {
  getAlsStore()?.deferredPuts.delete(owner);
}

export function isEnlistedInConnectionTx(owner: object): boolean {
  const store = getAlsStore();
  return store !== undefined && store.owners.has(owner);
}

export function connectionTxQuery(): { query: (...args: never[]) => Promise<unknown> } | undefined {
  return getAlsStore()?.txQuery;
}

export function setConnectionTxQuery(
  query: { query: (...args: never[]) => Promise<unknown> } | undefined
): void {
  const store = getAlsStore();
  if (store !== undefined) store.txQuery = query;
}
