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

  test("--changed without a kind still delegates to turbo run test", async () => {
    const proc = Bun.spawn(["bun", "scripts/test.ts", "--changed", "HEAD", "--dry-run"], {
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
    expect(stdout).toContain('"turbo","run","test"');
    expect(stdout).toContain("--filter=...[HEAD]");
  });

  test("--changed with a kind does not hand the run to turbo run test", async () => {
    // CI jobs pass a kind (unit, integration, …) alongside --changed. If
    // --changed still short-circuits to `turbo run test`, those jobs run the
    // unit tier instead of their slice — rag/provider integration never runs,
    // or worse, a unit job's coverage is reported as the integration job's.
    const proc = Bun.spawn(["bun", "scripts/test.ts", "--changed", "HEAD", "unit", "--dry-run"], {
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
    expect(stdout).not.toContain('"turbo","run","test"');
  });

  test("provider-nodellama vitest dry-run disables file parallelism", async () => {
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
    expect(stdout).toContain("--no-file-parallelism");
  });
});
