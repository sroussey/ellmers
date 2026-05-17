/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import "fake-indexeddb/auto";

import { indexedDbQueueMigrations } from "@workglow/indexeddb/job-queue";
import { IndexedDbMigrationRunner } from "@workglow/indexeddb/storage";
import { describe, expect, it } from "vitest";

/**
 * Regression test for the v1 → v2 IndexedDB queue migration.
 *
 * Scenario the v2 migration must handle:
 *   1. A pre-PR install ran the original v1 (which named the compound index
 *      `queue_status_run_after` and stored `run_after` per row).
 *   2. Upgrade lands; v2 must drop the old index, walk every row and copy
 *      `run_after → visible_at`, then recreate the index as
 *      `queue_status_visible_at` keyed on `visible_at`.
 *
 * The migration `up()` body MUST be synchronous — IDB upgrade transactions
 * auto-commit on the next microtask, so any `await` between IDB requests
 * would lose the rest of the migration. We verify that the cursor walk
 * succeeds entirely inside the upgrade tx.
 */
describe("indexedDB queue migrations: v1 → v2 rename + backfill", () => {
  it("synthetic v1 DB upgrades cleanly: rows carry visible_at, index renamed", async () => {
    const dbName = `wglw_idb_qm_${Math.random().toString(36).slice(2)}`;
    const tableName = "jobs";

    // ── (1) Hand-build a v1 DB exactly as the pre-PR migration would have:
    // create the object store + the four v1 indexes (including the old
    // `queue_status_run_after`), then seed a row with `run_after` set and
    // `visible_at` absent.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName, 2); // bookkeeping store + queue store
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Synthetic bookkeeping store that records v1 as already applied so
        // the runner doesn't re-execute v1 (its createObjectStore would throw).
        if (!db.objectStoreNames.contains("_storage_migrations")) {
          db.createObjectStore("_storage_migrations", { keyPath: ["component", "version"] });
        }
        if (!db.objectStoreNames.contains(tableName)) {
          const store = db.createObjectStore(tableName, { keyPath: "id" });
          store.createIndex("queue_status", ["queue", "status"], { unique: false });
          // The legacy v1 index name + key path.
          store.createIndex("queue_status_run_after", ["queue", "status", "run_after"], {
            unique: false,
          });
          store.createIndex("queue_job_run_id", ["queue", "job_run_id"], { unique: false });
          store.createIndex("queue_fingerprint_status", ["queue", "fingerprint", "status"], {
            unique: false,
          });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["_storage_migrations", tableName], "readwrite");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
        // Record v1 as already applied.
        tx.objectStore("_storage_migrations").put({
          component: `queue:indexeddb:${tableName}`,
          version: 1,
          description: "Create queue object store + indexes",
          appliedAt: new Date().toISOString(),
        });
        // Seed a row exactly as the v1 schema would have stored it.
        tx.objectStore(tableName).put({
          id: 1,
          queue: "test",
          fingerprint: "fp1",
          job_run_id: "jr1",
          status: "PENDING",
          input: "{}",
          run_after: "2026-01-01T00:00:00.000Z",
        });
      };
    });

    // ── (2) Run the full migration chain. v1 is recorded → skipped; v2
    // executes the rename + backfill.
    const runner = new IndexedDbMigrationRunner(dbName);
    await runner.run(indexedDbQueueMigrations(tableName, []));

    // ── (3) Verify: old index gone, new index present, row's visible_at
    // equals the original run_after, and peek/next-style queries still work.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction([tableName], "readonly");
          const store = tx.objectStore(tableName);
          const names = Array.from(store.indexNames);
          expect(names).not.toContain("queue_status_run_after");
          expect(names).toContain("queue_status_visible_at");

          const getReq = store.get(1);
          getReq.onsuccess = () => {
            const row = getReq.result as
              | { id: number; run_after: string; visible_at?: string }
              | undefined;
            try {
              expect(row).toBeDefined();
              expect(row!.visible_at).toBe("2026-01-01T00:00:00.000Z");
              // Cursor walk on the new index also succeeds — proves the
              // backfill produced data the new index can serve.
              const idx = store.index("queue_status_visible_at");
              const cReq = idx.openCursor();
              cReq.onsuccess = () => {
                const cursor = cReq.result;
                try {
                  expect(cursor).not.toBeNull();
                } catch (e) {
                  reject(e);
                  return;
                }
              };
              tx.oncomplete = () => {
                db.close();
                resolve();
              };
              tx.onerror = () => {
                db.close();
                reject(tx.error);
              };
            } catch (e) {
              db.close();
              reject(e);
            }
          };
          getReq.onerror = () => {
            db.close();
            reject(getReq.error);
          };
        } catch (e) {
          db.close();
          reject(e);
        }
      };
    });
  });
});
