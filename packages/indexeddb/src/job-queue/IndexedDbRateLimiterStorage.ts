/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IRateLimiterStorage,
  PrefixColumn,
  RateLimiterStorageOptions,
  RateLimiterStorageScope,
} from "@workglow/job-queue";
import { createServiceToken } from "@workglow/util";
import { runIndexedDbMigrationGroups } from "../migrations/IndexedDbMigrationRunner";
import { indexedDbRateLimiterMigrationGroups } from "../migrations/indexedDbRateLimiterMigrations";
import { openIdb } from "../storage/openIdb";

export const INDEXED_DB_RATE_LIMITER_STORAGE = createServiceToken<IRateLimiterStorage>(
  "ratelimiter.storage.indexedDb"
);

export type IndexedDbRateLimiterStorageOptions = RateLimiterStorageOptions;

interface ExecutionRecord {
  readonly id?: string;
  readonly queue_name: string;
  readonly executed_at: string;
  readonly [key: string]: unknown;
}

interface NextAvailableRecord {
  readonly queue_name: string;
  readonly next_available_at: string;
  readonly [key: string]: unknown;
}

/**
 * IndexedDB implementation of rate limiter storage.
 * Manages execution records and next available times for rate limiting.
 *
 * Atomicity is `"process"`-scoped (browser tab) and the `next_available_at`
 * pre-check inside {@link tryReserveExecution} runs in a separate IDB
 * transaction from the count-and-insert. See {@link tryReserveExecution} for
 * the full caveat — do not assume cross-store atomicity.
 */
export class IndexedDbRateLimiterStorage implements IRateLimiterStorage {
  /**
   * `"process"` — IndexedDB is per-origin and shared across tabs but not across
   * processes (different machines, server processes). Within a single tab the
   * `readwrite` transaction below provides atomicity.
   */
  public readonly scope: RateLimiterStorageScope = "process";
  private executionDb: IDBDatabase | undefined;
  private nextAvailableDb: IDBDatabase | undefined;
  private readonly executionTableName: string;
  private readonly nextAvailableTableName: string;
  protected readonly prefixes: readonly PrefixColumn[];
  protected readonly prefixValues: Readonly<Record<string, string | number>>;

  constructor(options: IndexedDbRateLimiterStorageOptions = {}) {
    this.prefixes = options.prefixes ?? [];
    this.prefixValues = options.prefixValues ?? {};

    if (this.prefixes.length > 0) {
      const prefixNames = this.prefixes.map((p) => p.name).join("_");
      this.executionTableName = `rate_limit_executions_${prefixNames}`;
      this.nextAvailableTableName = `rate_limit_next_available_${prefixNames}`;
    } else {
      this.executionTableName = "rate_limit_executions";
      this.nextAvailableTableName = "rate_limit_next_available";
    }
  }

  private getPrefixColumnNames(): string[] {
    return this.prefixes.map((p) => p.name);
  }

