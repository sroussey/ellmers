/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./lib/testDiscovery";

/**
 * The wiring that decides whether anything ever exercises the BUILT BUNDLES.
 *
 * Every vitest project now attaches the source-resolving plugin, so a run that
 * does not ask for the `dist` target resolves `@workglow/*` to `src` and the
 * bundles are never loaded at all. Two callers have to ask for it: CI, and
 * `publish-all` — which otherwise version-bumps and pushes artifacts no test
 * in the pipeline has imported.
 *
 * Read as TEXT, on purpose. Importing the manifest would answer "what does the
 * JSON parse to", which is not the question: the question is whether the shell
 * command a human reads names the script. And the workflow is YAML that this
 * repo has no parser for, so treating it as text keeps the guard dependency-free
 * and lets it assert the ABSENCE of a key, which a parse would have to walk the
 * whole document to do.
 */
describe("dist-target wiring", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const workflow = readFileSync(join(ROOT, ".github/workflows/test.yml"), "utf8");

  it("defines the dist target inside the script, not at the call site", () => {
    // The variable is what makes the run mean anything, and no in-process
    // assertion can notice it went missing: `resolveTestTarget(undefined)`
    // returns "source", so a run stripped of it is a silent, green rerun of the
    // source job. Setting it in the script is the structural fix — dropping it
    // now requires deleting the script call, which the two checks below catch.
    const script = manifest.scripts["test:vitest:dist"];
    expect(script).toBeDefined();
    expect(script).toContain("WORKGLOW_TEST_TARGET=dist");
  });

  it("runs the dist target before publishing the artifacts it covers", () => {
    // `publish-all` rebuilds, then tests, then bumps versions and pushes. With
    // every project resolving to `src`, its test step stopped touching the
    // bundles it was about to publish.
    const publish = manifest.scripts["publish-all"];
    expect(publish).toBeDefined();
    expect(publish).toContain("test:vitest:dist");
    // Before the version bump, or it is testing an artifact set that has
    // already been tagged.
    expect(publish!.indexOf("test:vitest:dist")).toBeLessThan(publish!.indexOf("bunset"));
  });

  it("has CI invoke the same script rather than restate the variable", () => {
    expect(workflow).toContain("bun run test:vitest:dist");
    // One definition of "the dist target". An inline `env:` block here is how
    // CI and `publish-all` drift apart, and how a workflow edit silently
    // demotes the bundle-integrity job to a duplicate source run.
    expect(workflow).not.toMatch(/^\s*WORKGLOW_TEST_TARGET:/m);
  });

  it("keeps the dist pass out of the concurrent all-suites script", () => {
    // `test:vitest:all` fans seven suites out at once and merges coverage
    // fragments; the dist pass emits none (scripts/test.ts skips --coverage
    // when targeting dist), so adding it there buys nothing and competes for
    // the same cores.
    expect(manifest.scripts["test:vitest:all"]).not.toContain("test:vitest:dist");
  });
});
