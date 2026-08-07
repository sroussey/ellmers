/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dataflow, TaskGraph, Workflow } from "@workglow/task-graph";
import { ProcessItemTask, RefineTask } from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { CycleError } from "@workglow/util/graph";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

describe("Subgraph cycle guard", () => {
  setLogger(getTestingLogger());

  it("throws CycleError synchronously when addDataflow would create a back-edge on a top-level graph", () => {
    const graph = new TaskGraph();
    const a = new ProcessItemTask({ id: "a" });
    const b = new ProcessItemTask({ id: "b" });
    graph.addTask(a);
    graph.addTask(b);
    graph.addDataflow(new Dataflow("a", "processed", "b", "item"));

    expect(() => graph.addDataflow(new Dataflow("b", "processed", "a", "item"))).toThrow(
      CycleError
    );
  });

  it("rejects cycles inside a while-loop subgraph at addDataflow time", () => {
    const workflow = new Workflow();
    workflow
      .while({
        condition: (out: { quality?: number }) => (out.quality ?? 0) < 0.9,
        maxIterations: 3,
      })
      .addTask(RefineTask, undefined, { id: "refine-a" })
      .addTask(RefineTask, undefined, { id: "refine-b" })
      .endWhile();

    const whileTask = workflow.graph.getTasks()[0];
    const sub = whileTask.subGraph;
    const [taskA, taskB] = sub.getTasks();

    expect(() => sub.addDataflow(new Dataflow(taskB.id, "value", taskA.id, "value"))).toThrow(
      CycleError
    );
  });

  it("validateAcyclic() is a no-op on a healthy loop subgraph and runs cheaply", () => {
    const workflow = new Workflow();
    workflow
      .while({
        condition: () => false,
        maxIterations: 1,
      })
      .addTask(RefineTask)
      .endWhile();

    const whileTask = workflow.graph.getTasks()[0] as unknown as {
      validateAcyclic(): void;
    };

    expect(() => whileTask.validateAcyclic()).not.toThrow();
  });

  it("exposes TaskGraph.isAcyclic() as true for a healthy graph", () => {
    const graph = new TaskGraph();
    graph.addTask(new ProcessItemTask({ id: "x" }));
    graph.addTask(new ProcessItemTask({ id: "y" }));
    graph.addDataflow(new Dataflow("x", "processed", "y", "item"));

    expect(graph.isAcyclic()).toBe(true);
  });
});
