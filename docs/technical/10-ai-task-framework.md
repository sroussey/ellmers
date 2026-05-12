<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# AI Task Framework

## Overview

The AI task framework extends Workglow's core `Task` class with specialized behavior for
machine-learning workloads. Rather than embedding provider-specific logic into individual tasks, the
framework delegates execution to **strategies** that are resolved at runtime from the
`AiProviderRegistry`. This separation means a single `TextGenerationTask` class works identically
whether backed by OpenAI, Anthropic, Ollama, or HuggingFace Transformers -- the provider is
selected based on the model configuration attached to the task input.

The framework consists of three layers:

1. **`AiTask`** -- base class that handles model validation, job input construction, and strategy
   dispatch.
2. **`StreamingAiTask`** -- extends `AiTask` with `executeStream()` for token-by-token output.
3. **Execution strategies** -- `DirectExecutionStrategy` and `QueuedExecutionStrategy` determine
   how jobs reach the provider run functions.

```
                 ┌──────────────┐
                 │   AiTask     │  (model validation, job input, strategy dispatch)
                 └──────┬───────┘
                        │ extends
              ┌─────────┴──────────┐
              │  StreamingAiTask   │  (adds executeStream() with port annotation)
              └─────────┬──────────┘
                        │ extends
         ┌──────────────┼──────────────┐
         │              │              │
  TextGenerationTask  SummaryTask  EmbeddingTask  ...
```

Source files:

| File                                                   | Purpose                                              |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `packages/ai/src/task/base/AiTask.ts`                  | `AiTask` base class                                  |
| `packages/ai/src/task/base/StreamingAiTask.ts`         | `StreamingAiTask` with streaming support             |
| `packages/ai/src/task/base/AiTaskSchemas.ts`           | Schema helpers (`TypeModel`, `TypeImageInput`, etc.) |
| `packages/ai/src/execution/IAiExecutionStrategy.ts`    | Strategy interface and resolver type                 |
| `packages/ai/src/execution/DirectExecutionStrategy.ts` | Direct (non-queued) execution                        |
| `packages/ai/src/execution/QueuedExecutionStrategy.ts` | Queue-based execution with concurrency control       |
| `packages/ai/src/job/AiJob.ts`                         | `AiJob` class with error classification              |

---

## AiTask Base Class

`AiTask` extends the core `Task<Input, Output, Config>` class and adds AI-specific concerns:
model resolution validation, job input construction, strategy-based execution, and model-task
compatibility checks.

### Class Signature

```typescript
class AiTask<
  Input extends AiTaskInput = AiTaskInput,
  Output extends TaskOutput = TaskOutput,
  Config extends TaskConfig<Input> = TaskConfig<Input>,
> extends Task<Input, Output, Config>
```

The `AiTaskInput` interface requires a `model` property that can be either a string ID or a
resolved `ModelConfig` object:

```typescript
interface AiTaskInput extends TaskInput {
  model: string | ModelConfig;
}
```

By the time `execute()` is called, the input resolution system (see
[Schema System and Input Resolution](./09-schema-and-input-resolution.md)) has already converted
any string model ID into a full `ModelConfig` object. The `execute()` method asserts this:

```typescript
override async execute(input: Input, executeContext: IExecuteContext): Promise<Output | undefined> {
  const model = input.model as ModelConfig;
  if (!model || typeof model !== "object") {
    throw new TaskConfigurationError(
      "AiTask: Model was not resolved to ModelConfig"
    );
  }
  const jobInput = await this.getJobInput(input);
  const strategy = getAiProviderRegistry().getStrategy(model);
  return await strategy.execute(jobInput, executeContext, this.runConfig.runnerId) as Output;
}
```

### Entitlements

`AiTask` declares `hasDynamicEntitlements = true` and provides both static and instance-level
entitlement methods. The static method declares a baseline `AI_INFERENCE` entitlement. The instance
method adds model-specific entitlements when a model ID is known at construction time:

```typescript
public override entitlements(): TaskEntitlements {
  const base: TaskEntitlement[] = [
    { id: Entitlements.AI_INFERENCE, reason: "Runs AI model inference" },
  ];
  const modelId = typeof this.defaults.model === "string" ? this.defaults.model : undefined;
  if (modelId) {
    base.push({
      id: Entitlements.AI_MODEL,
      reason: `Uses model ${modelId}`,
      resources: [modelId],
    });
  }
  return { entitlements: base };
}
```

