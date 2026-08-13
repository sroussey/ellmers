<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# AI Provider System

## Overview

The AI provider system is the bridge between abstract AI tasks and concrete model execution. A
**provider** represents a backend service or runtime -- OpenAI's API, Anthropic's API, a local
Ollama server, HuggingFace Transformers running in-browser via WebGPU, Chrome's built-in AI APIs,
and so on. Each provider registers **run functions** that know how to execute specific task types
against that backend.

The system is designed around two registration modes:

1. **Inline** -- the provider imports its run functions directly and registers them on the main
   thread. Suitable for lightweight API providers where the "run function" is just an HTTP call.
2. **Worker** -- the provider registers proxy functions on the main thread that delegate to a Web
   Worker. The heavy ML libraries are loaded only inside the worker. This keeps the main thread
   responsive for GPU-intensive local inference.

```
Main Thread                              Worker Thread
+-----------------------+                +-----------------------+
|  AiProvider.register  |                |  AiProvider           |
|    (worker mode)      |                |  .registerOnWorker    |
|                       |     message    |  Server(server)       |
|  workerProxy(fn) -----+--------------->|                       |
|                       |     result     |  actual run fn        |
|  <--------------------+----------------|  (heavy ML imports)   |
+-----------------------+                +-----------------------+
```

Source files:

| File                                                   | Purpose                                          |
| ------------------------------------------------------ | ------------------------------------------------ |
| `packages/ai/src/provider/AiProvider.ts`               | `AiProvider` abstract base class                 |
| `packages/ai/src/provider/QueuedAiProvider.ts`         | `QueuedAiProvider` with job queue support        |
| `packages/ai/src/provider/AiProviderRegistry.ts`       | Singleton registry and function type definitions |
| `packages/ai/src/execution/IAiExecutionStrategy.ts`    | Strategy interface                               |
| `packages/ai/src/execution/DirectExecutionStrategy.ts` | Non-queued strategy                              |
| `packages/ai/src/execution/QueuedExecutionStrategy.ts` | Queue-based strategy                             |

---

## AiProvider Base Class

`AiProvider` is the abstract base class that all providers extend. It handles the mechanics of
registering run functions with the `AiProviderRegistry` and setting up worker proxies.

### Abstract Properties

Every provider subclass must declare:

```typescript
abstract class AiProvider<TModelConfig extends ModelConfig = ModelConfig> {
  /** Unique identifier (e.g., "HF_TRANSFORMERS_ONNX", "OPENAI", "ANTHROPIC") */
  abstract readonly name: string;

  /** Human-readable label for UI display */
  abstract readonly displayName: string;

  /** Whether models run on the local machine */
  abstract readonly isLocal: boolean;

  /** Whether the provider works in browser environments */
  abstract readonly supportsBrowser: boolean;

  /** List of task type names this provider supports */
  abstract readonly taskTypes: readonly string[];
}
```

### Constructor Injection

The constructor accepts three optional maps of run functions:

```typescript
constructor(
  tasks?: Record<string, AiProviderRunFn>,           // Standard execution (run path)
  streamTasks?: Record<string, AiProviderStreamFn>,  // Streaming execution (run path)
  previewTasks?: Record<string, AiProviderPreviewRunFn> // Preview-only path (runPreview)
)
```

Heavy ML library imports live in the run function files (`*_JobRunFns.ts`), not in the provider
class itself. If `tasks` is provided, the provider operates in **inline mode**. If omitted, it
operates in **worker mode** and requires a `worker` option during registration.

### Run Function Types

