/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryVectorStorage, TelemetryVectorStorage } from "@workglow/storage";
import {
  ConsoleTelemetryProvider,
  NoopTelemetryProvider,
  setTelemetryProvider,
} from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VectorSchema = {
  type: "object",
  properties: {
    id: { type: "integer", "x-auto-generated": true },
    vector: { type: "array", format: "TypedArray:Float32Array" },
    content: { type: "string" },
  },
  required: ["id", "vector", "content"],
} as const satisfies DataPortSchemaObject;

const VectorPK = ["id"] as const;

describe("TelemetryVectorStorage", () => {
  let inner: InstanceType<typeof InMemoryVectorStorage<typeof VectorSchema, typeof VectorPK>>;
  let wrapped: InstanceType<
    typeof TelemetryVectorStorage<Record<string, unknown>, typeof VectorSchema>
  >;
  let startSpanSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const provider = new ConsoleTelemetryProvider();
    setTelemetryProvider(provider);
    startSpanSpy = vi.spyOn(provider, "startSpan");

    inner = new InMemoryVectorStorage(VectorSchema, VectorPK, [], 3);
    wrapped = new TelemetryVectorStorage("test-vector", inner as any);

    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setTelemetryProvider(new NoopTelemetryProvider());
    vi.restoreAllMocks();
  });

  it("should forward put via inherited tabular wrapper and create a span", async () => {
    await wrapped.put({ vector: new Float32Array([1, 0, 0]), content: "hello" });
    expect(startSpanSpy).toHaveBeenCalledWith("workglow.storage.tabular.put", expect.anything());
  });

  it("should forward similaritySearch and create a span", async () => {
    await inner.put({ vector: new Float32Array([1, 0, 0]), content: "hello" });
    const results = await wrapped.similaritySearch(new Float32Array([1, 0, 0]));
    expect(results).toHaveLength(1);
    expect(startSpanSpy).toHaveBeenCalledWith(
      "workglow.storage.vector.similaritySearch",
      expect.objectContaining({
        attributes: expect.objectContaining({ "workglow.storage.name": "test-vector" }),
      })
    );
  });

  it("should forward getVectorDimensions without a span", () => {
    expect(wrapped.getVectorDimensions()).toBe(3);
  });
});
