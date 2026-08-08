/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Sqlite } from "@workglow/sqlite/storage";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

await Sqlite.init();

/** Fresh in-memory database with a single-column `t` table. */
function makeDb(): Sqlite.Database {
  const db = new Sqlite.Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  return db;
}

function countRows(db: Sqlite.Database): number {
  const row = db.prepare<unknown[], { n: number }>("SELECT COUNT(*) AS n FROM t").get();
  return row?.n ?? 0;
}

describe("SQLite driver — transaction()", () => {
  let db: Sqlite.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it("rejects an async body instead of committing it", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const tx = db.transaction(((): unknown => {
        db.prepare("INSERT INTO t (id) VALUES (1)").run();
        return (async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("late");
        })();
      }) as () => void);

      expect(() => tx()).toThrow(/cannot return a promise/);
      // The wrapper cannot commit work an async body has not finished, so the
      // INSERT the body already issued must be rolled back.
      expect(countRows(db)).toBe(0);

      // Give the swallowed body time to reject and the process time to notice.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
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

  it("opens a SAVEPOINT inside a transaction started by exec with a trailing semicolon", () => {
    db.exec("BEGIN;");
    db.transaction(() => {
      db.prepare("INSERT INTO t (id) VALUES (1)").run();
    })();
    expect(countRows(db)).toBe(1);

    // A nested BEGIN would have thrown above; a SAVEPOINT leaves the outer
    // transaction open, so rolling it back must take the row with it.
    db.exec("ROLLBACK");
    expect(countRows(db)).toBe(0);
  });

  it("opens a SAVEPOINT inside a transaction started by a prepared BEGIN", () => {
    db.prepare("BEGIN").run();
    db.transaction(() => {
      db.prepare("INSERT INTO t (id) VALUES (1)").run();
    })();
    expect(countRows(db)).toBe(1);

    db.exec("ROLLBACK");
    expect(countRows(db)).toBe(0);
  });

  it("still commits after a COMMIT that failed because nothing was open", () => {
    expect(() => db.exec("COMMIT")).toThrow();
    db.transaction(() => {
      db.prepare("INSERT INTO t (id) VALUES (1)").run();
    })();
    expect(countRows(db)).toBe(1);
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
      db.prepare("INSERT INTO t (id) VALUES (3)").run();
    })();

    const ids = db
      .prepare<unknown[], { id: number }>("SELECT id FROM t ORDER BY id")
      .all()
      .map((row) => row.id);
    expect(ids).toEqual([1, 3]);
  });
});

describe("SQLite driver — constructor options", () => {
  it.each([
    ["readonly", { readonly: true }],
    ["fileMustExist", { fileMustExist: true }],
    ["verbose", { verbose: () => {} }],
    ["nativeBinding", { nativeBinding: "/nope.node" }],
    ["nonsense", { nonsense: 1 }],
  ])("rejects the %s option", (_name, options) => {
    expect(() => new Sqlite.Database(":memory:", options as never)).toThrow(TypeError);
  });

  it("accepts the supported options", () => {
    const db = new Sqlite.Database(":memory:", { readOnly: false, timeout: 1234 });
    db.close();
  });
});

describe("SQLite driver — result rows", () => {
  let db: Sqlite.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it("returns rows with the ordinary object prototype", () => {
    const row = db.prepare<unknown[], { x: number }>("SELECT 1 AS x").get();
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(row, "x")).toBe(true);
    // A null-prototype row makes this throw rather than return a boolean.
    expect((row as unknown as { hasOwnProperty(k: string): boolean }).hasOwnProperty("x")).toBe(
      true
    );
    expect(row).toStrictEqual({ x: 1 });
  });

  it("returns all() rows with the ordinary object prototype", () => {
    db.exec("INSERT INTO t (id) VALUES (1), (2)");
    const rows = db.prepare<unknown[], { id: number }>("SELECT id FROM t ORDER BY id").all();
    expect(rows).toStrictEqual([{ id: 1 }, { id: 2 }]);
    for (const row of rows) expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });

  it("narrows BigInt integers back to numbers only when they round-trip", () => {
    db.exec("CREATE TABLE big (n INTEGER)");
    db.prepare("INSERT INTO big (n) VALUES (?)").run(Number.MAX_SAFE_INTEGER);
    db.prepare("INSERT INTO big (n) VALUES (?)").run(BigInt(Number.MAX_SAFE_INTEGER) + 10n);
    const rows = db
      .prepare<unknown[], { n: number | bigint }>("SELECT n FROM big ORDER BY n")
      .all();
    expect(rows[0]!.n).toBe(Number.MAX_SAFE_INTEGER);
    expect(rows[1]!.n).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 10n);
  });

  it("binds undefined as SQL NULL", () => {
    db.exec("CREATE TABLE nullable (id INTEGER PRIMARY KEY, v TEXT)");
    db.prepare("INSERT INTO nullable (id, v) VALUES (?, ?)").run(1, undefined);
    const row = db.prepare<unknown[], { v: string | null }>("SELECT v FROM nullable").get();
    expect(row?.v).toBeNull();
  });
});

