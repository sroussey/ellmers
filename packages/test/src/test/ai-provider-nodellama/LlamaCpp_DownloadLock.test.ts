/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ggufDownloadLockDir,
  ipullRenameDest,
  isBenignIpullRenameRace,
  withGgufDownloadLock,
} from "@workglow/node-llama-cpp/ai-runtime";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function renameEnoent(dest: string): NodeJS.ErrnoException {
  const err = new Error(
    `ENOENT: no such file or directory, rename '${dest}.ipull' -> '${dest}'`
  ) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  err.syscall = "rename";
  err.path = `${dest}.ipull`;
  (err as NodeJS.ErrnoException & { dest: string }).dest = dest;
  return err;
}

describe("gguf download lock", () => {
  it("derives a lock directory from models dir + URI", () => {
    const lockDir = ggufDownloadLockDir(
      "./models",
      "hf:bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M"
    );
    expect(lockDir).toContain("Qwen2.5-Coder-1.5B-Instruct");
    expect(lockDir.endsWith(".download.lock")).toBe(true);
  });

  it("serializes concurrent callbacks for the same lock directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gguf-lock-"));
    const lockDir = ggufDownloadLockDir(dir, "hf:example/model:Q4");
    let current = 0;
    let max = 0;
    await Promise.all(
      [1, 2, 3].map(() =>
        withGgufDownloadLock(lockDir, async () => {
          current += 1;
          max = Math.max(max, current);
          await new Promise<void>((resolve) => setTimeout(resolve, 30));
          current -= 1;
        })
      )
    );
    expect(max).toBe(1);
  });
});

describe("isBenignIpullRenameRace", () => {
  it("is true when rename ENOENT dest already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gguf-rename-"));
    const dest = join(dir, "model.gguf");
    await writeFile(dest, "ok");
    expect(isBenignIpullRenameRace(renameEnoent(dest))).toBe(true);
  });

  it("is false when rename ENOENT dest is missing", () => {
    expect(isBenignIpullRenameRace(renameEnoent("/tmp/does-not-exist-gguf-race.gguf"))).toBe(false);
  });

  it("walks err.cause to find the ipull rename dest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gguf-rename-cause-"));
    const dest = join(dir, "model.gguf");
    await writeFile(dest, "ok");
    const wrapped = new Error("Provider LOCAL_LLAMACPP failed for ModelDownloadTask");
    wrapped.cause = renameEnoent(dest);
    expect(ipullRenameDest(wrapped)).toBe(dest);
    expect(isBenignIpullRenameRace(wrapped)).toBe(true);
  });
});