### Job Input Construction

The `getJobInput()` method transforms the task input into an `AiJobInput` envelope that carries
metadata needed by the execution strategy and job queue:

```typescript
interface AiJobInput<Input extends TaskInput = TaskInput> {
  taskType: string; // e.g., "TextGenerationTask"
  aiProvider: string; // e.g., "OPENAI"
  taskInput: Input & { model: ModelConfig };
  outputSchema?: JsonSchema; // For structured output tasks
  timeoutMs?: number; // Optional task-level timeout
}
```

The `taskType` is resolved from either a static `runtype` property (for tasks that alias their
execution to another type) or the standard `type` property. If the task declares structured output
(via `x-structured-output` on its output schema), the output schema is attached to the job input so
providers can request schema-conformant JSON from the model API.

### Input Validation

`validateInput()` verifies that all model properties have been resolved to `ModelConfig` objects
and that the model is compatible with the task type:

```typescript
// Checks model-task compatibility
const tasks = (model as ModelConfig).tasks;
if (Array.isArray(tasks) && tasks.length > 0 && !tasks.includes(this.type)) {
  throw new TaskConfigurationError(
    `AiTask: Model "${modelId}" is not compatible with task '${this.type}'`
  );
}
```

### Input Narrowing

The `narrowInput()` method filters model inputs that are incompatible with the current task. When
a model string ID resolves to a `ModelConfig` whose `tasks` array does not include the current task
type, the model field is set to `undefined`. This enables UI editors to display only compatible
models in dropdowns.

### Preview Execution

`AiTask` overrides `executePreview()` to delegate to a provider-registered preview run function if
one exists. Preview execution is lightweight and intended for UI previews (e.g., counting tokens
as the user types). If no preview function is registered for the provider and task type, it falls
back to the base `Task.executePreview()`:

```typescript
override async executePreview(
  input: Input, context: IExecutePreviewContext
): Promise<Output | undefined> {
  const model = input.model as ModelConfig | undefined;
  if (model && typeof model === "object" && model.provider) {
    const previewFn = getAiProviderRegistry().getPreviewRunFn(model.provider, taskType);
    if (previewFn) return previewFn(input, model);
  }
  return super.executePreview(input, context);
}
```

`executePreview()` is invoked only by `runPreview()`. It is never called as part of `run()` (no
post-execute overlay, no second stage). The two paths are strictly orthogonal: `run()` invokes
`execute()` (or `executeStream()`); `runPreview()` invokes `executePreview()`.

---

## StreamingAiTask

`StreamingAiTask` extends `AiTask` with an `executeStream()` method that yields `StreamEvent`
objects from the provider. This enables token-by-token streaming for text generation, summarization,
and similar tasks.

### Stream Modes

Subclasses annotate their output schema with `x-stream` to control streaming behavior:

| Mode        | Behavior                                                                |
| ----------- | ----------------------------------------------------------------------- |
| `"append"`  | Each chunk is a delta (e.g., a new token). Default for text generation. |
| `"object"`  | Each chunk is a progressively more complete partial object.             |
| `"replace"` | Each chunk is a revised full snapshot of the output.                    |

### Port Annotation

