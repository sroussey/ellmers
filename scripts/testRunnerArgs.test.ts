/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ROOT } from "./lib/testDiscovery";

/**
 * Runs the test runner in dry-run mode, which prints the command it would have
 * spawned as a JSON array instead of executing it.
 */
function dryRunCommand(env: Readonly<Record<string, string>>): string {
  const stdout = execFileSync("bun", ["scripts/test.ts", "unit", "vitest", "--dry-run"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("["));
  expect(line, `no command line in dry-run output:\n${stdout}`).toBeDefined();
  return line as string;
}

describe("scripts/test.ts coverage flag", () => {
  // The baseline the second case is measured against: CI runs are the ones
  // that produce the coverage fragments `merge-vitest-coverage` merges.
  it("asks for coverage on an ordinary CI run", () => {
    expect(dryRunCommand({ CI: "1" })).toContain('"--coverage"');
  });

  /**
   * A `dist`-targeted run exercises the built bundles, but the coverage
   * denominator names `packages/*` and `providers/*` SOURCES. Collecting
   * coverage there produces a fragment reporting all ~1286 source files at 0%,
   * which is not a measurement of anything — and if such a fragment were ever
   * merged it would drag the reported total toward zero for reasons unrelated
   * to how well the tree is tested.
   *
   * This is what lets the blocking `test-vitest-dist` CI job reuse
   * `test:vitest:unit` unchanged rather than needing its own invocation.
   */
  it("does not ask for coverage when the run targets the built bundles", () => {
    expect(dryRunCommand({ CI: "1", WORKGLOW_TEST_TARGET: "dist" })).not.toContain('"--coverage"');
  });
});
