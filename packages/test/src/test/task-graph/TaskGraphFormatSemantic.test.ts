/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelRecord, ModelRepository } from "@workglow/ai";
import { InMemoryModelRepository, MODEL_REPOSITORY } from "@workglow/ai";
import type { TaskInput } from "@workglow/task-graph";
import { Dataflow, Task, TaskGraph } from "@workglow/task-graph";
import type { ServiceRegistry } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { beforeEach, describe, expect, it } from "vitest";

import {
  EmbeddingConsumerTask,
  EmbeddingModelProviderTask,
  GenericModelConsumerTask,
  ModelProviderTask,
  PlainStringConsumerTask,
  PlainStringProviderTask,
  TextGenerationModelProviderTask,
} from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";

/**
 * Test model fixtures for embedding models
 */
const EMBEDDING_MODELS: ModelRecord[] = [
  {
    model_id: "text-embedding-ada-002",
    capabilities: ["text.embedding"],
    provider: "openai",
    title: "OpenAI Ada Embedding",
    description: "OpenAI text embedding model",
    provider_config: {},
    metadata: {},
  },
  {
    model_id: "all-MiniLM-L6-v2",
    capabilities: ["text.embedding"],
    provider: "local",
    title: "MiniLM Embedding",
    description: "Local embedding model",
    provider_config: {},
    metadata: {},
  },
];

/**
 * Test model fixtures for text generation models
 */
const TEXT_GEN_MODELS: ModelRecord[] = [
  {
    model_id: "gpt-4",
    capabilities: ["text.generation"],
    provider: "openai",
    title: "GPT-4",
    description: "OpenAI GPT-4 text generation model",
    provider_config: {},
    metadata: {},
  },
  {
    model_id: "claude-3",
    capabilities: ["text.generation"],
    provider: "anthropic",
    title: "Claude 3",
    description: "Anthropic Claude 3 model",
    provider_config: {},
    metadata: {},
  },
];

/**
 * Helper function to create a test-local service registry with a model repository
 * @param models - Array of model records to populate the repository with
 * @returns Promise resolving to a configured ServiceRegistry
 */
async function createTestRegistry(models: ModelRecord[]): Promise<ServiceRegistry> {
  const { ServiceRegistry } = await import("@workglow/util");
  const registry = new ServiceRegistry();
  const modelRepo = new InMemoryModelRepository();
  for (const model of models) {
    await modelRepo.addModel(model);
  }
  registry.registerInstance(MODEL_REPOSITORY, modelRepo);
  return registry;
}

