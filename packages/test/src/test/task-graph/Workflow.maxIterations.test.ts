/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

import { TestSimpleTask } from "@workglow/task-graph/test";

/**
 * The fluent Workflow builder (`.while`, `.map`, `.reduce`, `.forEach`) defaults
 * `maxIterations` to `"unbounded"` when the caller omits it. The raw task
 * constructors still require an explicit value — this default is builder-only
 * convenience.
 */
describe("Workflow loop methods default maxIterations to 'unbounded'", () => {
  it(".map() without maxIterations does not throw", () => {
    expect(() => {
      new Workflow().map().addTask(TestSimpleTask).endMap();
    }).not.toThrow();
  });

  it(".while() without maxIterations does not throw", () => {
    expect(() => {
      new Workflow()
        .while({ condition: () => false })
        .addTask(TestSimpleTask)
        .endWhile();
    }).not.toThrow();
  });

  it(".reduce() without maxIterations does not throw", () => {
    expect(() => {
      new Workflow().reduce({ initialValue: 0 }).addTask(TestSimpleTask).endReduce();
    }).not.toThrow();
  });

  it(".forEach() without maxIterations does not throw", () => {
    expect(() => {
      new Workflow().forEach().addTask(TestSimpleTask).endForEach();
    }).not.toThrow();
  });

  it("explicit maxIterations is preserved when passed", () => {
    const w = new Workflow();
    w.map({ maxIterations: 5 }).addTask(TestSimpleTask).endMap();
    const mapTask = w.graph
      .getTasks()
      .find((t) => (t.constructor as { type?: string }).type === "MapTask");
    expect(
      (mapTask as unknown as { config: { maxIterations: unknown } } | undefined)?.config
        .maxIterations
    ).toBe(5);
  });

  it("defaulted maxIterations on .map() is 'unbounded'", () => {
    const w = new Workflow();
    w.map().addTask(TestSimpleTask).endMap();
    const mapTask = w.graph
      .getTasks()
      .find((t) => (t.constructor as { type?: string }).type === "MapTask");
    expect(
      (mapTask as unknown as { config: { maxIterations: unknown } } | undefined)?.config
        .maxIterations
    ).toBe("unbounded");
  });
});
