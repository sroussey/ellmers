/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskEntitlementError, TaskInvalidInputError } from "@workglow/task-graph";
import { FileGrepTask, registerSafeFetch, type SafeFetchFn } from "@workglow/tasks";
import { DEFAULT_LIMITS, setLogger } from "@workglow/util";
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
      roots: [testDir],
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
      roots: [testDir],
      defaults: { url: `file://${filePath}`, pattern: "foo" },
    }).run();

    expect(result.matchCount).toBe(1);
    expect(result.groups[0].lines[0].text).toBe("skip foo");
  });

  test("streams CRLF files from disk", async () => {
    const filePath = join(testDir, "windows.txt");
    writeFileSync(filePath, "one\r\ntwo foo\r\nthree\r\n", "utf-8");

    const result = await new FileGrepTask({
      roots: [testDir],
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
        roots: [testDir],
        defaults: { url: filePath, pattern: "foo" },
      }).run()
    ).rejects.toThrow();
  });

  /**
   * Reproduced pre-fix with a 640 MB newline-free stream: `createInterface`
   * accumulated the whole thing and threw `RangeError: Invalid string length`
   * from a stream `'data'` listener. That surfaces as an `uncaughtException`,
   * not an iterator rejection, so `grepFile`'s try/catch never saw it and the
   * process died. 1 MB here is enough to exercise the cap without the memory.
   */
  test("a file with no line terminator does not crash the process", async () => {
    const filePath = join(testDir, "oneline.bin");
    writeFileSync(filePath, "x".repeat(1_000_000), "utf-8");

    const uncaught: unknown[] = [];
    const spy = (err: unknown): void => {
      uncaught.push(err);
    };
    process.on("uncaughtException", spy);

    try {
      const result = await new FileGrepTask({
        roots: [testDir],
        defaults: { url: filePath, pattern: "x" },
      }).run();

      expect(uncaught).toEqual([]);
      expect(result.matchCount).toBe(1);
      expect(result.groups[0].lines[0].text).toHaveLength(DEFAULT_LIMITS.grepMaxLineChars);
    } finally {
      process.off("uncaughtException", spy);
    }
  });

  test("caps an over-long line and reports truncation", async () => {
    const filePath = join(testDir, "long.txt");
    const long = "y".repeat(DEFAULT_LIMITS.grepMaxLineChars + 5_000);
    writeFileSync(filePath, `short\n${long}\ntail foo\n`, "utf-8");

    const result = await new FileGrepTask({
      roots: [testDir],
      defaults: { url: filePath, pattern: "y" },
    }).run();

    expect(result.truncated).toBe(true);
    const matched = result.groups.flatMap((g) => g.lines.filter((l) => l.match));
    expect(matched).toHaveLength(1);
    expect(matched[0].text).toHaveLength(DEFAULT_LIMITS.grepMaxLineChars);
  });

  /**
   * With no `roots` the resolver used to skip containment entirely, and the
   * `filesystem:read` entitlement is not a backstop for that: it is consulted
   * only when the embedder runs with `enforceEntitlements` AND registers an
   * enforcer, neither of which is the default. So an unconfigured host was
   * readable end to end by anything that could name this task. The default is
   * now the process working directory.
   */
  describe("root containment defaults to the process working directory", () => {
    test("refuses a path outside the cwd when no roots are configured", async () => {
      const outside = join(testDir, "notes.txt");
      writeFileSync(outside, "bravo foo\n", "utf-8");

      const run = new FileGrepTask({ defaults: { url: outside, pattern: "foo" } }).run();

      await expect(run).rejects.toThrow(TaskEntitlementError);
      // Naming the cwd is what tells an operator which root they actually got.
      await expect(run).rejects.toThrow(process.cwd());
    });

    test("reads a path inside the cwd when no roots are configured", async () => {
      const inside = join(process.cwd(), `filegrep-cwd-${Date.now()}`);
      mkdirSync(inside, { recursive: true });
      const filePath = join(inside, "notes.txt");
      writeFileSync(filePath, "alpha\nbravo foo\n", "utf-8");

      try {
        const result = await new FileGrepTask({
          defaults: { url: filePath, pattern: "foo" },
        }).run();

        expect(result.matchCount).toBe(1);
      } finally {
        rmSync(inside, { recursive: true, force: true });
      }
    });

    /**
     * The escape hatch is deliberately a separate, explicit statement rather
     * than something an omitted `roots` implies — an embedder that means "any
     * path this process can open" has to say so.
     */
    test("allowAnyRoot restores the unrestricted read", async () => {
      const outside = join(testDir, "notes.txt");
      writeFileSync(outside, "alpha\nbravo foo\n", "utf-8");

      const result = await new FileGrepTask({
        allowAnyRoot: true,
        defaults: { url: outside, pattern: "foo" },
      }).run();

      expect(result.matchCount).toBe(1);
    });

    test("allowAnyRoot must be the literal true, not merely truthy config", async () => {
      const outside = join(testDir, "notes.txt");
      writeFileSync(outside, "bravo foo\n", "utf-8");

      await expect(
        new FileGrepTask({
          allowAnyRoot: undefined,
          defaults: { url: outside, pattern: "foo" },
        }).run()
      ).rejects.toThrow(TaskEntitlementError);
    });
  });

  /**
   * `realpathSync` on a root used to run inside the `some()` predicate, which
   * short-circuits: `[good, missing]` never reached the broken root and
   * succeeded, while `[missing, good]` threw. Same config, same input,
   * opposite outcome by array order. Every root is resolved before any
   * containment verdict now, so a broken one fails always rather than
   * sometimes.
   */
  test("an unresolvable root is rejected regardless of its position", async () => {
    const filePath = join(testDir, "notes.txt");
    writeFileSync(filePath, "alpha\nbravo foo\n", "utf-8");
    const missing = join(testDir, "does-not-exist");

    for (const roots of [
      [testDir, missing],
      [missing, testDir],
    ]) {
      await expect(
        new FileGrepTask({ roots, defaults: { url: filePath, pattern: "foo" } }).run()
      ).rejects.toThrow(/Configured root .* could not be resolved/);
    }
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
      roots: [testDir],
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
          roots: ["/dev"],
          defaults: { url: "/dev/zero", pattern: "foo" },
        }).run()
      ).rejects.toThrow(TaskInvalidInputError);
    });
  });

  /**
   * The budget applies on the local path too, not only through the fetch
   * branch. `(\w|\d)*$` bypasses the shape screen — its branches overlap on the
   * digits both accept, which comparing branch text cannot see — and takes
   * 657 ms at n=26, doubling per added character.
   */
  test("a catastrophic pattern over a local file fails on the budget", async () => {
    const filePath = join(testDir, "evil.txt");
    writeFileSync(filePath, "1".repeat(40) + "!\n", "utf-8");

    const started = Date.now();
    await expect(
      new FileGrepTask({
        roots: [testDir],
        defaults: { url: filePath, pattern: "(\\w|\\d)*$" },
      }).run()
    ).rejects.toThrow(/budget/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
