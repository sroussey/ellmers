/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TypeTabularStorage } from "@workglow/knowledge-base";
import type { AnyTabularStorage } from "@workglow/storage";
import {
  getGlobalTabularRepositories,
  InMemoryTabularStorage,
  registerTabularRepository,
} from "@workglow/storage";
import type { IExecuteContext } from "@workglow/task-graph";
import { resolveSchemaInputs, Task, TaskRegistry } from "@workglow/task-graph";
import {
  getInputResolvers,
  globalServiceRegistry,
  registerInputResolver,
  setLogger,
  sleep,
} from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

describe("InputResolver", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  // Test schema for tabular repository
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
    // Create and register a test repository
    testDataset = new InMemoryTabularStorage(testEntitySchema, ["id"] as const);
    await testDataset.setupDatabase();
    registerTabularRepository("test-dataset", testDataset);
  });

  afterEach(() => {
    // Clean up the registry
    getGlobalTabularRepositories().delete("test-dataset");
    testDataset.destroy();
  });

  describe("resolveSchemaInputs", () => {
    test("should pass through non-string values unchanged", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const input = { dataset: testDataset };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.dataset).toBe(testDataset);
    });

    test("should resolve string dataset ID to instance", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const input = { dataset: "test-dataset" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.dataset).toBe(testDataset);
    });

    test("should throw error for unknown dataset ID", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          dataset: TypeTabularStorage(),
        },
      };

      const input = { dataset: "non-existent-dataset" };

      await expect(
        resolveSchemaInputs(input, schema, { registry: globalServiceRegistry })
      ).rejects.toThrow('Tabular storage "non-existent-dataset" not found');
    });

    test("should not resolve properties without format annotation", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
      };

      const input = { name: "test-name" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.name).toBe("test-name");
    });

    test("should handle boolean schema", async () => {
      const input = { foo: "bar" };
      const resolved = await resolveSchemaInputs(input, true as DataPortSchema, {
        registry: globalServiceRegistry,
      });

      expect(resolved).toEqual(input);
    });

    test("should handle schema without properties", async () => {
      // @ts-expect-error - schema is not a DataPortSchemaObject
      const schema: DataPortSchema = { type: "object" };
      const input = { foo: "bar" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved).toEqual(input);
    });
  });

  describe("recursive resolution", () => {
    test("should recurse into nested object properties", async () => {
      registerInputResolver("nested-test", (_id, _format, _registry) => {
        return "resolved-value";
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          config: {
            type: "object",
            properties: {
              key: { type: "string", format: "nested-test" },
            },
          },
        },
      };

      const input = { config: { key: "my-id" } };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.config).toEqual({ key: "resolved-value" });

      // Clean up
      getInputResolvers().delete("nested-test");
    });

    test("should recurse after format resolution (string -> object -> recurse)", async () => {
      // Simulate a model resolver that returns an object with a nested credential_key
      registerInputResolver("mock-model", (_id, _format, _registry) => {
        return { provider: "test", provider_config: { credential_key: "secret-ref" } };
      });
      registerInputResolver("mock-cred", (_id, _format, _registry) => {
        return "resolved-secret";
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          model: {
            oneOf: [
              { type: "string", format: "mock-model" },
              {
                type: "object",
                format: "mock-model",
                properties: {
                  provider: { type: "string" },
                  provider_config: {
                    type: "object",
                    properties: {
                      credential_key: { type: "string", format: "mock-cred" },
                    },
                  },
                },
              },
            ],
          },
        },
      };

      // String value gets resolved to object, then recursed into
      const input = { model: "my-model-id" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.model).toEqual({
        provider: "test",
        provider_config: { credential_key: "resolved-secret" },
      });

      // Clean up
      getInputResolvers().delete("mock-model");
      getInputResolvers().delete("mock-cred");
    });

    test("should recurse into inline object values via oneOf schema", async () => {
      registerInputResolver("inner-test", (_id, _format, _registry) => {
        return "inner-resolved";
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          model: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: {
                  nested_key: { type: "string", format: "inner-test" },
                },
              },
            ],
          },
        },
      };

      // Inline object value — should recurse into it
      const input = { model: { nested_key: "some-id" } };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.model).toEqual({ nested_key: "inner-resolved" });

      // Clean up
      getInputResolvers().delete("inner-test");
    });

    test("should not recurse into non-object values", async () => {
      const schema: DataPortSchema = {
        type: "object",
        properties: {
          config: {
            type: "object",
            properties: {
              key: { type: "string" },
            },
          },
        },
      };

      // Pass a string where an object is expected — should not crash
      const input = { config: "not-an-object" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.config).toBe("not-an-object");
    });
  });

  describe("allOf schema support", () => {
    test("should resolve format from allOf sub-schema", async () => {
      registerInputResolver("allof-test", (_id, _format, _registry) => {
        return "allof-resolved";
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          value: {
            allOf: [{ type: "string", format: "allof-test" }, { minLength: 1 }],
          },
        },
      };

      const input = { value: "my-id" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.value).toBe("allof-resolved");

      getInputResolvers().delete("allof-test");
    });

    test("should recurse into object schema found via allOf", async () => {
      registerInputResolver("allof-nested", (_id, _format, _registry) => {
        return "nested-resolved";
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          config: {
            allOf: [
              {
                type: "object",
                properties: {
                  key: { type: "string", format: "allof-nested" },
                },
              },
              { required: ["key"] },
            ],
          },
        },
      };

      const input = { config: { key: "some-id" } };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.config).toEqual({ key: "nested-resolved" });

      getInputResolvers().delete("allof-nested");
    });
  });

  describe("cycle detection", () => {
    test("should not stack overflow on circular schema references", async () => {
      const objectSchema: Record<string, unknown> = {
        type: "object",
        properties: {},
      };
      // Create a circular reference: a property whose schema points back to the parent
      (objectSchema.properties as Record<string, unknown>).self = objectSchema;

      const schema: DataPortSchema = objectSchema as DataPortSchema;

      const input = { self: { self: { self: {} } } };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      // Should complete without stack overflow; inner values pass through unchanged
      expect(resolved).toBeDefined();
    });

    test("should resolve sibling properties sharing the same schema reference", async () => {
      registerInputResolver("sibling-test", (_id, _format, _registry) => {
        return "sibling-resolved";
      });

      const sharedNestedSchema: DataPortSchema = {
        type: "object",
        properties: {
          key: { type: "string", format: "sibling-test" },
        },
      };

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          first: sharedNestedSchema,
          second: sharedNestedSchema,
        },
      };

      const input = { first: { key: "id-a" }, second: { key: "id-b" } };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.first).toEqual({ key: "sibling-resolved" });
      expect(resolved.second).toEqual({ key: "sibling-resolved" });

      getInputResolvers().delete("sibling-test");
    });
  });

  describe("mixed array resolution", () => {
    test("should resolve string elements in a mixed array, passing non-string elements through", async () => {
      registerInputResolver("skill", (id, _format, _registry) => {
        return { name: id, type: "resolved-tool" };
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          tools: {
            type: "array",
            format: "skill",
            items: {
              oneOf: [
                { type: "string", format: "skill" },
                { type: "object", properties: { name: { type: "string" } } },
              ],
            },
          },
        },
      };

      const inlineToolDef = { name: "inline-tool", type: "inline" };
      const input = { tools: ["tool-id-1", inlineToolDef, "tool-id-2"] };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.tools).toEqual([
        { name: "tool-id-1", type: "resolved-tool" },
        inlineToolDef,
        { name: "tool-id-2", type: "resolved-tool" },
      ]);

      // Clean up
      getInputResolvers().delete("skill");
    });

    test("should resolve all-string array as before", async () => {
      registerInputResolver("skill2", (id, _format, _registry) => {
        return { name: id, type: "resolved-tool" };
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          tools: {
            type: "array",
            format: "skill2",
            items: { type: "string", format: "skill2" },
          },
        },
      };

      const input = { tools: ["tool-a", "tool-b"] };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.tools).toEqual([
        { name: "tool-a", type: "resolved-tool" },
        { name: "tool-b", type: "resolved-tool" },
      ]);

      // Clean up
      getInputResolvers().delete("skill2");
    });
  });

  describe("registerInputResolver", () => {
    test("should register custom resolver", async () => {
      // Register a custom resolver for a test format
      registerInputResolver("custom", (id, format, _registry) => {
        return { resolved: true, id, format };
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          data: { type: "string", format: "custom:test" },
        },
      };

      const input = { data: "my-id" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.data).toEqual({ resolved: true, id: "my-id", format: "custom:test" });

      // Clean up
      getInputResolvers().delete("custom");
    });

    test("should support async resolvers", async () => {
      registerInputResolver("async", async (id, _format, _registry) => {
        await sleep(10);
        return { asyncResolved: true, id };
      });

      const schema: DataPortSchema = {
        type: "object",
        properties: {
          data: { type: "string", format: "async" },
        },
      };

      const input = { data: "async-id" };
      const resolved = await resolveSchemaInputs(input, schema, {
        registry: globalServiceRegistry,
      });

      expect(resolved.data).toEqual({ asyncResolved: true, id: "async-id" });

      // Clean up
      getInputResolvers().delete("async");
    });
  });

  describe("Integration with Task", () => {
    // Define a test task that uses a dataset
    class DatasetConsumerTask extends Task<
      { dataset: AnyTabularStorage | string; query: string },
      { results: any[] }
    > {
      public static override type = "DatasetConsumerTask";

      public static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            dataset: TypeTabularStorage({
              title: "Data Storage",
              description: "Storage to query",
            }),
            query: { type: "string", title: "Query" },
          },
          required: ["dataset", "query"],
          additionalProperties: false,
        };
      }

      public static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            results: { type: "array", items: { type: "object" } },
          },
          required: ["results"],
          additionalProperties: false,
        };
      }

      override async execute(
        input: { dataset: AnyTabularStorage; query: string },
        _context: IExecuteContext
      ): Promise<{ results: any[] }> {
        const { dataset } = input;
        // In a real task, we'd search the dataset
        const results = await dataset.getAll();
        return { results: results ?? [] };
      }
    }

    beforeEach(() => {
      TaskRegistry.registerTask(DatasetConsumerTask);
    });

    afterEach(() => {
      TaskRegistry.all.delete(DatasetConsumerTask.type);
    });

    test("should resolve dataset when running task with string ID", async () => {
      // Add some test data
      await testDataset.put({ id: "1", name: "Test Item" });

      const task = new DatasetConsumerTask();
      const result = await task.run({
        dataset: "test-dataset",
        query: "test",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({ id: "1", name: "Test Item" });
    });

    test("should work with direct dataset instance", async () => {
      await testDataset.put({ id: "2", name: "Direct Item" });

      const task = new DatasetConsumerTask();
      const result = await task.run({
        dataset: testDataset,
        query: "test",
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({ id: "2", name: "Direct Item" });
    });
  });
});
