/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TypeTabularStorage } from "@workglow/knowledge-base";
import {
  getGlobalTabularRepositories,
  InMemoryTabularStorage,
  registerTabularRepository,
} from "@workglow/storage";
import { compactSchemaInputs, resolveSchemaInputs } from "@workglow/task-graph";
import {
  getInputCompactors,
  globalServiceRegistry,
  registerInputCompactor,
  setLogger,
} from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("InputCompactor", () => {
  const logger = getTestingLogger();
  setLogger(logger);

  const testEntitySchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
    },
    required: ["id", "name"],
    additionalProperties: false,
  } as const;

  let testDataset: InMemoryTabularStorage<typeof testEntitySchema, readonly ["id"]>;

  beforeEach(async () => {
    testDataset = new InMemoryTabularStorage(testEntitySchema, ["id"] as const);
    await testDataset.setupDatabase();
    registerTabularRepository("test-dataset", testDataset);
  });

  afterEach(() => {
    getGlobalTabularRepositories().delete("test-dataset");
    testDataset.destroy();
  });

  describe("compactSchemaInputs", () => {
    test("should pass through string values unchanged (already compact)", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const input = { dataset: "test-dataset" };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.dataset).toBe("test-dataset");
    });

    test("should compact object instance to string ID", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const input = { dataset: testDataset };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.dataset).toBe("test-dataset");
    });

    test("should preserve object when compactor returns undefined", async () => {
      registerInputCompactor("unknown-format", () => undefined);

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          data: {
            oneOf: [
              { type: "string", format: "unknown-format" },
              { type: "object", additionalProperties: true },
            ],
          },
        },
      };

      const obj = { foo: "bar" };
      const input = { data: obj };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.data).toEqual(obj);

      getInputCompactors().delete("unknown-format");
    });

    test("should not compact properties without format annotation", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const input = { name: "test-name" };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.name).toBe("test-name");
    });

    test("should handle boolean schema", async () => {
      const input = { foo: "bar" };
      const compacted = await compactSchemaInputs(input, true as DataPortSchema, {
        registry: globalServiceRegistry,
      });

      expect(compacted).toEqual(input);
    });

    test("should handle schema without properties", async () => {
      // @ts-expect-error - schema is not a DataPortSchemaObject
      const schema: DataPortSchema = { type: "object" };
      const input = { foo: "bar" };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted).toEqual(input);
    });
  });

  describe("model-like compaction", () => {
    beforeEach(() => {
      registerInputCompactor("mock-model", (value) => {
        if (typeof value === "object" && value !== null && "model_id" in value) {
          const id = (value as Record<string, unknown>).model_id;
          return typeof id === "string" ? id : undefined;
        }
        return undefined;
      });
    });

    afterEach(() => {
      getInputCompactors().delete("mock-model");
    });

    test("should compact model config to model_id", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          model: {
            oneOf: [
              { type: "string", format: "mock-model" },
              {
                type: "object",
                format: "mock-model",
                properties: { model_id: { type: "string" } },
              },
            ],
            format: "mock-model",
          },
        },
      };

      const input = {
        model: { model_id: "gpt-4", provider: "openai", provider_config: {} },
      };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.model).toBe("gpt-4");
    });

    test("should preserve model object without model_id", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          model: {
            oneOf: [
              { type: "string", format: "mock-model" },
              {
                type: "object",
                format: "mock-model",
                properties: { provider: { type: "string" } },
              },
            ],
            format: "mock-model",
          },
        },
      };

      const input = { model: { provider: "openai", provider_config: {} } };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      // No model_id → cannot compact, preserve object
      expect(compacted.model).toEqual({ provider: "openai", provider_config: {} });
    });
  });

  describe("TypeSingleOrArray compaction", () => {
    // Mirrors the TypeSingleOrArray(TypeModel(...)) pattern using a mock format
    const singleOrArrayModelSchema: DataPortSchema = {
      type: "object",
      properties: {
        model: {
          anyOf: [
            {
              oneOf: [
                { type: "string", format: "mock-sa" },
                {
                  type: "object",
                  format: "mock-sa",
                  properties: { model_id: { type: "string" } },
                },
              ],
              format: "mock-sa",
            },
            {
              type: "array",
              items: {
                oneOf: [
                  { type: "string", format: "mock-sa" },
                  {
                    type: "object",
                    format: "mock-sa",
                    properties: { model_id: { type: "string" } },
                  },
                ],
                format: "mock-sa",
              },
            },
          ],
        },
      },
    };

    beforeEach(() => {
      registerInputCompactor("mock-sa", (value) => {
        if (typeof value === "object" && value !== null && "model_id" in value) {
          const id = (value as Record<string, unknown>).model_id;
          return typeof id === "string" ? id : undefined;
        }
        return undefined;
      });
    });

    afterEach(() => {
      getInputCompactors().delete("mock-sa");
    });

    test("should compact single model object in TypeSingleOrArray", async () => {
      const input = { model: { model_id: "gpt-4", provider: "openai" } };
      const compacted = await compactSchemaInputs(input, singleOrArrayModelSchema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.model).toBe("gpt-4");
    });

    test("should compact array of model objects in TypeSingleOrArray", async () => {
      const input = {
        model: [
          { model_id: "gpt-4", provider: "openai" },
          { model_id: "claude-3", provider: "anthropic" },
        ],
      };
      const compacted = await compactSchemaInputs(input, singleOrArrayModelSchema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.model).toEqual(["gpt-4", "claude-3"]);
    });

    test("should compact array with metadata (real-world InputTask pattern)", async () => {
      const input = {
        model: [
          {
            model_id: "08f419ff-9071-4ed9-86f7-0c8134139778",
            title: "Gemma 4 E2B",
            provider: "HF_TRANSFORMERS_ONNX",
            provider_config: { pipeline: "text-generation" },
            metadata: { fromSuggestion: true, modelInfo: { file_sizes: {} } },
            capabilities: ["text.generation"],
          },
        ],
      };
      const compacted = await compactSchemaInputs(input, singleOrArrayModelSchema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.model).toEqual(["08f419ff-9071-4ed9-86f7-0c8134139778"]);
    });

    test("should pass through string in TypeSingleOrArray", async () => {
      const input = { model: "gpt-4" };
      const compacted = await compactSchemaInputs(input, singleOrArrayModelSchema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.model).toBe("gpt-4");
    });

    test("should pass through string array in TypeSingleOrArray", async () => {
      const input = { model: ["gpt-4", "claude-3"] };
      const compacted = await compactSchemaInputs(input, singleOrArrayModelSchema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.model).toEqual(["gpt-4", "claude-3"]);
    });
  });

  describe("array compaction", () => {
    test("should compact object elements in arrays to string IDs", async () => {
      registerInputCompactor("test-arr", (value) => {
        if (typeof value === "object" && value !== null && "id" in value) {
          const id = (value as Record<string, unknown>).id;
          return typeof id === "string" ? id : undefined;
        }
        return undefined;
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          items: {
            type: "array",
            format: "test-arr",
            items: {
              oneOf: [
                { type: "string", format: "test-arr" },
                { type: "object", properties: { id: { type: "string" } } },
              ],
            },
          },
        },
      };

      const input = {
        items: [
          { id: "a", name: "Tool A" },
          { id: "b", name: "Tool B" },
        ],
      };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.items).toEqual(["a", "b"]);

      getInputCompactors().delete("test-arr");
    });

    test("should handle mixed arrays (strings and objects)", async () => {
      registerInputCompactor("test-mix", (value) => {
        if (typeof value === "object" && value !== null && "id" in value) {
          const id = (value as Record<string, unknown>).id;
          return typeof id === "string" ? id : undefined;
        }
        return undefined;
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          items: {
            type: "array",
            format: "test-mix",
            items: {
              oneOf: [
                { type: "string", format: "test-mix" },
                { type: "object", properties: { id: { type: "string" } } },
              ],
            },
          },
        },
      };

      const input = {
        items: ["already-string", { id: "b", type: "resolved" }, "also-string"],
      };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.items).toEqual(["already-string", "b", "also-string"]);

      getInputCompactors().delete("test-mix");
    });
  });

  describe("recursive compaction", () => {
    test("should recurse into nested object properties", async () => {
      registerInputCompactor("nested-compact", (value) => {
        if (typeof value === "object" && value !== null && "ref" in value) {
          const ref = (value as Record<string, unknown>).ref;
          return typeof ref === "string" ? ref : undefined;
        }
        return undefined;
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          config: {
            type: "object",
            properties: {
              resource: {
                oneOf: [
                  { type: "string", format: "nested-compact" },
                  { type: "object", properties: { ref: { type: "string" } } },
                ],
              },
            },
          },
        },
      };

      const input = { config: { resource: { ref: "my-resource" } } };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.config).toEqual({ resource: "my-resource" });

      getInputCompactors().delete("nested-compact");
    });
  });

  describe("allOf schema support", () => {
    beforeEach(() => {
      registerInputCompactor("allof-compact", (value) => {
        if (typeof value === "object" && value !== null && "id" in value) {
          const id = (value as Record<string, unknown>).id;
          return typeof id === "string" ? id : undefined;
        }
        return undefined;
      });
    });

    afterEach(() => {
      getInputCompactors().delete("allof-compact");
    });

    test("should compact object to string when schema uses allOf with string type", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          resource: {
            allOf: [
              {
                oneOf: [
                  { type: "string", format: "allof-compact" },
                  { type: "object", properties: { id: { type: "string" } } },
                ],
              },
              { format: "allof-compact" },
            ],
          },
        },
      };

      const input = { resource: { id: "my-resource" } };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.resource).toBe("my-resource");
    });
  });

  describe("cycle detection", () => {
    test("should not stack overflow on circular schema references", async () => {
      const objectSchema: Record<string, unknown> = {
        type: "object",
        properties: {},
      };
      // Create circular reference
      (objectSchema.properties as Record<string, unknown>).self = objectSchema;

      const schema: DataPortSchema = objectSchema as DataPortSchema;

      const input = { self: { self: { self: {} } } };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      // Should complete without stack overflow
      expect(compacted).toBeDefined();
    });

    test("should compact sibling properties sharing the same schema reference", async () => {
      registerInputCompactor("sibling-compact", (value) => {
        if (typeof value === "object" && value !== null && "ref" in value) {
          const ref = (value as Record<string, unknown>).ref;
          return typeof ref === "string" ? ref : undefined;
        }
        return undefined;
      });

      const sharedNestedSchema: DataPortSchema = {
        type: "object",
        properties: {
          resource: {
            oneOf: [
              { type: "string", format: "sibling-compact" },
              { type: "object", properties: { ref: { type: "string" } } },
            ],
          },
        },
      };

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          first: sharedNestedSchema,
          second: sharedNestedSchema,
        },
      };

      const input = {
        first: { resource: { ref: "res-a" } },
        second: { resource: { ref: "res-b" } },
      };
      const compacted = await compactSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(compacted.first).toEqual({ resource: "res-a" });
      expect(compacted.second).toEqual({ resource: "res-b" });

      getInputCompactors().delete("sibling-compact");
    });
  });

  describe("roundtrip", () => {
    test("compact(resolve(input)) should return the original string IDs", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const original = { dataset: "test-dataset" };

      // Resolve: string → instance
      const resolved = await resolveSchemaInputs(original, schema, {
        registry: globalServiceRegistry,
      });
      expect(resolved.dataset).toBe(testDataset);

      // Compact: instance → string
      const compacted = await compactSchemaInputs(resolved, schema, {
        registry: globalServiceRegistry,
      });
      expect(compacted.dataset).toBe("test-dataset");
    });
  });
});