  private matchesPrefixes(record: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(this.prefixValues)) {
      if (record[key] !== value) {
        return false;
      }
    }
    return true;
  }

  private getPrefixKeyValues(): Array<string | number> {
    return this.prefixes.map((p) => this.prefixValues[p.name]);
  }

  private async getExecutionDb(): Promise<IDBDatabase> {
    if (this.executionDb) return this.executionDb;
    await this.migrate();
    return this.executionDb!;
  }

  private async getNextAvailableDb(): Promise<IDBDatabase> {
    if (this.nextAvailableDb) return this.nextAvailableDb;
    await this.migrate();
    return this.nextAvailableDb!;
  }

  /**
   * Returns the versioned migration groups (one per IndexedDB database) that
   * the rate-limiter's tables depend on. The execution and next-available
   * stores live in separate databases, so this returns two groups.
   */
  public getMigrations() {
    return indexedDbRateLimiterMigrationGroups(
      this.executionTableName,
      this.nextAvailableTableName,
      this.prefixes
    );
  }

  /**
   * Applies any pending migrations for the rate limiter's two IndexedDB
   * databases, then opens long-lived connections at the migrated versions.
   * Idempotent — a second call closes any prior handles (so they don't pin
   * the pre-migration versions or block another tab's upgrade), reruns the
   * runner (no-op if everything is recorded as applied), and reopens.
   */
  public async migrate(): Promise<void> {
    if (this.executionDb) {
      try {
        this.executionDb.close();
      } catch {
        // ignore — close is best-effort
      }
      this.executionDb = undefined;
    }
    if (this.nextAvailableDb) {
      try {
        this.nextAvailableDb.close();
      } catch {
        // ignore — close is best-effort
      }
      this.nextAvailableDb = undefined;
    }
    await runIndexedDbMigrationGroups(this.getMigrations());
    this.executionDb = await openIdb(this.executionTableName);
    this.nextAvailableDb = await openIdb(this.nextAvailableTableName);
  }

  /**
   * Atomically reserves an execution slot in IndexedDB.
   *
   * Atomicity caveat: this implementation only serializes the `count + insert`
   * pair (under a single `readwrite` IDB transaction over the executions
   * store). The `next_available_at` lookup is a soft pre-check performed
   * BEFORE the tx, because the executions and next-available object stores
   * live in separate `IDBDatabase` instances by design (one
   * `ensureIndexedDbTable` call each) and IDB transaction scope cannot cross
   * databases. This is acceptable for IndexedDB's `"process"` scope: rate-
   * limit overshoot from a stale next-available read is bounded by single-
   * tab serial execution, and the stricter count check is what protects the
   * primary maxExecutions invariant.
   */
  public async tryReserveExecution(
    queueName: string,
    maxExecutions: number,
    windowMs: number
  ): Promise<unknown | null> {
    // Soft pre-check against external backoff. Done before opening the tx
    // because next-available lives in a separate IDBDatabase.
    const nextIso = await this.getNextAvailableTime(queueName);
    if (nextIso && new Date(nextIso).getTime() > Date.now()) {
      return null;
    }

    const execDb = await this.getExecutionDb();
    const prefixKeyValues = this.getPrefixKeyValues();
    const windowStartIso = new Date(Date.now() - windowMs).toISOString();
    const execTx = execDb.transaction(this.executionTableName, "readwrite");
    const execStore = execTx.objectStore(this.executionTableName);
    const insertedId = crypto.randomUUID();

    return new Promise<unknown | null>((resolve, reject) => {
      let liveCount = 0;
      let didInsert = false;
      const liveRange = IDBKeyRange.bound(
        [...prefixKeyValues, queueName, windowStartIso],
        [...prefixKeyValues, queueName, "￿"],
        true,
        false
      );
      const cursorReq = execStore.index("queue_executed_at").openCursor(liveRange);

      cursorReq.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value as ExecutionRecord;
          if (this.matchesPrefixes(record)) {
            liveCount++;
          }
          cursor.continue();
          return;
        }

        if (liveCount >= maxExecutions) {
          // Aborting fires execTx.onabort below, which resolves with `false`.
          // No INSERT happened, so capacity is preserved.
          execTx.abort();
          return;
        }

        const record: ExecutionRecord = {
          id: insertedId,
          queue_name: queueName,
          executed_at: new Date().toISOString(),
        };
        for (const [k, v] of Object.entries(this.prefixValues)) {
          (record as Record<string, unknown>)[k] = v;
        }
        const addReq = execStore.add(record);
        didInsert = true;
        addReq.onerror = () => {
          try {
            execTx.abort();
          } catch {
            // already aborted
          }
          reject(addReq.error);
        };
      };

      cursorReq.onerror = () => reject(cursorReq.error);
      execTx.oncomplete = () => resolve(didInsert ? insertedId : null);
      execTx.onerror = () => reject(execTx.error);
      execTx.onabort = () => resolve(null);
    });
  }

  public async releaseExecution(_queueName: string, token: unknown): Promise<void> {
    if (token === null || token === undefined) return;
    const db = await this.getExecutionDb();
    const tx = db.transaction(this.executionTableName, "readwrite");
    const store = tx.objectStore(this.executionTableName);
    return new Promise<void>((resolve, reject) => {
      // Delete by id — NEVER by recency. Two concurrent acquirers can hold
      // tokens for different rows; deleting "the most recent" would release
      // the other worker's slot.
      const req = store.delete(token as IDBValidKey);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getExecutionCount(queueName: string, windowStartTime: string): Promise<number> {
    const db = await this.getExecutionDb();
    const tx = db.transaction(this.executionTableName, "readonly");
    const store = tx.objectStore(this.executionTableName);
    const index = store.index("queue_executed_at");
    const prefixKeyValues = this.getPrefixKeyValues();

    return new Promise((resolve, reject) => {
      let count = 0;
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, queueName, windowStartTime],
        [...prefixKeyValues, queueName, "\uffff"],
        true, // exclude lower bound (windowStartTime)
        false
      );
      const request = index.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value as ExecutionRecord;
          if (this.matchesPrefixes(record)) {
            count++;
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  public async getOldestExecutionAtOffset(
    queueName: string,
    offset: number
  ): Promise<string | undefined> {
    const db = await this.getExecutionDb();
    const tx = db.transaction(this.executionTableName, "readonly");
    const store = tx.objectStore(this.executionTableName);
    const index = store.index("queue_executed_at");
    const prefixKeyValues = this.getPrefixKeyValues();

    return new Promise((resolve, reject) => {
      const executions: string[] = [];
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, queueName, ""],
        [...prefixKeyValues, queueName, "\uffff"]
      );
      const request = index.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value as ExecutionRecord;
          if (this.matchesPrefixes(record)) {
            executions.push(record.executed_at);
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        executions.sort();
        resolve(executions[offset]);
      };
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  public async getNextAvailableTime(queueName: string): Promise<string | undefined> {
    const db = await this.getNextAvailableDb();
    const tx = db.transaction(this.nextAvailableTableName, "readonly");
    const store = tx.objectStore(this.nextAvailableTableName);
    const prefixKeyValues = this.getPrefixKeyValues();
    const key = [...prefixKeyValues, queueName].join("_");

    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result as NextAvailableRecord | undefined;
        if (record && this.matchesPrefixes(record)) {
          resolve(record.next_available_at);
        } else {
          resolve(undefined);
        }
      };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  public async setNextAvailableTime(queueName: string, nextAvailableAt: string): Promise<void> {
    const db = await this.getNextAvailableDb();
    const tx = db.transaction(this.nextAvailableTableName, "readwrite");
    const store = tx.objectStore(this.nextAvailableTableName);
    const prefixKeyValues = this.getPrefixKeyValues();
    const key = [...prefixKeyValues, queueName].join("_");

    const record: NextAvailableRecord & { [key: string]: unknown } = {
      queue_name: queueName,
      next_available_at: nextAvailableAt,
    };

    for (const [k, value] of Object.entries(this.prefixValues)) {
      record[k] = value;
    }

    (record as Record<string, unknown>)[
      this.getPrefixColumnNames().concat(["queue_name"]).join("_")
    ] = key;

    return new Promise((resolve, reject) => {
      const request = store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      request.onerror = () => reject(request.error);
    });
  }

  public async clear(queueName: string): Promise<void> {
    const execDb = await this.getExecutionDb();
    const execTx = execDb.transaction(this.executionTableName, "readwrite");
    const execStore = execTx.objectStore(this.executionTableName);
    const execIndex = execStore.index("queue_executed_at");
    const prefixKeyValues = this.getPrefixKeyValues();

    await new Promise<void>((resolve, reject) => {
      const keyRange = IDBKeyRange.bound(
        [...prefixKeyValues, queueName, ""],
        [...prefixKeyValues, queueName, "\uffff"]
      );
      const request = execIndex.openCursor(keyRange);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const record = cursor.value as ExecutionRecord;
          if (this.matchesPrefixes(record)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      execTx.oncomplete = () => resolve();
      execTx.onerror = () => reject(execTx.error);
      request.onerror = () => reject(request.error);
    });

    const nextDb = await this.getNextAvailableDb();
    const nextTx = nextDb.transaction(this.nextAvailableTableName, "readwrite");
    const nextStore = nextTx.objectStore(this.nextAvailableTableName);
    const key = [...prefixKeyValues, queueName].join("_");

    await new Promise<void>((resolve, reject) => {
      const request = nextStore.delete(key);
      nextTx.oncomplete = () => resolve();
      nextTx.onerror = () => reject(nextTx.error);
      request.onerror = () => reject(request.error);
    });
  }
}