describe("SQLite driver — error translation", () => {
  it("reports a UNIQUE violation with the better-sqlite3 code spelling", () => {
    const db = new Sqlite.Database(":memory:");
    try {
      db.exec("CREATE TABLE u (id INTEGER PRIMARY KEY, v TEXT UNIQUE)");
      db.prepare("INSERT INTO u (id, v) VALUES (1, 'a')").run();
      let caught: unknown;
      try {
        db.prepare("INSERT INTO u (id, v) VALUES (2, 'a')").run();
      } catch (err) {
        caught = err;
      }
      const e = caught as { code?: string; nodeCode?: string };
      expect(e.code).toBe("SQLITE_CONSTRAINT_UNIQUE");
      expect(e.nodeCode).toBe("ERR_SQLITE_ERROR");
    } finally {
      db.close();
    }
  });
});

describe("SQLite driver — foreign keys", () => {
  it("leaves foreign keys off by default", () => {
    const db = new Sqlite.Database(":memory:");
    try {
      const row = db.prepare<unknown[], { foreign_keys: number }>("PRAGMA foreign_keys").get();
      expect(row?.foreign_keys).toBe(0);
      db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
      db.exec("CREATE TABLE child (id INTEGER PRIMARY KEY, p INTEGER REFERENCES parent(id))");
      // A dangling reference is what an unenforced schema legitimately holds.
      db.prepare("INSERT INTO child (id, p) VALUES (1, 99)").run();
    } finally {
      db.close();
    }
  });

  it("enforces foreign keys when asked", () => {
    const db = new Sqlite.Database(":memory:", { enableForeignKeyConstraints: true });
    try {
      const row = db.prepare<unknown[], { foreign_keys: number }>("PRAGMA foreign_keys").get();
      expect(row?.foreign_keys).toBe(1);
      db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
      db.exec("CREATE TABLE child (id INTEGER PRIMARY KEY, p INTEGER REFERENCES parent(id))");
      let caught: unknown;
      try {
        db.prepare("INSERT INTO child (id, p) VALUES (1, 99)").run();
      } catch (err) {
        caught = err;
      }
      expect((caught as { code?: string }).code).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
    } finally {
      db.close();
    }
  });
});

describe("SQLite driver — file-backed database", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "workglow-sqlite-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens in WAL mode with the shared busy timeout", () => {
    const db = new Sqlite.Database(join(dir, "test.db"));
    try {
      const journal = db.prepare<unknown[], { journal_mode: string }>("PRAGMA journal_mode").get();
      expect(journal?.journal_mode).toBe("wal");
      const busy = db.prepare<unknown[], { timeout: number }>("PRAGMA busy_timeout").get();
      expect(busy?.timeout).toBe(5000);
    } finally {
      db.close();
    }
  });

  it("waits for a lock held by another connection instead of failing immediately", () => {
    const file = join(dir, "contended.db");
    const holder = new Sqlite.Database(file);
    const waiter = new Sqlite.Database(file, { timeout: 250 });
    try {
      holder.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      holder.exec("BEGIN IMMEDIATE");
      holder.prepare("INSERT INTO t (id) VALUES (1)").run();

      const start = Date.now();
      let caught: unknown;
      try {
        waiter.prepare("INSERT INTO t (id) VALUES (2)").run();
      } catch (err) {
        caught = err;
      }
      const waited = Date.now() - start;

      expect((caught as { code?: string }).code).toBe("SQLITE_BUSY");
      // Without a busy timeout the write fails in microseconds; the driver's
      // default makes it wait out the configured window first.
      expect(waited).toBeGreaterThanOrEqual(200);

      holder.exec("ROLLBACK");
    } finally {
      waiter.close();
      holder.close();
    }
  });
});
