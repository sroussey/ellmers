/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataflowJson } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("DataflowJson transforms field", () => {
  it("accepts an optional transforms array", () => {
    const json: DataflowJson = {
      sourceTaskId: "a",
      sourceTaskPortId: "out",
      targetTaskId: "b",
      targetTaskPortId: "in",
      transforms: [{ id: "pick", params: { path: "created_at" } }],
    };
    expect(json.transforms?.[0]?.id).toBe("pick");
  });

  it("omits transforms entirely", () => {
    const json: DataflowJson = {
      sourceTaskId: "a",
      sourceTaskPortId: "out",
      targetTaskId: "b",
      targetTaskPortId: "in",
    };
    expect(json.transforms).toBeUndefined();
  });
});
