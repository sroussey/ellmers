/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, test } from "bun:test";

describe("scripts/test.ts", () => {
  test("unit bun dry-run omits integration files and empty argv entries", async () => {
    const proc = Bun.spawn(["bun", "scripts/test.ts", "unit", "bun", "--dry-run"], {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain('"bun","test"');
    expect(stdout).not.toContain('""');
    expect(stdout).not.toContain(".integration.test.ts");
  });

  test("provider-nodellama vitest dry-run does not serialize the whole suite", async () => {
    // Llama integration files are serialized by a dedicated vitest project
    // (`fileParallelism: false`), not by a global --no-file-parallelism that
    // would also serialize every other file in a mixed run.
    const proc = Bun.spawn(
      ["bun", "scripts/test.ts", "integration", "provider-nodellama", "vitest", "--dry-run"],
      {
        cwd: import.meta.dir + "/..",
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).not.toContain("--no-file-parallelism");
  });

  test("rag vitest dry-run disables file parallelism to avoid OOM", async () => {
    const proc = Bun.spawn(
      ["bun", "scripts/test.ts", "integration", "rag", "vitest", "--dry-run"],
      {
        cwd: import.meta.dir + "/..",
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("--no-file-parallelism");
  });
});
