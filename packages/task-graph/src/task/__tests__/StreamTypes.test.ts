/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  StreamError,
  StreamEvent,
  StreamFinish,
  StreamMode,
  StreamObjectDelta,
  StreamSnapshot,
  StreamTextDelta,
} from "@workglow/task-graph";
import {
  edgeNeedsAccumulation,
  getAppendPortId,
  getObjectPortId,
  getOutputStreamMode,
  getPortStreamMode,
  getStreamingPorts,
  getStructuredOutputSchemas,
  hasStructuredOutput,
  isTaskStreamable,
} from "@workglow/task-graph";
import { setLogger } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

describe("StreamTypes", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("StreamMode", () => {
    it("should accept 'none' as a valid StreamMode", () => {
      const mode: StreamMode = "none";
      expect(mode).toBe("none");
    });

    it("should accept 'append' as a valid StreamMode", () => {
      const mode: StreamMode = "append";
      expect(mode).toBe("append");
    });

    it("should accept 'replace' as a valid StreamMode", () => {
      const mode: StreamMode = "replace";
      expect(mode).toBe("replace");
    });
  });

  describe("StreamTextDelta", () => {
    it("should create a valid text-delta event", () => {
      const delta: StreamTextDelta = {
        type: "text-delta",
        port: "text",
        textDelta: "Hello",
      };
      expect(delta.type).toBe("text-delta");
      expect(delta.port).toBe("text");
      expect(delta.textDelta).toBe("Hello");
    });

    it("should handle empty text-delta", () => {
      const delta: StreamTextDelta = {
        type: "text-delta",
        port: "text",
        textDelta: "",
      };
      expect(delta.type).toBe("text-delta");
      expect(delta.textDelta).toBe("");
    });
  });

  describe("StreamSnapshot", () => {
    it("should create a valid snapshot event", () => {
      const snapshot: StreamSnapshot<{ text: string }> = {
        type: "snapshot",
        data: { text: "Hello world" },
      };
      expect(snapshot.type).toBe("snapshot");
      expect(snapshot.data).toEqual({ text: "Hello world" });
    });

    it("should support complex output types", () => {
      const snapshot: StreamSnapshot<{ text: string; target_lang: string }> = {
        type: "snapshot",
        data: { text: "Bonjour le monde", target_lang: "fr" },
      };
      expect(snapshot.type).toBe("snapshot");
      expect(snapshot.data.text).toBe("Bonjour le monde");
      expect(snapshot.data.target_lang).toBe("fr");
    });
  });

  describe("StreamFinish", () => {
    it("should create a valid finish event with data", () => {
      const finish: StreamFinish<{ text: string }> = {
        type: "finish",
        data: { text: "Complete output" },
      };
      expect(finish.type).toBe("finish");
      expect(finish.data).toEqual({ text: "Complete output" });
    });

    it("should create a finish event with empty data (append mode, cache off)", () => {
      const finish: StreamFinish = {
        type: "finish",
        data: {},
      };
      expect(finish.type).toBe("finish");
      expect(finish.data).toEqual({});
    });
  });

  describe("StreamError", () => {
    it("should create a valid error event", () => {
      const error: StreamError = {
        type: "error",
        error: new Error("Something went wrong"),
      };
      expect(error.type).toBe("error");
      expect(error.error).toBeInstanceOf(Error);
      expect(error.error.message).toBe("Something went wrong");
    });
  });

  describe("StreamEvent discriminated union", () => {
    it("should discriminate text-delta events", () => {
      const event: StreamEvent = { type: "text-delta", port: "text", textDelta: "hi" };
      expect(event.type).toBe("text-delta");
      if (event.type === "text-delta") {
        expect(event.textDelta).toBe("hi");
      }
    });

    it("should discriminate snapshot events", () => {
      const event: StreamEvent<{ text: string }> = {
        type: "snapshot",
        data: { text: "hello" },
      };
      expect(event.type).toBe("snapshot");
      if (event.type === "snapshot") {
        expect(event.data.text).toBe("hello");
      }
    });

    it("should discriminate finish events", () => {
      const event: StreamEvent<{ text: string }> = {
        type: "finish",
        data: { text: "done" },
      };
      expect(event.type).toBe("finish");
      if (event.type === "finish") {
        expect(event.data.text).toBe("done");
      }
    });

    it("should discriminate error events", () => {
      const event: StreamEvent = {
        type: "error",
        error: new Error("fail"),
      };
      expect(event.type).toBe("error");
      if (event.type === "error") {
        expect(event.error.message).toBe("fail");
      }
    });

    it("should work correctly in a switch statement", () => {
      const events: StreamEvent<{ text: string }>[] = [
        { type: "text-delta", port: "text", textDelta: "a" },
        { type: "text-delta", port: "text", textDelta: "b" },
        { type: "snapshot", data: { text: "ab" } },
        { type: "finish", data: { text: "ab" } },
      ];

      let deltas = 0;
      let snapshots = 0;
      let finishes = 0;

      for (const event of events) {
        switch (event.type) {
          case "text-delta":
            deltas++;
            break;
          case "snapshot":
            snapshots++;
            break;
          case "finish":
            finishes++;
            break;
          case "error":
            break;
        }
      }

      expect(deltas).toBe(2);
      expect(snapshots).toBe(1);
      expect(finishes).toBe(1);
    });
  });

  // ===========================================================================
  // Port-level helper functions
  // ===========================================================================

  describe("getPortStreamMode", () => {
    it("should return 'none' when x-stream is absent", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string" } },
      };
      expect(getPortStreamMode(schema, "text")).toBe("none");
    });

    it("should return 'append' when x-stream is 'append'", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getPortStreamMode(schema, "text")).toBe("append");
    });

    it("should return 'replace' when x-stream is 'replace'", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "replace" } },
      };
      expect(getPortStreamMode(schema, "text")).toBe("replace");
    });

    it("should return 'none' for a missing port", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getPortStreamMode(schema, "missing")).toBe("none");
    });

    it("should return 'none' for a boolean schema", () => {
      expect(getPortStreamMode(true as any, "text")).toBe("none");
      expect(getPortStreamMode(false as any, "text")).toBe("none");
    });

    it("should return 'none' when properties is empty", () => {
      const schema: DataPortSchema = { type: "object", properties: {} };
      expect(getPortStreamMode(schema, "text")).toBe("none");
    });
  });

  describe("getOutputStreamMode", () => {
    it("should return 'none' when no port has x-stream", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string" } },
      };
      expect(getOutputStreamMode(schema)).toBe("none");
    });

    it("should return 'append' when a port has x-stream append", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getOutputStreamMode(schema)).toBe("append");
    });

    it("should return 'replace' when a port has x-stream replace", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "replace" } },
      };
      expect(getOutputStreamMode(schema)).toBe("replace");
    });

    it("should return 'mixed' when mixing 'append' and 'replace' on a single task", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          text: { type: "string", "x-stream": "replace" },
          summary: { type: "string", "x-stream": "append" },
        },
      };
      expect(getOutputStreamMode(schema)).toBe("mixed");
    });

    it("should return 'append' when multiple ports all use append", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          text: { type: "string", "x-stream": "append" },
          summary: { type: "string", "x-stream": "append" },
        },
      };
      expect(getOutputStreamMode(schema)).toBe("append");
    });

    it("should return 'none' for boolean schema", () => {
      expect(getOutputStreamMode(true as any)).toBe("none");
    });
  });

  describe("isTaskStreamable", () => {
    it("should return true when output has x-stream and executeStream exists", () => {
      const task = {
        outputSchema: () =>
          ({
            type: "object",
            properties: { text: { type: "string", "x-stream": "append" } },
          }) as DataPortSchema,
        executeStream: async function* () {},
      };
      expect(isTaskStreamable(task)).toBe(true);
    });

    it("should return false when output has x-stream but no executeStream", () => {
      const task = {
        outputSchema: () =>
          ({
            type: "object",
            properties: { text: { type: "string", "x-stream": "append" } },
          }) as DataPortSchema,
      };
      expect(isTaskStreamable(task)).toBe(false);
    });

    it("should return false when executeStream exists but no x-stream on output", () => {
      const task = {
        outputSchema: () =>
          ({
            type: "object",
            properties: { text: { type: "string" } },
          }) as DataPortSchema,
        executeStream: async function* () {},
      };
      expect(isTaskStreamable(task)).toBe(false);
    });
  });

  describe("getAppendPortId", () => {
    it("should return the port name with x-stream append", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getAppendPortId(schema)).toBe("text");
    });

    it("should return undefined when no port has x-stream append", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string" } },
      };
      expect(getAppendPortId(schema)).toBeUndefined();
    });

    it("should return undefined for replace-mode ports", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "replace" } },
      };
      expect(getAppendPortId(schema)).toBeUndefined();
    });

    it("should return the first append port when multiple exist", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          code: { type: "string", "x-stream": "append" },
          summary: { type: "string", "x-stream": "append" },
        },
      };
      expect(getAppendPortId(schema)).toBe("code");
    });

    it("should return undefined for boolean schema", () => {
      expect(getAppendPortId(true as any)).toBeUndefined();
      expect(getAppendPortId(false as any)).toBeUndefined();
    });

    it("should return non-text port name", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          code: { type: "string", "x-stream": "append" },
        },
      };
      expect(getAppendPortId(schema)).toBe("code");
    });
  });

  describe("StreamObjectDelta", () => {
    it("should create a valid object-delta event", () => {
      const delta: StreamObjectDelta = {
        type: "object-delta",
        port: "data",
        objectDelta: { key: "value" },
      };
      expect(delta.type).toBe("object-delta");
      expect(delta.port).toBe("data");
      expect(delta.objectDelta).toEqual({ key: "value" });
    });
  });

  describe("getStreamingPorts", () => {
    it("should return empty array for schema without x-stream", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string" } },
      };
      expect(getStreamingPorts(schema)).toEqual([]);
    });

    it("should return single append port", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getStreamingPorts(schema)).toEqual([{ port: "text", mode: "append" }]);
    });

    it("should return multiple streaming ports", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          code: { type: "string", "x-stream": "append" },
          summary: { type: "string", "x-stream": "append" },
        },
      };
      expect(getStreamingPorts(schema)).toEqual([
        { port: "code", mode: "append" },
        { port: "summary", mode: "append" },
      ]);
    });

    it("should return empty array for boolean schema", () => {
      expect(getStreamingPorts(true as any)).toEqual([]);
    });

    it("should skip non-streaming ports", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          text: { type: "string", "x-stream": "append" },
          count: { type: "number" },
        },
      };
      expect(getStreamingPorts(schema)).toEqual([{ port: "text", mode: "append" }]);
    });
  });

  describe("edgeNeedsAccumulation", () => {
    const appendSchema: DataPortSchema = {
      type: "object",
      properties: { text: { type: "string", "x-stream": "append" } },
    };
    const replaceSchema: DataPortSchema = {
      type: "object",
      properties: { text: { type: "string", "x-stream": "replace" } },
    };
    const objectSchema: DataPortSchema = {
      type: "object",
      properties: { object: { type: "object", "x-stream": "object" } },
    };
    const noneSchema: DataPortSchema = {
      type: "object",
      properties: { text: { type: "string" } },
    };

    it("should return false when source has no x-stream", () => {
      expect(edgeNeedsAccumulation(noneSchema, "text", noneSchema, "text")).toBe(false);
    });

    it("should return false when source and target match (append-append)", () => {
      expect(edgeNeedsAccumulation(appendSchema, "text", appendSchema, "text")).toBe(false);
    });

    it("should return false when source and target match (replace-replace)", () => {
      expect(edgeNeedsAccumulation(replaceSchema, "text", replaceSchema, "text")).toBe(false);
    });

    it("should return false when source and target match (object-object)", () => {
      expect(edgeNeedsAccumulation(objectSchema, "object", objectSchema, "object")).toBe(false);
    });

    it("should return true when source is append but target has no x-stream", () => {
      expect(edgeNeedsAccumulation(appendSchema, "text", noneSchema, "text")).toBe(true);
    });

    it("should return true when source is replace but target has no x-stream", () => {
      expect(edgeNeedsAccumulation(replaceSchema, "text", noneSchema, "text")).toBe(true);
    });

    it("should return true when source is object but target has no x-stream", () => {
      expect(edgeNeedsAccumulation(objectSchema, "object", noneSchema, "text")).toBe(true);
    });

    it("should return true when source is append but target is replace", () => {
      expect(edgeNeedsAccumulation(appendSchema, "text", replaceSchema, "text")).toBe(true);
    });
  });

  describe("object stream mode", () => {
    it("should accept 'object' as a valid StreamMode", () => {
      const mode: StreamMode = "object";
      expect(mode).toBe("object");
    });

    it("getPortStreamMode should return 'object' for x-stream object", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { data: { type: "object", "x-stream": "object" } },
      };
      expect(getPortStreamMode(schema, "data")).toBe("object");
    });

    it("getStreamingPorts should include object ports", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { data: { type: "object", "x-stream": "object" } },
      };
      expect(getStreamingPorts(schema)).toEqual([{ port: "data", mode: "object" }]);
    });

    it("getOutputStreamMode should return 'object' for object ports", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { data: { type: "object", "x-stream": "object" } },
      };
      expect(getOutputStreamMode(schema)).toBe("object");
    });

    it("should return 'mixed' when mixing object and append modes", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          text: { type: "string", "x-stream": "append" },
          data: { type: "object", "x-stream": "object" },
        },
      };
      expect(getOutputStreamMode(schema)).toBe("mixed");
    });

    it("isTaskStreamable should return true for object-streaming tasks", () => {
      const task = {
        outputSchema: () =>
          ({
            type: "object",
            properties: { data: { type: "object", "x-stream": "object" } },
          }) as DataPortSchema,
        executeStream: async function* () {},
      };
      expect(isTaskStreamable(task)).toBe(true);
    });
  });

  describe("getObjectPortId", () => {
    it("should return the port name with x-stream object", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { data: { type: "object", "x-stream": "object" } },
      };
      expect(getObjectPortId(schema)).toBe("data");
    });

    it("should return undefined when no port has x-stream object", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string", "x-stream": "append" } },
      };
      expect(getObjectPortId(schema)).toBeUndefined();
    });

    it("should return undefined for boolean schema", () => {
      expect(getObjectPortId(true as any)).toBeUndefined();
    });
  });

  describe("getStructuredOutputSchemas", () => {
    it("should return empty map for schema without x-structured-output", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string" } },
      };
      expect(getStructuredOutputSchemas(schema).size).toBe(0);
    });

    it("should return port schema for x-structured-output true", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          data: {
            type: "object",
            "x-structured-output": true,
            properties: { name: { type: "string" } },
          },
        },
      };
      const result = getStructuredOutputSchemas(schema);
      expect(result.size).toBe(1);
      expect(result.has("data")).toBe(true);
    });

    it("should return empty map for boolean schema", () => {
      expect(getStructuredOutputSchemas(true).size).toBe(0);
    });
  });

  describe("hasStructuredOutput", () => {
    it("should return false for non-structured schemas", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: { text: { type: "string" } },
      };
      expect(hasStructuredOutput(schema)).toBe(false);
    });

    it("should return true for schemas with x-structured-output", () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          data: {
            type: "object",
            "x-structured-output": true,
          },
        },
      };
      expect(hasStructuredOutput(schema)).toBe(true);
    });
  });
});