Providers yield raw `StreamEvent` objects without a `port` field (since they are unaware of the
task's schema structure). `StreamingAiTask.executeStream()` wraps `text-delta` and `object-delta`
events with the correct port determined from the task's output schema:

```typescript
async *executeStream(input: Input, context: IExecuteContext): AsyncIterable<StreamEvent<Output>> {
  const jobInput = await this.getJobInput(input);
  const strategy = getAiProviderRegistry().getStrategy(model);

  const outSchema = this.outputSchema();
  const ports = getStreamingPorts(outSchema);
  const defaultPort = ports.length > 0 ? ports[0].port : "text";

  for await (const event of strategy.executeStream(jobInput, context, this.runConfig.runnerId)) {
    if (event.type === "text-delta" || event.type === "object-delta") {
      yield { ...event, port: event.port ?? defaultPort };
    } else {
      yield event;
    }
  }
}
```

### Non-Streaming Fallback

The base `execute()` method inherited from `AiTask` remains available. Callers that do not need
streaming simply call `run()` which invokes `execute()` instead of `executeStream()`. The
`TaskRunner` determines which path to use based on whether the task has streaming ports.

---

## Execution Strategies

The `IAiExecutionStrategy` interface defines the contract for executing AI jobs:

```typescript
interface IAiExecutionStrategy {
  execute(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined
  ): Promise<TaskOutput>;

  executeStream(
    jobInput: AiJobInput<TaskInput>,
    context: IExecuteContext,
    runnerId: string | undefined
  ): AsyncIterable<StreamEvent<TaskOutput>>;

  abort(): void;
}
```

The `AiStrategyResolver` type maps a `ModelConfig` to the appropriate strategy at execution time:

```typescript
type AiStrategyResolver = (model: ModelConfig) => IAiExecutionStrategy;
```

### DirectExecutionStrategy

Used by API-based providers (OpenAI, Anthropic, Google Gemini) and local providers that do not
require GPU serialization. It creates an `AiJob` inline and executes it immediately without a queue:

```typescript
class DirectExecutionStrategy implements IAiExecutionStrategy {
  async execute(jobInput, context, runnerId): Promise<TaskOutput> {
    const job = new AiJob({ queueName: jobInput.aiProvider, jobRunId: runnerId, input: jobInput });
    return await job.execute(jobInput, {
      signal: context.signal,
      updateProgress: context.updateProgress,
    });
  }

  async *executeStream(jobInput, context, runnerId): AsyncIterable<StreamEvent<TaskOutput>> {
    const job = new AiJob({ ... });
    yield* job.executeStream(jobInput, { signal: context.signal, updateProgress: context.updateProgress });
  }
}
```

The direct strategy wires the task's `AbortSignal` through to the job and propagates progress
callbacks.

### QueuedExecutionStrategy

Used by GPU-bound providers (HuggingFace Transformers with WebGPU, LlamaCpp) that need serialized
access to hardware resources. It creates a `JobQueueServer` with a `ConcurrencyLimiter` to ensure
only one (or a configured number of) GPU operations run at a time.

Key behaviors:

- **Lazy queue creation** -- the queue is not created until the first execution. This avoids
  allocating resources for providers that are registered but never used.
- **Deduplication** -- if multiple `QueuedExecutionStrategy` instances target the same queue name,
  the first one wins and the others reuse the existing queue from the `TaskQueueRegistry`.
- **Abort propagation** -- the task's `AbortSignal` is wired to the queued job handle, so aborting
  a task also cancels its in-flight queue job.
- **Streaming fallback** -- because the job queue does not support streaming outputs, the
  `executeStream()` method falls back to `execute()` and emits a single `finish` event.

```typescript
class QueuedExecutionStrategy implements IAiExecutionStrategy {
  constructor(
    private readonly queueName: string,
    private readonly concurrency: number = 1,
    private readonly autoCreate: boolean = true
  ) {}

  async execute(jobInput, context, runnerId): Promise<TaskOutput> {
    const { client } = await this.ensureQueue();
    const handle = await client.submit(jobInput, { jobRunId: runnerId, maxRetries: 10 });
    // Wire abort signal to handle
    return await handle.waitFor();
  }
}
```

---

## AiJob and Error Classification

`AiJob` extends the base `Job` class to execute AI provider functions with timeout management and
error classification.

### Timeout Handling

`AiJob` applies timeouts via `AbortSignal.timeout()` combined with the caller's signal:

| Provider Type                           | Default Timeout     |
| --------------------------------------- | ------------------- |
| API providers (OpenAI, Anthropic, etc.) | 120 seconds         |
| Local inference (LlamaCpp, HFT ONNX)    | 300 seconds         |
| Explicit `timeoutMs` in job input       | Uses provided value |

### Error Classification

The `classifyProviderError()` function categorizes provider errors into three buckets for the job
queue retry system:

| Error Type            | HTTP Status        | Behavior             |
| --------------------- | ------------------ | -------------------- |
| `RetryableJobError`   | 429, 500-599       | Retried with backoff |
| `PermanentJobError`   | 400, 401, 403, 404 | Fails immediately    |
| `AbortSignalJobError` | N/A                | Task was cancelled   |

Specific patterns:

- **Rate limiting (429)** -- extracted retry-after header, defaults to 30-second delay.
- **Network errors** (`ECONNREFUSED`, `ETIMEDOUT`, `fetch failed`) -- retryable.
- **Timeout errors** -- retryable.
- **Auth errors (401, 403)** -- permanent, no retry.
- **Not found / bad request (400, 404)** -- permanent.
- **Server errors (500+)** -- retryable.
- **Abort patterns** -- detected via `AbortError` name, `TimeoutError` name, and message pattern
  matching (e.g., `"Pipeline download aborted"` from HFT).
- **Incomplete model cache** (`HFT_NULL_PROCESSOR:` prefix) -- retryable to allow re-download.
- **Unknown errors** -- treated as permanent to avoid infinite retries.

### Streaming Execution

`AiJob.executeStream()` yields `StreamEvent` objects from the provider's stream function. If no
stream function is registered, it falls back to non-streaming `execute()` and yields a single
`finish` event. On mid-stream errors, it logs a warning, yields a `finish` event with whatever data
was accumulated, and re-throws the classified error.

---

## AI Task Types

The `@workglow/ai` package provides a comprehensive set of concrete task types. All extend either
`AiTask` or `StreamingAiTask`:

### Text Tasks

| Task                             | Base Class        | Purpose                       |
| -------------------------------- | ----------------- | ----------------------------- |
| `TextGenerationTask`             | `StreamingAiTask` | Free-form text generation     |
| `TextSummaryTask`                | `StreamingAiTask` | Text summarization            |
| `TextRewriterTask`               | `StreamingAiTask` | Text rewriting/editing        |
| `TextTranslationTask`            | `StreamingAiTask` | Language translation          |
| `TextClassificationTask`         | `AiTask`          | Text classification           |
| `TextEmbeddingTask`              | `AiTask`          | Text embedding vectors        |
| `TextFillMaskTask`               | `AiTask`          | Masked language modeling      |
| `TextQuestionAnswerTask`         | `StreamingAiTask` | Question answering            |
| `TextLanguageDetectionTask`      | `AiTask`          | Language identification       |
| `TextNamedEntityRecognitionTask` | `AiTask`          | Named entity recognition      |
| `ToolCallingTask`                | `StreamingAiTask` | Function/tool calling         |
| `AgentTask`                      | `StreamingAiTask` | Autonomous agent execution    |
| `StructuredGenerationTask`       | `StreamingAiTask` | Schema-constrained generation |

### Image Tasks

| Task                      | Base Class        | Purpose                  |
| ------------------------- | ----------------- | ------------------------ |
| `ImageClassificationTask` | `AiTask`          | Image classification     |
| `ImageEmbeddingTask`      | `AiTask`          | Image embedding vectors  |
| `ImageSegmentationTask`   | `AiTask`          | Image segmentation masks |
| `ImageToTextTask`         | `StreamingAiTask` | Image captioning / VQA   |
| `ObjectDetectionTask`     | `AiTask`          | Bounding box detection   |
| `BackgroundRemovalTask`   | `AiTask`          | Background removal       |

### RAG Tasks

| Task                      | Base Class | Purpose                        |
| ------------------------- | ---------- | ------------------------------ |
| `HierarchicalChunkerTask` | `AiTask`   | Document chunking              |
| `ChunkVectorUpsertTask`   | `AiTask`   | Vector storage insertion       |
| `ChunkRetrievalTask`      | `AiTask`   | Retrieval-augmented generation |
| `RerankerTask`            | `AiTask`   | Result reranking               |
| `ContextBuilderTask`      | `AiTask`   | Context assembly for RAG       |

### Utility Tasks

| Task                      | Base Class | Purpose                  |
| ------------------------- | ---------- | ------------------------ |
| `CountTokensTask`         | `AiTask`   | Token counting           |
| `ModelInfoTask`           | `AiTask`   | Model metadata retrieval |
| `ModelSearchTask`         | `AiTask`   | Model discovery          |
| `ModelDownloadTask`       | `AiTask`   | Model weight downloading |
| `ModelDownloadRemoveTask` | `AiTask`   | Model unloading          |

---

## Creating Custom AI Tasks

To create a custom AI task:

```typescript
import { AiTask, AiTaskInput } from "@workglow/ai";
import { StreamingAiTask } from "@workglow/ai";
import type { DataPortSchema, TaskOutput } from "@workglow/task-graph";
import { TypeModel } from "@workglow/ai";

interface SentimentInput extends AiTaskInput {
  model: string | ModelConfig;
  text: string;
}

interface SentimentOutput extends TaskOutput {
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
}

class SentimentAnalysisTask extends AiTask<SentimentInput, SentimentOutput> {
  static readonly type = "SentimentAnalysisTask";
  static readonly category = "Text";
  static readonly cacheable = true;

  static inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        model: TypeModel("model:SentimentAnalysisTask"),
        text: { type: "string", title: "Text", description: "Text to analyze" },
      },
      required: ["model", "text"],
    } as const satisfies DataPortSchema;
  }

  static outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        sentiment: {
          type: "string",
          enum: ["positive", "negative", "neutral"],
          title: "Sentiment",
        },
        confidence: { type: "number", minimum: 0, maximum: 1, title: "Confidence" },
      },
      required: ["sentiment", "confidence"],
    } as const satisfies DataPortSchema;
  }
}
```

The task does not implement `execute()` directly -- the inherited `AiTask.execute()` delegates to
the provider strategy. The provider must register a run function for `"SentimentAnalysisTask"` that
performs the actual inference.

---

## API Reference

### AiTask

| Member                           | Type                  | Description                                  |
| -------------------------------- | --------------------- | -------------------------------------------- |
| `static type`                    | `string`              | `"AiTask"` -- override in subclasses         |
| `static hasDynamicEntitlements`  | `boolean`             | `true` -- entitlements depend on model       |
| `static entitlements()`          | `TaskEntitlements`    | Base AI inference entitlement                |
| `entitlements()`                 | `TaskEntitlements`    | Instance entitlements including model ID     |
| `execute(input, context)`        | `Promise<Output>`     | Resolves strategy and delegates              |
| `executePreview(input, context)` | `Promise<Output>`     | Delegates to provider preview fn             |
| `validateInput(input)`           | `Promise<boolean>`    | Validates model resolution and compatibility |
| `narrowInput(input, registry)`   | `Promise<Input>`      | Filters incompatible models                  |
| `getJobInput(input)`             | `Promise<AiJobInput>` | Constructs job envelope (protected)          |
| `createJob(input, queueName?)`   | `Promise<Job>`        | Creates a standalone AiJob instance          |

### StreamingAiTask

| Member                          | Type                         | Description                         |
| ------------------------------- | ---------------------------- | ----------------------------------- |
| `static type`                   | `string`                     | `"StreamingAiTask"`                 |
| `executeStream(input, context)` | `AsyncIterable<StreamEvent>` | Yields port-annotated stream events |

### IAiExecutionStrategy

| Method                                       | Description                                |
| -------------------------------------------- | ------------------------------------------ |
| `execute(jobInput, context, runnerId)`       | Non-streaming execution                    |
| `executeStream(jobInput, context, runnerId)` | Streaming execution yielding `StreamEvent` |
| `abort()`                                    | Cancels in-flight execution                |

### AiJob

| Member                          | Type                         | Description                                     |
| ------------------------------- | ---------------------------- | ----------------------------------------------- |
| `execute(input, context)`       | `Promise<Output>`            | Executes via provider run function with timeout |
| `executeStream(input, context)` | `AsyncIterable<StreamEvent>` | Streaming execution with error recovery         |

### AiJobInput

| Field          | Type                             | Description                                   |
| -------------- | -------------------------------- | --------------------------------------------- |
| `taskType`     | `string`                         | Task type name (e.g., `"TextGenerationTask"`) |
| `aiProvider`   | `string`                         | Provider name (e.g., `"OPENAI"`)              |
| `taskInput`    | `Input & { model: ModelConfig }` | Resolved task input                           |
| `outputSchema` | `JsonSchema` (optional)          | Structured output schema                      |
| `timeoutMs`    | `number` (optional)              | Provider call timeout                         |