```typescript
// Standard run function -- returns a Promise with the full output
type AiProviderRunFn<Input, Output, Model> = (
  input: Input,
  model: Model | undefined,
  update_progress: (progress: number, message?: string, details?: any) => void,
  signal: AbortSignal,
  outputSchema?: JsonSchema
) => Promise<Output>;

// Streaming run function -- yields incremental StreamEvents
type AiProviderStreamFn<Input, Output, Model> = (
  input: Input,
  model: Model | undefined,
  signal: AbortSignal,
  outputSchema?: JsonSchema
) => AsyncIterable<StreamEvent<Output>>;

// Preview run function -- lightweight, computes a fast preview from input alone.
// Called only by AiTask.executePreview() on the runPreview() path.
// No `signal` / `update_progress` -- preview execution is lightweight and synchronous-ish.
type AiProviderPreviewRunFn<Input, Output, Model> = (
  input: Input,
  model: Model | undefined
) => Promise<Output | undefined>;
```

---

## Inline vs Worker Registration

### Inline Mode

The provider imports run functions directly and registers them on the main thread. Best for
cloud API providers where the "heavy" dependency is just an HTTP SDK:

```typescript
import {
  ANTHROPIC_TASKS,
  ANTHROPIC_STREAM_TASKS,
  ANTHROPIC_PREVIEW_TASKS,
} from "./common/Anthropic_JobRunFns";
import { AnthropicQueuedProvider } from "./AnthropicQueuedProvider";

await new AnthropicQueuedProvider(
  ANTHROPIC_TASKS,
  ANTHROPIC_STREAM_TASKS,
  ANTHROPIC_PREVIEW_TASKS
).register();
```

### Worker Mode

The provider is constructed without tasks. A `Worker` (or lazy `() => Worker` factory) is passed
during registration. Proxy functions are created automatically that delegate to the worker via
`WorkerManager`:

```typescript
// Main thread -- lightweight, no heavy ML imports:
await new HuggingFaceTransformersQueuedProvider().register({
  worker: () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  queue: { concurrency: { gpu: 1, cpu: 4 } },
});
```

When the provider is registered in worker mode, `AiProvider.register()` automatically creates
worker proxies for all three function kinds (`registerAsWorkerRunFn`, `registerAsWorkerStreamFn`,
`registerAsWorkerPreviewRunFn`) so that calls from the main thread are dispatched into the worker
without the worker's heavy ML imports being loaded on the main thread.

On the worker side, the provider is constructed with tasks and registered on a `WorkerServer`:

```typescript
// Inside worker.ts
import { HFT_TASKS, HFT_STREAM_TASKS } from "./common/HFT_JobRunFns";
import { HuggingFaceTransformersProvider } from "./HuggingFaceTransformersProvider";

const workerServer = globalServiceRegistry.get(WORKER_SERVER);
new HuggingFaceTransformersProvider(HFT_TASKS, HFT_STREAM_TASKS).registerOnWorkerServer(
  workerServer
);
workerServer.sendReady();
```

---

## QueuedAiProvider

`QueuedAiProvider` extends `AiProvider` for providers that need serialized access to hardware
resources. It automatically creates a `QueuedExecutionStrategy` and registers a strategy resolver
with the `AiProviderRegistry`.

### Queue Setup

The `afterRegister()` override creates a `QueuedExecutionStrategy` with a queue named
`{providerName}_gpu` and registers a strategy resolver:

```typescript
protected override async afterRegister(options: AiProviderRegisterOptions): Promise<void> {
  this.queuedStrategy = new QueuedExecutionStrategy(
    `${this.name}_gpu`,
    resolveAiProviderGpuQueueConcurrency(options.queue?.concurrency),
    options.queue?.autoCreate !== false
  );
  getAiProviderRegistry().registerStrategyResolver(
    this.name,
    (model) => this.getStrategyForModel(model)
  );
}
```

The queue is created lazily on first use, backed by `InMemoryQueueStorage` with a
`ConcurrencyLimiter` to control how many jobs run simultaneously.

### Concurrency Configuration

```typescript
type AiProviderQueueConcurrency = number | Record<string, number>;
```

