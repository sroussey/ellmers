/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskEntitlementError, TaskInvalidInputError } from "@workglow/task-graph";
import { FileSedTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("FileSedTask (server - local files)", () => {
  const logger = getTestingLogger();
  setLogger(logger);
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `filesed-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("substitutes in a filesystem path", async () => {
    const filePath = join(testDir, "notes.txt");
    writeFileSync(filePath, "alpha\nbravo foo\ncharlie\n", "utf-8");

    const result = await new FileSedTask({
      defaults: { url: filePath, pattern: "foo", replacement: "bar" },
    }).run();

    expect(result.replacementCount).toBe(1);
    expect(result.text).toBe("alpha\nbravo bar\ncharlie\n");
  });

  test("leaves the source file unmodified", async () => {
    const filePath = join(testDir, "notes.txt");
    writeFileSync(filePath, "alpha\nbravo foo\n", "utf-8");

    await new FileSedTask({
      defaults: { url: filePath, pattern: "foo", replacement: "bar" },
    }).run();

    expect(readFileSync(filePath, "utf-8")).toBe("alpha\nbravo foo\n");
  });

  test("substitutes in a file:// URL", async () => {
    const filePath = join(testDir, "notes.txt");
    writeFileSync(filePath, "keep\nskip foo\nkeep too\n", "utf-8");

    const result = await new FileSedTask({
      defaults: { url: `file://${filePath}`, pattern: "foo", replacement: "bar" },
    }).run();

    expect(result.text).toBe("keep\nskip bar\nkeep too\n");
  });

  test("streams CRLF files from disk", async () => {
    const filePath = join(testDir, "windows.txt");
    writeFileSync(filePath, "one\r\ntwo foo\r\nthree\r\n", "utf-8");

    const result = await new FileSedTask({
      defaults: { url: filePath, pattern: "foo", replacement: "bar" },
    }).run();

    expect(result.text).toBe("one\ntwo bar\nthree\n");
  });

  test("throws for a missing file", async () => {
    const filePath = join(testDir, "missing.txt");

    await expect(
      new FileSedTask({
        defaults: { url: filePath, pattern: "foo", replacement: "bar" },
      }).run()
    ).rejects.toThrow();
  });

  test("refuses a path outside the configured roots", async () => {
    const outside = join(tmpdir(), `filesed-outside-${Date.now()}.txt`);
    writeFileSync(outside, "bravo foo\n", "utf-8");

    try {
      await expect(
        new FileSedTask({
          roots: [testDir],
          defaults: { url: outside, pattern: "foo", replacement: "bar" },
        }).run()
      ).rejects.toThrow(TaskEntitlementError);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  /**
   * The containment check runs AFTER `realpathSync`. A pre-realpath check
   * passes here — the link itself sits inside the root — and then opens the
   * target, which is the whole escape.
   */
  test("refuses a symlink that escapes the configured roots", async () => {
    const link = join(testDir, "escape.txt");
    symlinkSync("/etc/passwd", link);

    await expect(
      new FileSedTask({
        roots: [testDir],
        defaults: { url: link, pattern: "root", replacement: "x" },
      }).run()
    ).rejects.toThrow(TaskEntitlementError);
  });

  test("allows a symlink that stays inside the roots", async () => {
    const target = join(testDir, "target.txt");
    const link = join(testDir, "link.txt");
    writeFileSync(target, "alpha\nbravo foo\n", "utf-8");
    symlinkSync(target, link);

    const result = await new FileSedTask({
      roots: [testDir],
      defaults: { url: link, pattern: "foo", replacement: "bar" },
    }).run();

    expect(result.text).toBe("alpha\nbravo bar\n");
  });

  /**
   * `slice(7)` left the path percent-encoded, so a filer-authored name with a
   * space or a `%` addressed a file that does not exist.
   */
  test("parses file:// URLs rather than slicing the scheme", async () => {
    const filePath = join(testDir, "a b%c.txt");
    writeFileSync(filePath, "alpha\nbravo foo\n", "utf-8");

    const result = await new FileSedTask({
      defaults: {
        url: `file://${testDir}/a%20b%25c.txt`,
        pattern: "foo",
        replacement: "bar",
      },
    }).run();

    expect(result.text).toBe("alpha\nbravo bar\n");
  });

  test("rejects a file:// URL carrying a remote host", async () => {
    await expect(
      new FileSedTask({
        defaults: { url: "file://evil.example/etc/passwd", pattern: "root", replacement: "x" },
      }).run()
    ).rejects.toThrow(TaskInvalidInputError);
  });

  /**
   * `url.slice(7)` on a relative path opened it against the process cwd, so a
   * bare `package.json` was readable with no root, no containment and no
   * declaration.
   */
  test("resolves a relative path rather than reading it from the process cwd", async () => {
    await expect(
      new FileSedTask({
        roots: [testDir],
        defaults: { url: "package.json", pattern: "name", replacement: "x" },
      }).run()
    ).rejects.toThrow(TaskEntitlementError);
  });

  /**
   * The scheme test was case-sensitive, so `HTTP://x` fell through to the
   * filesystem branch and was opened as a relative path against the process
   * cwd. It must route to the fetch branch instead.
   */
  describe("uppercase schemes", () => {
    let prevSafeFetch: SafeFetchFn;

    beforeEach(() => {
      prevSafeFetch = registerSafeFetch(() =>
        Promise.resolve(
          new Response("alpha\nbravo foo\n", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          })
        )
      );
    });

    afterEach(() => {
      registerSafeFetch(prevSafeFetch);
    });

    test("treats HTTP:// case-insensitively", async () => {
      const result = await new FileSedTask({
        defaults: {
          url: "HTTP://example.com/log.txt",
          pattern: "foo",
          replacement: "bar",
        },
      }).run();

      expect(result.text).toBe("alpha\nbravo bar\n");
    });
  });

  describe.skipIf(!existsSync("/dev/zero"))("non-regular files", () => {
    test("refuses a character device", async () => {
      await expect(
        new FileSedTask({
          defaults: { url: "/dev/zero", pattern: "foo", replacement: "bar" },
        }).run()
      ).rejects.toThrow(TaskInvalidInputError);
    });
  });

  /**
   * `String.replace` backtracks exactly like `test` does, and the shape screen
   * is a heuristic rather than a decision procedure — so the enforced bound is
   * the wall-clock budget the substitution runs under.
   *
   * `(\w|\d)*$` bypasses the screen: its branches overlap on the digits both
   * accept, which comparing branch text cannot see. Measured here: 1 ms at
   * n=16, 25 ms at n=20, 392 ms at n=24, 1538 ms at n=26 — doubling per added
   * character, so the n=40 below is on the order of 2^40 steps. Unbounded it
   * blocks the event loop with no abort able to reach it; the run must instead
   * be REJECTED, and quickly.
   */
  test("a catastrophic pattern over a local file fails on the budget", async () => {
    const filePath = join(testDir, "evil.txt");
    writeFileSync(filePath, "1".repeat(40) + "!\n", "utf-8");

    const started = Date.now();
    await expect(
      new FileSedTask({
        defaults: { url: filePath, pattern: "(\\w|\\d)*$", replacement: "X" },
      }).run()
    ).rejects.toThrow(/budget/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("the budget does not disturb an ordinary substitution", async () => {
    const filePath = join(testDir, "groups.txt");
    writeFileSync(filePath, "2026-08-17\nname: ada\n", "utf-8");

    const result = await new FileSedTask({
      defaults: {
        url: filePath,
        pattern: "(\\d{4})-(\\d{2})-(\\d{2})|name: (?<who>\\w+)",
        replacement: "[$3/$2/$1 $<who> $&]",
        global: true,
      },
    }).run();

    expect(result.replacementCount).toBe(2);
    expect(result.text).toBe("[17/08/2026  2026-08-17]\n[// ada name: ada]\n");
  });
});
