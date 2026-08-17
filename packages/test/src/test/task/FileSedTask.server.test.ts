/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileSedTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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
});