- **Numeric** -- sets the GPU queue limit directly (e.g., `1` for single-GPU serialization).
- **Record** -- supports multiple named queues. For example, HuggingFace Transformers ONNX uses
  `{ gpu: 1, cpu: 4 }` to run one WebGPU model at a time but allow four CPU/WASM models
  concurrently.

### Model-Aware Strategy Selection

Subclasses override `getStrategyForModel()` to route different models through different queues.
The HuggingFace Transformers provider demonstrates this by maintaining two separate queued
strategies:

```typescript
class HuggingFaceTransformersQueuedProvider extends QueuedAiProvider {
  private cpuStrategy: IAiExecutionStrategy | undefined;

  protected override async afterRegister(options: AiProviderRegisterOptions): Promise<void> {
    await super.afterRegister(options); // creates this.queuedStrategy for GPU
    this.cpuStrategy = this.createQueuedStrategy(
      HF_TRANSFORMERS_ONNX_CPU,
      resolveHftCpuQueueConcurrency(options.queue?.concurrency, hftDefaultCpuQueueConcurrency),
      options
    );
  }

  protected override getStrategyForModel(model: ModelConfig): IAiExecutionStrategy {
    const device = (model as HfTransformersOnnxModelConfig).provider_config?.device;
    if (device && GPU_DEVICES.has(device)) {
      return this.queuedStrategy!; // WebGPU/Metal -> serialized
    }
    return this.cpuStrategy!; // WASM/CPU -> higher concurrency
  }
}
```

---

## AiProviderRegistry

The `AiProviderRegistry` is a singleton that manages all provider registrations, run function
lookups, and execution strategy resolution.

### Internal State

The registry maintains three two-level `Map` structures, keyed by task type then provider name:

```typescript
class AiProviderRegistry {
  runFnRegistry: Map<string, Map<string, AiProviderRunFn>>; // taskType -> provider -> fn
  streamFnRegistry: Map<string, Map<string, AiProviderStreamFn>>;
  previewRunFnRegistry: Map<string, Map<string, AiProviderPreviewRunFn>>;
  private providers: Map<string, AiProvider>;
  private strategyResolvers: Map<string, AiStrategyResolver>;
  private defaultStrategy: IAiExecutionStrategy | undefined;
}
```

This enables O(1) function lookup given a task type and provider name.

### Singleton Access

```typescript
function getAiProviderRegistry(): AiProviderRegistry;
function setAiProviderRegistry(pr: AiProviderRegistry): void;
```

`setAiProviderRegistry()` allows replacing the singleton for testing or isolated environments.

### Strategy Resolution

When a task executes, the registry resolves the execution strategy for the model's provider. If a
provider registered a strategy resolver (via `QueuedAiProvider`), it is called with the full
`ModelConfig`. Otherwise, a shared `DirectExecutionStrategy` singleton is returned:

```typescript
const strategy = registry.getStrategy(model);
// -> calls strategyResolvers.get(model.provider)(model)
// -> falls back to DirectExecutionStrategy if no resolver
```

### Provider Introspection

```typescript
const ids: string[] = registry.getInstalledProviderIds();
// ["ANTHROPIC", "HF_TRANSFORMERS_ONNX", "OLLAMA", "OPENAI"]

const textGenProviders: string[] = registry.getProviderIdsForTask("TextGenerationTask");
// ["ANTHROPIC", "OPENAI", "OLLAMA"]
```

`getDirectRunFn()` throws with a diagnostic message listing installed providers and which support
the requested task type.

---

## Provider Lifecycle

The complete lifecycle of a provider from registration to execution:

```
1. Construction
   new MyProvider(tasks?, streamTasks?, previewTasks?)

2. Registration (main thread)
   await provider.register({ worker?, queue? })
     -> onInitialize(context)          // provider-specific setup
     -> register run functions         // inline or worker proxy
     -> registerProvider(this)         // add to AiProviderRegistry
     -> afterRegister(options)         // QueuedAiProvider creates queue here

3. Worker Setup (worker thread, if worker mode)
   new MyProvider(tasks, streamTasks).registerOnWorkerServer(server)

4. Execution (triggered by AiTask.execute())
   strategy = registry.getStrategy(model)
   output = strategy.execute(jobInput, context, runnerId)
     -> DirectExecutionStrategy: AiJob.execute() -> getDirectRunFn() -> fn()
     -> QueuedExecutionStrategy: submit to queue -> AiJob.execute() -> fn()

5. Disposal
   await provider.dispose()
```

| Hook                     | When Called           | Purpose                                             |
| ------------------------ | --------------------- | --------------------------------------------------- |
| `onInitialize(context)`  | Start of `register()` | Provider-specific setup (e.g., WASM backend config) |
| `afterRegister(options)` | End of `register()`   | Post-registration setup (e.g., queue creation)      |
| `dispose()`              | Manual teardown       | Resource cleanup (e.g., clearing pipeline caches)   |

If `afterRegister()` throws, the provider is cleaned up from the registry via
`unregisterProvider()` to avoid an inconsistent state.

---

## Streaming Convention

Provider stream functions (`AiProviderStreamFn`) follow a strict stateless convention:

1. **Do not accumulate output.** Yield incremental `text-delta` or `object-delta` events only.
2. **Yield a `finish` event** at the end with `{} as Output`. The consumer (`StreamingAiTask` /
   `TaskRunner`) is responsible for accumulating deltas into the final output.
3. **No `update_progress` callback.** For streaming providers, the stream itself is the progress
   signal.
4. **Include `AbortSignal` support.** The `signal` parameter must be checked or passed through to
   underlying API calls.

This design keeps providers stateless and avoids double-buffering.

```typescript
async function* myStreamFn(
  input: Input,
  model: ModelConfig,
  signal: AbortSignal,
  outputSchema?: JsonSchema
): AsyncIterable<StreamEvent<Output>> {
  const stream = await callModelApi(input, model, { signal });

  for await (const chunk of stream) {
    yield { type: "text-delta", delta: chunk.text };
  }

  yield { type: "finish", data: {} as Output };
}
```

For queued providers, `QueuedExecutionStrategy.executeStream()` falls back to `execute()` and
yields a single `finish` event so GPU serialization is still respected.

---

## Vendor Provider Packages

Unlike core packages that build per-runtime targets (`browser.ts`, `node.ts`), each
provider lives in its own package under `providers/*` with optional peer dependencies on the
underlying vendor SDK. Providers import shared base classes and helpers from
`@workglow/ai/provider-utils`.

```typescript
import "@workglow/anthropic/ai"; // Claude (requires @anthropic-ai/sdk)
import "@workglow/openai/ai"; // OpenAI (requires openai)
import "@workglow/google-gemini/ai"; // Google Gemini (requires @google/genai)
import "@workglow/ollama/ai"; // Ollama (requires ollama)
import "@workglow/huggingface-transformers/ai"; // HuggingFace Transformers.js
import "@workglow/huggingface-inference/ai"; // HuggingFace Inference API
import "@workglow/node-llama-cpp/ai"; // node-llama-cpp
import "@workglow/tf-mediapipe/ai"; // TensorFlow MediaPipe (browser)
import "@workglow/chrome-ai/ai"; // Chrome Built-in AI
```

Each vendor package also exposes an `/ai-runtime` entry (e.g.
`@workglow/anthropic/ai-runtime`) that exports the heavy run function implementations
and worker registration helpers. The `/ai` entry exports only the lightweight provider
class, constants, and the worker-backed registration function.

Some providers (Ollama, OpenAI) also have browser-specific conditional exports in `package.json`.

---

## Available Providers