describe("TaskGraph with format annotations", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  let graph: TaskGraph;

  beforeEach(() => {
    graph = new TaskGraph();
  });

  describe("static compatibility", () => {
    it("should be statically compatible when semantic annotations match exactly", () => {
      const sourceTask = new ModelProviderTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("static");
    });

    it("should be statically compatible when source has narrowing but target doesn't", () => {
      // Source: model:EmbeddingTask -> Target: model (accepts any model)
      const sourceTask = new EmbeddingModelProviderTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("static");
    });

    it("should be statically compatible when both have same narrowing", () => {
      // Source: model:EmbeddingTask -> Target: model:EmbeddingTask
      const sourceTask = new EmbeddingModelProviderTask({ id: "source" });
      const targetTask = new EmbeddingConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("static");
    });

    it("should be statically compatible when source has format but target doesn't", () => {
      // Source: model -> Target: plain string
      const sourceTask = new ModelProviderTask({ id: "source" });
      const targetTask = new PlainStringConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "input");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("static");
    });

    it("should be incompatible when target has format but source doesn't", () => {
      // Source: plain string -> Target: model (with format)
      const sourceTask = new PlainStringProviderTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "output", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("incompatible");
    });
  });

  describe("runtime compatibility with narrowing", () => {
    it("should require runtime check when target has narrowing but source doesn't", () => {
      // Source: model (generic) -> Target: model:EmbeddingTask (specific)
      // This requires runtime narrowing to filter compatible models
      const sourceTask = new ModelProviderTask({ id: "source" });
      const targetTask = new EmbeddingConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("runtime");
    });

    it("should implement narrowInput to filter models at runtime", async () => {
      // Create a task that simulates the narrowing behavior
      class NarrowableModelConsumerTask extends Task<
        { model: string | string[] },
        { result: string }
      > {
        static override readonly type = "EmbeddingTask"; // This would be used to find compatible models

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              model: {
                type: ["string", "array"],
                items: { type: "string" },
                format: "model:EmbeddingTask",
                description: "Embedding model identifier (can be single or array)",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              result: {
                type: "string",
                description: "Processing result",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        // Runtime narrowing using ModelRepository from the registry
        public override async narrowInput(
          input: { model: string | string[] },
          registry: ServiceRegistry
        ): Promise<{ model: string | string[] }> {
          const modelRepo = registry.get<ModelRepository>(MODEL_REPOSITORY);
          const validModels = await modelRepo.findModelsByTask("text.embedding");
          const validIds = new Set(validModels?.map((m) => m.model_id) ?? []);

          const models = Array.isArray(input.model) ? input.model : [input.model];
          const narrowedModels = models.filter((m) => validIds.has(m));

          return {
            model: narrowedModels.length === 1 ? narrowedModels[0] : narrowedModels,
          };
        }

        override async execute(input: TaskInput): Promise<any> {
          return { result: "processed" };
        }
      }

      const task = new NarrowableModelConsumerTask({ id: "consumer" });

      // Create test registry with embedding and text generation models
      const registry = await createTestRegistry([...EMBEDDING_MODELS, ...TEXT_GEN_MODELS]);

      // Test narrowing with array of models (some compatible, some not)
      const inputWithMixed = {
        model: ["text-embedding-ada-002", "gpt-4", "all-MiniLM-L6-v2", "claude-3"],
      };

      const narrowedResult = await task.narrowInput(inputWithMixed, registry);

      // Should only keep the embedding models
      expect(narrowedResult.model).toEqual(["text-embedding-ada-002", "all-MiniLM-L6-v2"]);
    });

    it("should handle narrowing with single model string", async () => {
      class NarrowableModelTask extends Task<{ model: string | string[] }, { result: string }> {
        static override readonly type = "EmbeddingTask";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              model: {
                type: ["string", "array"],
                items: { type: "string" },
                format: "model:EmbeddingTask",
                description: "Embedding model identifier",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              result: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        public override async narrowInput(
          input: { model: string | string[] },
          registry: ServiceRegistry
        ): Promise<{ model: string | string[] }> {
          const modelRepo = registry.get<ModelRepository>(MODEL_REPOSITORY);
          const validModels = await modelRepo.findModelsByTask("text.embedding");
          const validIds = new Set(validModels?.map((m) => m.model_id) ?? []);

          const models = Array.isArray(input.model) ? input.model : [input.model];
          const narrowed = models.filter((m) => validIds.has(m));
          return { model: narrowed.length === 1 ? narrowed[0] : narrowed };
        }

        override async execute(input: TaskInput): Promise<any> {
          return { result: "processed" };
        }
      }

      const task = new NarrowableModelTask({ id: "task" });

      // Create test registry with only embedding models
      const registry = await createTestRegistry(EMBEDDING_MODELS);

      // Test with single valid model
      const result1 = await task.narrowInput({ model: "text-embedding-ada-002" }, registry);
      expect(result1.model).toBe("text-embedding-ada-002");

      // Test with single invalid model (gets filtered out)
      const result2 = await task.narrowInput({ model: "gpt-4" }, registry);
      expect(result2.model).toEqual([]);
    });

    it("should demonstrate why runtime compatibility is needed", () => {
      // This test demonstrates the flow:
      // 1. Design time: generic "model" connects to "model:EmbeddingTask" - marked as "runtime"
      // 2. Runtime: narrowInput() filters the models to only embedding-compatible ones
      // 3. If no models remain after filtering, task fails validation

      class GenericModelProvider extends Task<{ config: string }, { model: string }> {
        static override readonly type = "GenericModelProvider";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              config: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              model: {
                oneOf: [
                  {
                    title: "Model",
                    description: "The model to use",
                    format: "model",
                    type: "string",
                  },
                  {
                    type: "array",
                    items: {
                      title: "Model",
                      description: "The model to use",
                      format: "model",
                      type: "string",
                    },
                  },
                ],
                title: "Model",
                description: "The model to use",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          // Could return any model name
          return { model: "some-model-name" };
        }
      }

      const sourceTask = new GenericModelProvider({ id: "source" });
      const targetTask = new EmbeddingConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "model");
      graph.addDataflow(dataflow);

      // At design time, this is compatible but requires runtime checking
      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("runtime");

      // At runtime, the dataflow would:
      // 1. Get output from source: "some-model-name" (generic model with format: "model")
      // 2. Pass to target's narrowInput() (which expects format: "model:EmbeddingTask")
      // 3. narrowInput() checks if "some-model-name" is compatible with EmbeddingTask
      // 4. If compatible, task executes; if not, validation fails
      // This is why it's "runtime" compatible - we can't know at design time if the model will be valid
    });

    it("should verify narrowing is part of the format contract", () => {
      // The semantic annotation pattern: "name:narrowing"
      // - "model" = any model (no narrowing)
      // - "model:EmbeddingTask" = only models compatible with EmbeddingTask (narrowed)
      // - "model:TextGenerationTask" = only models compatible with TextGenerationTask (narrowed)

      // Different narrowings are incompatible because they filter to different model sets
      const embeddingProvider = new EmbeddingModelProviderTask({ id: "embedding" });

      class TextGenConsumer extends Task<{ model: string }, { result: string }> {
        static override readonly type = "TextGenerationConsumer";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              model: {
                type: "string",
                format: "model:TextGenerationTask",
                description: "Text generation model",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              result: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          return { result: "generated" };
        }
      }

      const textGenConsumer = new TextGenConsumer({ id: "consumer" });

      graph.addTask(embeddingProvider);
      graph.addTask(textGenConsumer);

      // Embedding model -> TextGeneration consumer = incompatible narrowings
      const dataflow = new Dataflow("embedding", "model", "consumer", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("incompatible");
    });
  });

  describe("incompatible connections", () => {
    it("should be incompatible when semantic names differ", () => {
      // Source: model -> Target: prompt (different semantic names)
      // We need a consumer task that accepts prompt input
      class PromptConsumerTask extends Task<{ prompt: string }, { result: string }> {
        static override readonly type = "PromptConsumerTask";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                format: "prompt",
                description: "Prompt string",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              result: {
                type: "string",
                description: "Processing result",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          return { result: "processed" };
        }
      }

      const sourceTask = new ModelProviderTask({ id: "source" });
      const targetTask = new PromptConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "prompt");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("incompatible");
    });

    it("should be incompatible when narrowing types differ", () => {
      // Source: model:EmbeddingTask -> Target: model:TextGenerationTask
      const sourceTask = new EmbeddingModelProviderTask({ id: "source" });
      const targetTask = new TextGenerationModelProviderTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      // Note: TextGenerationModelProviderTask has model as output, not input
      // We need to create a consumer task for TextGenerationTask
      class TextGenerationConsumerTask extends Task<{ model: string }, { result: string }> {
        static override readonly type = "TextGenerationConsumerTask";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              model: {
                type: "string",
                format: "model:TextGenerationTask",
                description: "Text generation model identifier",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              result: {
                type: "string",
                description: "Generated text",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          return { result: "generated text" };
        }
      }

      const textGenConsumer = new TextGenerationConsumerTask({ id: "textgenConsumer" });
      graph.addTask(textGenConsumer);

      const dataflow2 = new Dataflow("source", "model", "textgenConsumer", "model");
      graph.addDataflow(dataflow2);

      const compatibility = dataflow2.semanticallyCompatible(graph, dataflow2);
      expect(compatibility).toBe("incompatible");
    });

    it("should be incompatible when types don't match", () => {
      // Different base types should be incompatible regardless of semantic annotations
      class NumberProviderTask extends Task<{ input: string }, { value: number }> {
        static override readonly type = "NumberProviderTask";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              input: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              value: {
                type: "number",
                description: "Number value",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          return { value: 42 };
        }
      }

      const sourceTask = new NumberProviderTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "value", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("incompatible");
    });
  });

  describe("complex graph scenarios", () => {
    it("should handle a multi-task graph with mixed semantic compatibility", () => {
      // Create a graph: GenericModel -> SpecificEmbedding -> Consumer
      const genericProvider = new ModelProviderTask({ id: "genericProvider" });
      const embeddingConsumer = new EmbeddingConsumerTask({ id: "embeddingConsumer" });
      const embeddingProvider = new EmbeddingModelProviderTask({ id: "embeddingProvider" });
      const genericConsumer = new GenericModelConsumerTask({ id: "genericConsumer" });

      graph.addTask(genericProvider);
      graph.addTask(embeddingConsumer);
      graph.addTask(embeddingProvider);
      graph.addTask(genericConsumer);

      // Connection 1: generic model -> embedding consumer (runtime check needed)
      const dataflow1 = new Dataflow("genericProvider", "model", "embeddingConsumer", "model");
      graph.addDataflow(dataflow1);

      // Connection 2: embedding provider -> generic consumer (static compatible)
      const dataflow2 = new Dataflow("embeddingProvider", "model", "genericConsumer", "model");
      graph.addDataflow(dataflow2);

      const compatibility1 = dataflow1.semanticallyCompatible(graph, dataflow1);
      const compatibility2 = dataflow2.semanticallyCompatible(graph, dataflow2);

      expect(compatibility1).toBe("runtime");
      expect(compatibility2).toBe("static");
    });

    it("should handle dataflow with DATAFLOW_ALL_PORTS wildcard", () => {
      const sourceTask = new ModelProviderTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "*", "target", "*");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      // Wildcard ports should accept any schema
      expect(compatibility).toBe("static");
    });
  });

  describe("typed arrays with format annotations", () => {
    it("should handle typed array semantic annotations", () => {
      class Float64ArrayProviderTask extends Task<{ input: string }, { data: number[] }> {
        static override readonly type = "Float64ArrayProviderTask";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              input: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: { type: "number", format: "Float64" },
                format: "Float64Array",
                description: "Float64 array data",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          return { data: [1.0, 2.0, 3.0] };
        }
      }

      class Float64ArrayConsumerTask extends Task<{ data: number[] }, { result: string }> {
        static override readonly type = "Float64ArrayConsumerTask";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: { type: "number", format: "Float64" },
                format: "Float64Array",
                description: "Float64 array data",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              result: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          return { result: "processed" };
        }
      }

      const sourceTask = new Float64ArrayProviderTask({ id: "source" });
      const targetTask = new Float64ArrayConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "data", "target", "data");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("static");
    });

    it("should handle different typed arrays as incompatible with different typed arrays", () => {
      class Float64ArrayProviderTask extends Task<{ input: string }, { data: number[] }> {
        static override readonly type = "Float64ArrayProviderTask";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              input: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: { type: "number", format: "Float64" },
                format: "Float64Array",
                description: "Float64 array data",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          return { data: [1.0, 2.0, 3.0] };
        }
      }

      class Float32ArrayConsumerTask extends Task<{ data: number[] }, { result: string }> {
        static override readonly type = "Float32ArrayConsumerTask";

        static override inputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              data: {
                type: "array",
                items: { type: "number", format: "Float32" },
                format: "Float32Array",
                description: "Float32 array data",
              },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        static override outputSchema(): DataPortSchema {
          return {
            type: "object",
            properties: {
              result: { type: "string" },
            },
            additionalProperties: false,
          } as const satisfies DataPortSchema;
        }

        override async execute(input: TaskInput): Promise<any> {
          return { result: "processed" };
        }
      }

      const sourceTask = new Float64ArrayProviderTask({ id: "source" });
      const targetTask = new Float32ArrayConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "data", "target", "data");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      // Number array semantic annotations don't affect compatibility
      expect(compatibility).toBe("incompatible");
    });
  });

  describe("edge cases", () => {
    it("should be incompatible when connecting to non-existent port", () => {
      // Try to connect to a port that doesn't exist in the target's input schema
      const sourceTask = new ModelProviderTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      // "nonexistent" port doesn't exist in target's input schema
      const dataflow = new Dataflow("source", "model", "target", "nonexistent");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("incompatible");
    });

    it("should be incompatible when connecting from non-existent port", () => {
      // Try to connect from a port that doesn't exist in the source's output schema
      const sourceTask = new ModelProviderTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      // "nonexistent" port doesn't exist in source's output schema
      const dataflow = new Dataflow("source", "nonexistent", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("incompatible");
    });

    it("should handle missing schemas gracefully", () => {
      class NoSchemaTask extends Task {
        static override readonly type = "NoSchemaTask";

        static override inputSchema(): DataPortSchema {
          return true; // Accepts anything
        }

        static override outputSchema(): DataPortSchema {
          return true; // Returns anything
        }

        override async execute(input: TaskInput): Promise<any> {
          return {};
        }
      }

      const sourceTask = new NoSchemaTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      // Source returns anything, so runtime check needed
      expect(compatibility).toBe("runtime");
    });

    it("should handle false schema as incompatible", () => {
      class FalseSchemaTask extends Task {
        static override readonly type = "FalseSchemaTask";

        static override inputSchema(): DataPortSchema {
          return true;
        }

        static override outputSchema(): DataPortSchema {
          return false; // Rejects everything
        }

        override async execute(input: TaskInput): Promise<any> {
          return {};
        }
      }

      const sourceTask = new FalseSchemaTask({ id: "source" });
      const targetTask = new GenericModelConsumerTask({ id: "target" });

      graph.addTask(sourceTask);
      graph.addTask(targetTask);

      const dataflow = new Dataflow("source", "model", "target", "model");
      graph.addDataflow(dataflow);

      const compatibility = dataflow.semanticallyCompatible(graph, dataflow);
      expect(compatibility).toBe("incompatible");
    });
  });
});
