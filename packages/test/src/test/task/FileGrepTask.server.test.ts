/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskEntitlementError, TaskInvalidInputError } from "@workglow/task-graph";
import { FileGrepTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("FileGrepTask (server - local files)", () => {
  const logger = getTestingLogger();
  setLogger(logger);
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `filegrep-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("greps a filesystem path", async () => {
    const filePath = join(testDir, "notes.txt");
    writeFileSync(filePath, "alpha\nbravo foo\ncharlie\n", "utf-8");

    const result = await new FileGrepTask({
      defaults: { url: filePath, pattern: "foo" },
    }).run();

    expect(result.matchCount).toBe(1);
    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 2,
        lines: [{ line: 2, text: "bravo foo", match: true }],
      },
    ]);
  });

  test("greps a file:// URL", async () => {
    const filePath = join(testDir, "notes.txt");
    writeFileSync(filePath, "keep\nskip foo\nkeep too\n", "utf-8");

    const result = await new FileGrepTask({
      defaults: { url: `file://${filePath}`, pattern: "foo" },
    }).run();

    expect(result.matchCount).toBe(1);
    expect(result.groups[0].lines[0].text).toBe("skip foo");
  });

  test("streams CRLF files from disk", async () => {
    const filePath = join(testDir, "windows.txt");
    writeFileSync(filePath, "one\r\ntwo foo\r\nthree\r\n", "utf-8");

    const result = await new FileGrepTask({
      defaults: { url: filePath, pattern: "foo" },
    }).run();

    expect(result.groups).toEqual([
      {
        startLine: 2,
        endLine: 2,
        lines: [{ line: 2, text: "two foo", match: true }],
      },
    ]);
  });

  test("throws for a missing file", async () => {
    const filePath = join(testDir, "missing.txt");

    await expect(
      new FileGrepTask({
        defaults: { url: filePath, pattern: "foo" },
      }).run()
    ).rejects.toThrow();
  });

  test("refuses a path outside the configured roots", async () => {
    const outside = join(tmpdir(), `filegrep-outside-${Date.now()}.txt`);
    writeFileSync(outside, "bravo foo\n", "utf-8");

    try {
      await expect(
        new FileGrepTask({
          roots: [testDir],
          defaults: { url: outside, pattern: "foo" },
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
      new FileGrepTask({
        roots: [testDir],
        defaults: { url: link, pattern: "root" },
      }).run()
    ).rejects.toThrow(TaskEntitlementError);
  });

  test("allows a symlink that stays inside the roots", async () => {
    const target = join(testDir, "target.txt");
    const link = join(testDir, "link.txt");
    writeFileSync(target, "alpha\nbravo foo\n", "utf-8");
    symlinkSync(target, link);

    const result = await new FileGrepTask({
      roots: [testDir],
      defaults: { url: link, pattern: "foo" },
    }).run();

    expect(result.matchCount).toBe(1);
  });

  /**
   * `slice(7)` left the path percent-encoded, so a filer-authored name with a
   * space or a `%` addressed a file that does not exist.
   */
  test("parses file:// URLs rather than slicing the scheme", async () => {
    const filePath = join(testDir, "a b%c.txt");
    writeFileSync(filePath, "alpha\nbravo foo\n", "utf-8");

    const result = await new FileGrepTask({
      defaults: { url: `file://${testDir}/a%20b%25c.txt`, pattern: "foo" },
    }).run();

    expect(result.matchCount).toBe(1);
  });

  test("rejects a file:// URL carrying a remote host", async () => {
    await expect(
      new FileGrepTask({
        defaults: { url: "file://evil.example/etc/passwd", pattern: "root" },
      }).run()
    ).rejects.toThrow(TaskInvalidInputError);
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
      const result = await new FileGrepTask({
        defaults: { url: "HTTP://example.com/log.txt", pattern: "foo" },
      }).run();

      expect(result.matchCount).toBe(1);
      expect(result.groups[0].lines[0].text).toBe("bravo foo");
    });
  });

  describe.skipIf(!existsSync("/dev/zero"))("non-regular files", () => {
    test("refuses a character device", async () => {
      await expect(
        new FileGrepTask({
          defaults: { url: "/dev/zero", pattern: "foo" },
        }).run()
      ).rejects.toThrow(TaskInvalidInputError);
    });
  });

  /**
   * The budget applies on the local path too, not only through the fetch
   * branch. `((a)*)*$` bypasses the shape screen and takes 8_234 ms at n=26,
   * doubling per character.
   */
  test("a catastrophic pattern over a local file fails on the budget", async () => {
    const filePath = join(testDir, "evil.txt");
    writeFileSync(filePath, "a".repeat(40) + "!\n", "utf-8");

    const started = Date.now();
    await expect(
      new FileGrepTask({
        defaults: { url: filePath, pattern: "((a)*)*$" },
      }).run()
    ).rejects.toThrow(/budget/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
