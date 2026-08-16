/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileGrepTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
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
});