| Provider           | Class                             | `name`                   | Local | Browser | Key Task Types                                                                     |
| ------------------ | --------------------------------- | ------------------------ | :---: | :-----: | ---------------------------------------------------------------------------------- |
| Anthropic          | `AnthropicProvider`               | `"ANTHROPIC"`            |  No   |   Yes   | Text generation, summarization, rewriting, structured output, tool calling         |
| OpenAI             | `OpenAiProvider`                  | `"OPENAI"`               |  No   |   Yes   | Text generation, embeddings, structured output, tool calling                       |
| Google Gemini      | `GoogleGeminiProvider`            | `"GOOGLE_GEMINI"`        |  No   |   Yes   | Text generation, embeddings, structured output, tool calling                       |
| Ollama             | `OllamaProvider`                  | `"OLLAMA"`               |  Yes  |   Yes   | Text generation, embeddings, rewriting, summarization, tool calling                |
| HF Transformers    | `HuggingFaceTransformersProvider` | `"HF_TRANSFORMERS_ONNX"` |  Yes  |   Yes   | Embeddings, classification, NER, translation, image segmentation, object detection |
| HF Inference       | `HfInferenceProvider`             | `"HF_INFERENCE"`         |  No   |   Yes   | Text generation, embeddings, rewriting, summarization, tool calling                |
| LlamaCpp           | `LlamaCppProvider`                | `"LOCAL_LLAMACPP"`       |  Yes  |   No    | Text generation, embeddings, token counting, tool calling                          |
| MediaPipe          | `TensorFlowMediaPipeProvider`     | `"TENSORFLOW_MEDIAPIPE"` |  Yes  |   Yes   | Text/image embeddings, classification, segmentation, pose/face/hand landmarks      |
| Chrome Built-in AI | `WebBrowserProvider`              | `"WEB_BROWSER"`          |  Yes  |   Yes   | Text generation, summarization, translation, language detection, rewriting         |

---

## Adding a New Provider

### Step 1: Define the Provider Class

```typescript
// MyCloudProvider.ts -- worker-side (extends AiProvider, no queue/storage)
import { AiProvider } from "@workglow/ai/worker";
import type { AiProviderRunFn, AiProviderStreamFn } from "@workglow/ai/worker";

export class MyCloudProvider extends AiProvider {
  readonly name = "MY_CLOUD";
  readonly displayName = "My Cloud AI";
  readonly isLocal = false;
  readonly supportsBrowser = true;
  readonly taskTypes = ["TextGenerationTask", "TextEmbeddingTask"] as const;
}
```

For providers that need GPU queuing, extend `QueuedAiProvider` instead and import from
`@workglow/ai` (not `@workglow/ai/worker`).

### Step 2: Implement Run Functions

Create a `MyCloud_JobRunFns.ts` file with the actual implementations. Export task maps keyed by
task type name:

```typescript
export const MY_CLOUD_TASKS = {
  TextGenerationTask: async (input, model, updateProgress, signal) => {
    const response = await fetch("https://api.mycloud.ai/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: input.prompt, model: model?.model_id }),
      signal,
    });
    return { text: await response.text() };
  },
};

export const MY_CLOUD_STREAM_TASKS = {
  TextGenerationTask: async function* (input, model, signal) {
    // ... yield text-delta events, then finish with {} as Output
    yield { type: "finish", data: {} as any };
  },
};
```

### Step 3: Create Registration Helpers

Create `registerMyCloudInline.ts` (imports run functions, constructs provider with tasks) and
`registerMyCloudWorker.ts` (registers on `WorkerServer` inside a worker). Follow the Anthropic
provider as a template.

### Step 4: Register Models

```typescript
import { getGlobalModelRepository } from "@workglow/ai";

const repo = getGlobalModelRepository();
await repo.addModel({
  model_id: "my-cloud-gpt",
  title: "My Cloud GPT",
  description: "A cloud-hosted language model",
  provider: "MY_CLOUD",
  tasks: ["TextGenerationTask", "TextEmbeddingTask"],
  provider_config: {},
  metadata: {},
});
```

