/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Workflow } from "@workglow/task-graph";
import {
  bindWorkflowTrigger,
  getWorkflowTriggers,
  installWorkflowTriggers,
  IntervalTrigger,
  listenWorkflow,
  stopWorkflowListening,
} from "@workglow/triggers";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const triggersSource = (relative: string): string =>
  readFileSync(resolve(repoRoot, "packages/triggers/src", relative), "utf8");

/**
 * The barrel must stay PURE. `workglow` re-exports it, and `workglow`'s manifest
 * declares only `./dist/auto-bootstrap.js` side-effectful — an allow-list that
 * is only honest while importing `@workglow/triggers` installs nothing. If the
 * import-time `Workflow.prototype` patch ever comes back, a bundler must keep
 * the whole barrel, and with it `@workglow/duckdb`, `postgres`, `sqlite` and
 * `mcp`, none of which declare `sideEffects` at all.
 */
describe("installWorkflowTriggers", () => {
  // FIRST, before anything in this file installs: the behavioral guard.
  test("importing the package leaves Workflow.prototype unpatched", () => {
    expect(Object.prototype.hasOwnProperty.call(Workflow.prototype, "trigger")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(Workflow.prototype, "listen")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(Workflow.prototype, "stopListening")).toBe(false);
    expect(new Workflow().trigger).toBeUndefined();
  });

  /**
   * The backstop for the case above. That test depends on this file being the
   * first to touch `Workflow.prototype` in its process — true under vitest's
   * per-file isolation, but not a property the source itself carries. This one
   * reads the source and holds no matter what ran first.
   */
  test("no module body patches Workflow.prototype outside the installer", () => {
    const common = triggersSource("common.ts");
    expect(common).not.toMatch(/^\s*import\s+["']\.\/workflow\/WorkflowTriggers["']/m);

    const module = triggersSource("workflow/WorkflowTriggers.ts");
    const assignments = module.match(/^Workflow\.prototype\.\w+\s*=/gm) ?? [];
    // Every assignment is indented, i.e. inside installWorkflowTriggers().
    expect(assignments).toEqual([]);
    expect(module).toMatch(/export function installWorkflowTriggers\(\): void \{/);
  });

  test("the free functions work with no install at all", async () => {
    const workflow = new Workflow();
    const trigger = new IntervalTrigger({ intervalMs: 60_000, unrefTimer: true });

    expect(bindWorkflowTrigger(workflow, trigger)).toBe(workflow);
    expect(getWorkflowTriggers(workflow)).toEqual([trigger]);

    const handle = await listenWorkflow(workflow);
    expect(handle.triggers).toEqual([trigger]);
    expect(trigger.running).toBe(true);

    await stopWorkflowListening(workflow);
    expect(trigger.running).toBe(false);
  });

  test("installs the fluent methods, and is idempotent", () => {
    installWorkflowTriggers();

    const installed = Workflow.prototype.trigger;
    expect(typeof installed).toBe("function");
    expect(typeof Workflow.prototype.listen).toBe("function");
    expect(typeof Workflow.prototype.stopListening).toBe("function");

    // A second call must not re-wrap: a consumer calling it defensively at every
    // entry point would otherwise build a chain of delegating closures.
    installWorkflowTriggers();
    expect(Workflow.prototype.trigger).toBe(installed);
  });

  test("the installed methods delegate to the free functions", async () => {
    installWorkflowTriggers();

    const workflow = new Workflow();
    const trigger = new IntervalTrigger({ intervalMs: 60_000, unrefTimer: true });

    expect(workflow.trigger(trigger)).toBe(workflow);
    expect(getWorkflowTriggers(workflow)).toEqual([trigger]);

    const handle = await workflow.listen();
    expect(handle.triggers).toEqual([trigger]);

    await workflow.stopListening();
    expect(trigger.running).toBe(false);
  });
});
