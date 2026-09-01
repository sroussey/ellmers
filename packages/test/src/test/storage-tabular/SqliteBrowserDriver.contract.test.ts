/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SqliteApi } from "@workglow/sqlite/storage";

/**
 * The browser (WASM) driver, exercised under Node.
 *
 * `@workglow/sqlite`'s `"./storage"` export resolves to the node driver
 * everywhere Vitest runs, so the browser build is loaded by path — the shipped
 * bundle, not the source. `@sqlite.org/sqlite-wasm` ships a Node entry, so the
 * WASM driver runs here unchanged; nothing about this suite needs a browser.
 *
 * Without it the browser driver has no coverage at all, and the contract it
 * shares with the node driver — an async transaction body is refused, a nested
 * transaction becomes a SAVEPOINT, `inTransaction` answers for the connection —
 * is only checked on one of the two implementations.
 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const browserBuild = pathToFileURL(join(repoRoot, "providers/sqlite/dist/storage/browser.js")).href;

const { Sqlite } = (await import(browserBuild)) as {
  Sqlite: {
    init(): Promise<void>;
    new (filename?: string): SqliteApi.Database;
    Database: new (filename?: string) => SqliteApi.Database;
  };
};

await Sqlite.init();

function makeDb(): SqliteApi.Database {
  const db = new Sqlite.Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  return db;
}

function countRows(db: SqliteApi.Database): number {
  const row = db.prepare<unknown[], { n: number }>("SELECT COUNT(*) AS n FROM t").get();
  return row?.n ?? 0;
}

describe("SQLite browser driver — contract", () => {
  let db: SqliteApi.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it("reports inTransaction from SQLite's own autocommit state", () => {
    expect(db.inTransaction).toBe(false);

    db.exec("BEGIN");
    expect(db.inTransaction).toBe(true);
    db.exec("ROLLBACK");
    expect(db.inTransaction).toBe(false);

    // Reading autocommit rather than tracking statements is what lets a
    // prepared BEGIN — which never passes through exec() — be seen.
    db.prepare("BEGIN").run();
    expect(db.inTransaction).toBe(true);
    db.exec("COMMIT");
    expect(db.inTransaction).toBe(false);
  });

  it("keeps inTransaction true while a savepoint unwinds inside an outer transaction", () => {
    db.exec("BEGIN");
    expect(() =>
      db.transaction(() => {
        throw new Error("boom");
      })()
    ).toThrow("boom");
    expect(db.inTransaction).toBe(true);
    db.exec("ROLLBACK");
    expect(db.inTransaction).toBe(false);
  });

  it("commits a synchronous body", () => {
    db.transaction(() => {
      db.prepare("INSERT INTO t (id) VALUES (1)").run();
    })();
    expect(countRows(db)).toBe(1);
  });

  it("rolls back and rethrows the original error when a synchronous body throws", () => {
    const boom = new Error("boom");
    expect(() =>
      db.transaction(() => {
        db.prepare("INSERT INTO t (id) VALUES (1)").run();
        throw boom;
      })()
    ).toThrow(boom);
    expect(countRows(db)).toBe(0);
  });

  it("opens a SAVEPOINT inside a transaction started by exec", () => {
    db.exec("BEGIN");
    db.transaction(() => {
      db.prepare("INSERT INTO t (id) VALUES (1)").run();
    })();
    expect(countRows(db)).toBe(1);

    // A nested BEGIN would have thrown above; a SAVEPOINT leaves the outer
    // transaction open, so rolling it back must take the row with it.
    db.exec("ROLLBACK");
    expect(countRows(db)).toBe(0);
  });

  it("unwinds only the inner transaction when a nested one throws", () => {
    db.transaction(() => {
      db.prepare("INSERT INTO t (id) VALUES (1)").run();
      expect(() =>
        db.transaction(() => {
          db.prepare("INSERT INTO t (id) VALUES (2)").run();
          throw new Error("inner");
        })()
      ).toThrow("inner");
    })();
    expect(countRows(db)).toBe(1);
  });

  it("rejects an async body instead of committing it", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      expect(() =>
        db.transaction(() => {
          db.prepare("INSERT INTO t (id) VALUES (1)").run();
          return Promise.reject(new Error("async body")) as unknown as void;
        })()
      ).toThrow(/cannot return a promise/i);
      expect(countRows(db)).toBe(0);

      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
