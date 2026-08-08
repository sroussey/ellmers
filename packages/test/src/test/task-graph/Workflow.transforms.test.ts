/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerBuiltInTransforms, Workflow } from "@workglow/task-graph";
import { beforeAll, describe, expect, it } from "vitest";

import { TestSimpleTask } from "@workglow/task-graph/test";

describe("Workflow .rename accepts { transforms }", () => {
  beforeAll(() => registerBuiltInTransforms());

  it(".rename({ transforms }) attaches transforms to the pending dataflow", () => {
    const w = new Workflow();
    w.addTask(TestSimpleTask).rename("output", "input", {
      transforms: [{ id: "uppercase" }],
    });

    // rename pushes a pending Dataflow onto WorkflowBuilder._dataFlows (no
    // target yet). Inspect it via the private field through a cast — this is
    // a behavioural test only.
    const pendingDataflows = (
      w.builder as unknown as { _dataFlows: { getTransforms(): readonly { id: string }[] }[] }
    )._dataFlows;
    expect(pendingDataflows).toHaveLength(1);
    expect(pendingDataflows[0].getTransforms().map((t) => t.id)).toEqual(["uppercase"]);
  });

  it(".rename(source, target, index) (numeric) still works without options", () => {
    const w = new Workflow();
    w.addTask(TestSimpleTask).rename("output", "input", -1);
    const pending = (
      w.builder as unknown as { _dataFlows: { getTransforms(): readonly unknown[] }[] }
    )._dataFlows;
    expect(pending).toHaveLength(1);
    expect(pending[0].getTransforms()).toHaveLength(0);
  });

  it(".rename({ index, transforms }) honours both options", () => {
    const w = new Workflow();
    w.addTask(TestSimpleTask).rename("output", "input", {
      index: -1,
      transforms: [{ id: "uppercase" }, { id: "lowercase" }],
    });
    const pending = (
      w.builder as unknown as { _dataFlows: { getTransforms(): readonly { id: string }[] }[] }
    )._dataFlows;
    expect(pending[0].getTransforms().map((t) => t.id)).toEqual(["uppercase", "lowercase"]);
  });
});