### Step 5: Add Sub-Path Export

Add the provider to `package.json` `exports` and the build scripts.

---

## API Reference

### AiProvider (abstract)

| Member                           | Type                                  | Description                    |
| -------------------------------- | ------------------------------------- | ------------------------------ |
| `name`                           | `string` (abstract)                   | Unique provider identifier     |
| `displayName`                    | `string` (abstract)                   | Human-readable label           |
| `isLocal`                        | `boolean` (abstract)                  | Whether models run locally     |
| `supportsBrowser`                | `boolean` (abstract)                  | Whether usable in browsers     |
| `taskTypes`                      | `readonly string[]` (abstract)        | Supported task type names      |
| `register(options?)`             | `Promise<void>`                       | Register on the main thread    |
| `registerOnWorkerServer(server)` | `void`                                | Register on a Web Worker       |
| `dispose()`                      | `Promise<void>`                       | Cleanup resources              |
| `getRunFn(taskType)`             | `AiProviderRunFn \| undefined`        | Get run function for task type |
| `getStreamFn(taskType)`          | `AiProviderStreamFn \| undefined`     | Get stream function            |
| `getPreviewRunFn(taskType)`      | `AiProviderPreviewRunFn \| undefined` | Get preview run function       |

### QueuedAiProvider (abstract)

| Member                                             | Type                                  | Description                      |
| -------------------------------------------------- | ------------------------------------- | -------------------------------- |
| `queuedStrategy`                                   | `QueuedExecutionStrategy` (protected) | The queue strategy instance      |
| `getStrategyForModel(model)`                       | `IAiExecutionStrategy` (protected)    | Override for model-aware routing |
| `createQueuedStrategy(name, concurrency, options)` | `QueuedExecutionStrategy` (protected) | Helper for extra queues          |

### AiProviderRegistry

| Method                                             | Description                                |
| -------------------------------------------------- | ------------------------------------------ |
| `registerProvider(provider)`                       | Register a provider instance               |
| `unregisterProvider(name)`                         | Remove a provider and all its functions    |
| `getProvider(name)`                                | Get a provider by name                     |
| `getProviders()`                                   | Get all providers as a Map                 |
| `getInstalledProviderIds()`                        | Sorted list of provider names              |
| `getProviderIdsForTask(taskType)`                  | Providers supporting a task type           |
| `registerRunFn(provider, taskType, fn)`            | Register a direct run function             |
| `registerStreamFn(provider, taskType, fn)`         | Register a stream function                 |
| `registerPreviewRunFn(provider, taskType, fn)`     | Register a preview run function            |
| `registerAsWorkerRunFn(provider, taskType)`        | Register a worker-proxied run function     |
| `registerAsWorkerStreamFn(provider, taskType)`     | Register a worker-proxied stream function  |
| `registerAsWorkerPreviewRunFn(provider, taskType)` | Register a worker-proxied preview function |
| `getDirectRunFn(provider, taskType)`               | Get run function (throws if missing)       |
| `getStreamFn(provider, taskType)`                  | Get stream function (returns undefined)    |
| `getPreviewRunFn(provider, taskType)`              | Get preview function (returns undefined)   |
| `registerStrategyResolver(provider, resolver)`     | Register a strategy resolver               |
| `getStrategy(model)`                               | Resolve execution strategy for a model     |

### AiProviderRegisterOptions

| Field               | Type                               | Description                                        |
| ------------------- | ---------------------------------- | -------------------------------------------------- |
| `worker`            | `Worker \| (() => Worker)`         | Web Worker for worker-backed mode                  |
| `queue.concurrency` | `number \| Record<string, number>` | Job queue concurrency                              |
| `queue.autoCreate`  | `boolean`                          | Whether to auto-create the queue (default: `true`) |

### getAiProviderRegistry() / setAiProviderRegistry(pr)

Access or replace the global `AiProviderRegistry` singleton.
