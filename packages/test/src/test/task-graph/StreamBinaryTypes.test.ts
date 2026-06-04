/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import type { StreamBinaryDelta, StreamEvent, StreamMode } from "@workglow/task-graph";
import {
  getPortStreamMode,
  getStreamingPorts,
  getOutputStreamMode,
  getBinaryPortId,
  edgeNeedsAccumulation,
  materializeBinary,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";

const binarySchema = {
  type: "object",
  properties: {
    bytes: { type: "object", format: "blob", "x-stream": "binary" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

const mixedSchema = {
  type: "object",
  properties: {
    text: { type: "string", "x-stream": "append" },
    bytes: { type: "object", format: "binary", "x-stream": "binary" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchema;

describe("StreamBinaryDelta type", () => {
  it("is assignable to StreamEvent and carries a Uint8Array delta", () => {
    const evt: StreamEvent = {
      type: "binary-delta",
      port: "bytes",
      binaryDelta: new Uint8Array([1, 2, 3]),
    } satisfies StreamBinaryDelta;
    expect(evt.type).toBe("binary-delta");
    if (evt.type === "binary-delta") {
      expect(evt.binaryDelta).toBeInstanceOf(Uint8Array);
      expect(Array.from(evt.binaryDelta)).toEqual([1, 2, 3]);
    }
  });

  it("admits 'binary' as a StreamMode", () => {
    const mode: StreamMode = "binary";
    expect(mode).toBe("binary");
  });
});

describe("binary-aware port helpers", () => {
  it("getPortStreamMode returns 'binary'", () => {
    expect(getPortStreamMode(binarySchema, "bytes")).toBe("binary");
  });

  it("getStreamingPorts includes binary ports", () => {
    expect(getStreamingPorts(binarySchema)).toEqual([{ port: "bytes", mode: "binary" }]);
  });

  it("getOutputStreamMode returns 'binary' for a single binary port", () => {
    expect(getOutputStreamMode(binarySchema)).toBe("binary");
  });

  it("getOutputStreamMode returns 'mixed' for append + binary", () => {
    expect(getOutputStreamMode(mixedSchema)).toBe("mixed");
  });

  it("getBinaryPortId finds the first binary port", () => {
    expect(getBinaryPortId(binarySchema)).toBe("bytes");
    expect(getBinaryPortId(mixedSchema)).toBe("bytes");
  });

  it("getBinaryPortId returns undefined when no binary port", () => {
    const noBinary = {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
    } as const satisfies DataPortSchema;
    expect(getBinaryPortId(noBinary)).toBeUndefined();
  });

  it("edgeNeedsAccumulation: binary source → non-binary target accumulates", () => {
    const target = {
      type: "object",
      properties: { bytes: { type: "object" } },
    } as const satisfies DataPortSchema;
    expect(edgeNeedsAccumulation(binarySchema, "bytes", target, "bytes")).toBe(true);
  });

  it("edgeNeedsAccumulation: binary → binary passes through", () => {
    expect(edgeNeedsAccumulation(binarySchema, "bytes", binarySchema, "bytes")).toBe(false);
  });
});

describe("materializeBinary", () => {
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];

  it("concatenates to an ArrayBuffer when format is 'binary'", async () => {
    const out = materializeBinary(chunks, "binary");
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(out as ArrayBuffer))).toEqual([1, 2, 3, 4, 5]);
  });

  it("concatenates to a Blob when format is 'blob'", async () => {
    const out = materializeBinary(chunks, "blob");
    expect(out).toBeInstanceOf(Blob);
    const buf = await (out as Blob).arrayBuffer();
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3, 4, 5]);
  });

  it("defaults to Blob when format is undefined", () => {
    expect(materializeBinary(chunks, undefined)).toBeInstanceOf(Blob);
  });

  it("handles an empty chunk list", () => {
    expect(materializeBinary([], "binary")).toBeInstanceOf(ArrayBuffer);
    expect((materializeBinary([], "binary") as ArrayBuffer).byteLength).toBe(0);
  });

  it("treats an unknown format as binary (ArrayBuffer)", () => {
    expect(materializeBinary(chunks, "wat")).toBeInstanceOf(ArrayBuffer);
  });
});
