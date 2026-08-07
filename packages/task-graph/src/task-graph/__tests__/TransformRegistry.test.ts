/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITransformDef } from "@workglow/task-graph";
import { TRANSFORM_DEFS, TransformRegistry, registerBuiltInTransforms } from "@workglow/task-graph";
import { globalServiceRegistry } from "@workglow/util";
import { beforeEach, describe, expect, it } from "vitest";

const dummy: ITransformDef<{ x: number }> = {
  id: "dummy-test",
  title: "Dummy",
  category: "Test",
  paramsSchema: undefined,
  inferOutputSchema: (schema) => schema,
  apply: (v) => v,
};

describe("TransformRegistry", () => {
  beforeEach(() => {
    TransformRegistry.unregisterTransform(dummy.id);
  });

  it("registers and looks up a transform", () => {
    TransformRegistry.registerTransform(dummy);
    expect(TransformRegistry.all.get("dummy-test")).toBe(dummy);
  });

  it("exposes the same map via the DI token", () => {
    TransformRegistry.registerTransform(dummy);
    const fromDI = globalServiceRegistry.get(TRANSFORM_DEFS);
    expect(fromDI.get("dummy-test")).toBe(dummy);
  });

  it("registerBuiltInTransforms registers all 13 MVP built-ins", () => {
    registerBuiltInTransforms();
    const ids = [
      "pick",
      "index",
      "coalesce",
      "uppercase",
      "lowercase",
      "truncate",
      "substring",
      "unixToIsoDate",
      "isoDateToUnix",
      "numberToString",
      "toBoolean",
      "stringify",
      "parseJson",
    ];
    for (const id of ids) {
      expect(TransformRegistry.all.has(id), `missing ${id}`).toBe(true);
    }
  });
});
