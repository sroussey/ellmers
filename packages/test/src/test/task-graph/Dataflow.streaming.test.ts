/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dataflow,
  DATAFLOW_ALL_PORTS,
  registerBuiltInTransforms,
  TaskStatus,
} from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { beforeAll, describe, expect, it } from "vitest";

describe("Dataflow streaming + transforms (runner-only MVP)", () => {
  beforeAll(() => registerBuiltInTransforms());

  it("awaitStreamValue does NOT apply transforms; runner-path applyTransforms transforms once", async () => {
    // Use DATAFLOW_ALL_PORTS as source so setPortData(data) stores the entire
    // object directly into d.value (not d.value[portId]).
    const d = new Dataflow("a", DATAFLOW_ALL_PORTS, "b", "in");
    d.stream = new ReadableStream<any>({
      start(ctrl) {
        ctrl.enqueue({ type: "snapshot", data: { created_at: 1700000000 } });
        ctrl.enqueue({ type: "finish", data: { created_at: 1700000000 } });
        ctrl.close();
      },
    });
    d.setTransforms([
      { id: "pick", params: { path: "created_at" } },
      { id: "unixToIsoDate", params: { unit: "s" } },
    ]);

    await d.awaitStreamValue();
    // After awaitStreamValue: value should be the RAW snapshot data (not transformed).
    // awaitStreamValue only materialises the stream into d.value via setPortData;
    // it does NOT call applyTransforms.
    expect(d.value).toEqual({ created_at: 1700000000 });

    // Now simulate the runner post-stream apply:
    await d.applyTransforms(globalServiceRegistry);
    expect(d.value).toBe("2023-11-14T22:13:20.000Z");
  });

  it("double-call of applyTransforms on same dataflow would double-apply (proves single-apply is required)", async () => {
    // Documentary test - show why we don't want BOTH paths transforming.
    const d = new Dataflow("a", DATAFLOW_ALL_PORTS, "b", "in");
    d.value = { created_at: 1700000000 };
    d.setTransforms([
      { id: "pick", params: { path: "created_at" } },
      { id: "unixToIsoDate", params: { unit: "s" } },
    ]);
    await d.applyTransforms(globalServiceRegistry);
    expect(d.value).toBe("2023-11-14T22:13:20.000Z");
    // Second call: `pick({path:"created_at"})` on an ISO string returns undefined, then
    // `unixToIsoDate(undefined, {unit:"s"})` calls `new Date(NaN).toISOString()` which throws.
    // applyTransforms sets d.status = FAILED and re-throws - the dataflow is corrupted.
    // This confirms that applying transforms twice isn't safe; the runner is the single entry point.
    await expect(d.applyTransforms(globalServiceRegistry)).rejects.toThrow();
    expect(d.status).toBe(TaskStatus.FAILED); // dataflow is now in error state - non-idempotent
  });
});
