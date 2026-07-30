/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Requires `bun build`; skipped under the vitest/Node runner where `Bun` is undefined.
describe.skipIf(typeof Bun === "undefined")("storage browser bundle", () => {
  let outDir: string | undefined;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), "storage-browser-"));
  });

  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it("does not embed node:async_hooks (ConnectionMutex uses platform ALS)", async () => {
    const dir = outDir!;
    const proc = Bun.spawn(
      [
        "bun",
        "build",
        "--target=browser",
        "--packages=external",
        `--outdir=${dir}`,
        path.join(packageRoot, "src/browser.ts"),
      ],
      { cwd: packageRoot, stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode, `browser build failed:\n${stdout}\n${stderr}`).toBe(0);

    const browserJs = await readFile(path.join(dir, "browser.js"), "utf8");
    expect(browserJs).not.toMatch(/node:async_hooks|["']async_hooks["']/);
    // Shim factory must be inlined (not left as an external package import).
    expect(browserJs).toContain("createShimAls");
  });
});
