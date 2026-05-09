- [Using Workflow \& a config helper](#using-workflow--a-config-helper)
- [Using Task and TaskGraph directly (\& a config helper)](#using-task-and-taskgraph-directly--a-config-helper)
- [Using Task and TaskGraph directly (no config helper)](#using-task-and-taskgraph-directly-no-config-helper)
- [Preset Configs](#preset-configs)
  - [Registering Providers](#registering-providers)
  - [Registering Provider plus related Job Queue](#registering-provider-plus-related-job-queue)
    - [In memory:](#in-memory)
    - [Using SQLite:](#using-sqlite)
- [Workflow](#workflow)
- [JSON Configuration](#json-configuration)
- [Tasks](#tasks)
- [TaskGraph](#taskgraph)
- [Dataflows](#dataflows)
- [Source](#source)
  - [`docs/`](#docs)
  - [`packages/storage`](#packagesstorage)
  - [`packages/job-queue`](#packagesjob-queue)
  - [`packages/task-graph`](#packagestask-graph)
  - [`packages/ai`](#packagesai)
  - [`providers/*`](#providers)
  - [`packages/util`](#packagesutil)
  - [`examples/cli`](#examplescli)
  - [`examples/web`](#examplesweb)
  - [`builder`](#builder)

# Developer Getting Started

This project is not yet ready to be published on npm. So for now, use the source Luke.

```bash
git clone https://github.com/workglow-dev/libs.git
cd workglow
bun install
bun run build
cd examples/web
bun run dev
```

This will bring up a web page where you can edit some json to change the graph, and run it.

Also, you can open DevTools and edit that way (follow the instructions for enabling Console Formatters for best experience). A simple task graph workflow is available there. Just type `workflow` in the console and you can start building a graph. With the custom formatters, you can see the graph as you build it, as well as documentation. Everything self documents.

After this, please read [Architecture](02_architecture.md) before attempting to [write your own Tasks](03_extending.md).

# Get Shit Done

## Using Workflow & a config helper

```ts
import { Workflow } from "workglow";
import { registerHuggingFaceTransformersInline } from "workglow/hf-transformers/runtime";
// config and start up
await registerHuggingFaceTransformersInline();

const laMiniModelConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
} as const;

const workflow = new Workflow();
workflow
  .downloadModel({ model: laMiniModelConfig })
  .textRewriter({
    text: "The quick brown fox jumps over the lazy dog.",
    prompt: "Rewrite the following text in reverse:",
  })
  .rename("text", "console")
  .debugLog();
await workflow.run();

// Export the graph
const graphJson = workflow.toJSON();
console.log(graphJson);
```

## Using Task and TaskGraph directly (& a config helper)

This is equivalent to creating the graph directly, with additional features like caching and reactive execution:

```ts
import { Dataflow, TaskGraph } from "workglow";
import { DownloadModelTask, TextRewriterTask } from "workglow";
import { DebugLogTask } from "workglow";
import { registerHuggingFaceTransformersInline } from "workglow/hf-transformers/runtime";

// config and start up
await registerHuggingFaceTransformersInline();

const laMiniModelConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
} as const;

// build and run graph
const graph = new TaskGraph();
graph.addTask(new DownloadModelTask({ model: laMiniModelConfig }, { id: "1" }));
graph.addTask(
  new TextRewriterTask(
    {
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: "Rewrite the following text in reverse:",
      // model will be provided by the dataflow below
    },
    { id: "2" }
  )
);
graph.addTask(new DebugLogTask({}, { id: "3" }));
graph.addDataflow(
  new Dataflow({
    sourceTaskId: "1",
    sourceTaskPortId: "model",
    targetTaskId: "2",
    targetTaskPortId: "model",
  })
);
graph.addDataflow(
  new Dataflow({
    sourceTaskId: "2",
    sourceTaskPortId: "text",
    targetTaskId: "3",
    targetTaskPortId: "console",
  })
);

await graph.run();
```

## Using Task and TaskGraph directly (no config helper)

And unrolling the helpers, we get the following equivalent code:

```ts
import { Dataflow, TaskGraph, getTaskQueueRegistry, TaskInput, TaskOutput } from "workglow";
import {
  DownloadModelTask,
  TextRewriterTask,
  AiJob,
  AiJobInput,
  InMemoryModelRepository,
  setGlobalModelRepository,
} from "workglow";
import { DebugLogTask } from "workglow";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "workglow";
import { InMemoryQueueStorage } from "workglow";
import { HF_TRANSFORMERS_ONNX } from "workglow/hf-transformers";
import { registerHuggingFaceTransformersInline } from "workglow/hf-transformers/runtime";

// Provider run functions on this thread
await registerHuggingFaceTransformersInline();

// Set up a model repo and models
const modelRepo = new InMemoryModelRepository();
setGlobalModelRepository(modelRepo);
await modelRepo.addModel({
  model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
  tasks: ["TextGenerationTask", "TextRewriterTask"],
  title: "LaMini-Flan-T5-783M",
  description: "LaMini-Flan-T5-783M quantized to 8bit",
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text2text-generation",
    pooling: "mean",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
  metadata: {},
});

// Job queue for the provider
const queueName = HF_TRANSFORMERS_ONNX;
const storage = new InMemoryQueueStorage<AiJobInput<TaskInput>, TaskOutput>(queueName);

const server = new JobQueueServer<AiJobInput<TaskInput>, TaskOutput>(AiJob, {
  storage,
  queueName,
  limiter: new ConcurrencyLimiter(1),
});

const client = new JobQueueClient<AiJobInput<TaskInput>, TaskOutput>({
  storage,
  queueName,
});

client.attach(server);
getTaskQueueRegistry().registerQueue({ server, client, storage });
await server.start();

const laMiniModelConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
} as const;

// Build and run graph
const graph = new TaskGraph();
graph.addTask(new DownloadModelTask({ model: laMiniModelConfig }, { id: "1" }));
graph.addTask(
  new TextRewriterTask(
    {
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: "Rewrite the following text in reverse:",
    },
    { id: "2" }
  )
);
graph.addTask(new DebugLogTask({}, { id: "3" }));
graph.addDataflow(
  new Dataflow({
    sourceTaskId: "1",
    sourceTaskPortId: "model",
    targetTaskId: "2",
    targetTaskPortId: "model",
  })
);
graph.addDataflow(
  new Dataflow({
    sourceTaskId: "2",
    sourceTaskPortId: "text",
    targetTaskId: "3",
    targetTaskPortId: "console",
  })
);

await graph.run();
```

You can use as much or as little "magic" as you want. The config helpers are there to make it easier to get started, but eventually you will want to do it yourself.

## Preset Configs

### Registering Providers

Tasks are agnostic to the provider. Text embedding can be done with several providers, such as Hugging Face Transformers (ONNX) or MediaPipe locally, or OpenAI etc via API calls.

- **`registerHuggingFaceTransformersInline()`** — Registers the Hugging Face Transformers ONNX provider on the current thread (task maps are wired inside the implementation). Use an ONNX model id for `TextEmbedding`, etc.
- **`registerTensorFlowMediaPipeInline()`** — Registers the TensorFlow MediaPipe provider on the current thread. Use a `TENSORFLOW_MEDIAPIPE` model record.

### Registering Provider plus related Job Queue

LLM providers have long running functions. These are handled by a Job Queue. The `provider.register()` call creates the queue automatically. For convenience:

#### In memory:

```ts
import { registerHuggingFaceTransformersInline } from "workglow/hf-transformers/runtime";
import { registerTensorFlowMediaPipeInline } from "workglow/tf-mediapipe/runtime";

await registerHuggingFaceTransformersInline();
await registerTensorFlowMediaPipeInline();
```

For browser apps, prefer **worker mode** to keep the main thread responsive:

```ts
// Main thread
import { registerHuggingFaceTransformers } from "workglow/hf-transformers";

await registerHuggingFaceTransformers({
  worker: () => new Worker(new URL("./worker_hft.ts", import.meta.url), { type: "module" }),
});

// worker_hft.ts
import { registerHuggingFaceTransformersWorker } from "workglow/hf-transformers/runtime";
registerHuggingFaceTransformersWorker();
```

#### Using SQLite:

SQLite-backed queues are available via the storage APIs. Helper functions are forthcoming.

## Workflow

Every task in the library has a corresponding method in the Workflow. The workflow is a simple way to build a graph. It is not meant to be a full replacement for the creating a TaskGraph directly, but it is a good way to get started.

Tasks are the smallest unit of work, therefore they take simple inputs. GraphAsTask are compound tasks that contain a subgraph of tasks.

An example is TextEmbeddingTask and TextEmbeddingCompoundTask. The first takes a single model input, the second accepts an array of model inputs. Since models can have different providers, the Compound version creates a single task version for each model input. The workflow is smart enough to know that the Compound version is needed when an array is passed, and as such, you don't need to differentiate between the two:

```ts
import { Workflow } from "workglow";

const laMiniEmbeddingConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
    native_dimensions: 384,
  },
} as const;

const workflow = new Workflow();
workflow.textEmbedding({
  model: laMiniEmbeddingConfig,
  text: "The quick brown fox jumps over the lazy dog.",
});
await workflow.run();
```

OR

```ts
import { Workflow } from "workglow";

const laMiniEmbeddingConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
    native_dimensions: 384,
  },
} as const;

const workflow = new Workflow();
workflow.textEmbedding({
  model: [laMiniEmbeddingConfig, "Universal Sentence Encoder"],
  text: "The quick brown fox jumps over the lazy dog.",
});
await workflow.run();
```

The workflow will look at outputs of one task and automatically connect it to the input of the next task, if the output and input names and types match. If they don't, you can use the `rename` method to rename the output of the first task to match the input of the second task.

```ts
import { Workflow } from "workglow";

const laMiniEmbeddingConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
    native_dimensions: 384,
  },
} as const;

const workflow = new Workflow();
workflow
  .downloadModel({
    model: [laMiniEmbeddingConfig, "Universal Sentence Encoder"],
  })
  .textEmbedding({
    text: "The quick brown fox jumps over the lazy dog.",
  })
  .rename("*", "console")
  .debugLog();
await workflow.run();
```

The first task downloads the models (this is separated mostly for UI purposes so progress on the text embedding is separate from the progress of downloading the models). The second task will take the output of the first task and use it as input, in this case the names of the models. The workflow will automatically create that data flow. The `rename` method is used to rename the `vector` output of the embedding task to match the expected `console` input of the `DebugLog` task.

## JSON Configuration

There is a JSONTask that can be used to build a graph. This is useful for saving and loading graphs, or for creating a graph from a JSON file. The Web example also uses this to build a graph from the JSON in the text area.

```json
[
  {
    "id": "2",
    "type": "TextRewriterTask",
    "input": {
      "model": {
        "provider": "HF_TRANSFORMERS_ONNX",
        "provider_config": {
          "pipeline": "text2text-generation",
          "model_path": "Xenova/LaMini-Flan-T5-783M",
          "dtype": "q8"
        }
      },
      "text": "The quick brown fox jumps over the lazy dog.",
      "prompt": "Rewrite the following text in reverse:"
    },
    "dependencies": {
      "model": {
        "id": "1",
        "output": "model"
      }
    }
  },
  {
    "id": "3",
    "type": "TextTranslationTask",
    "input": {
      "model": {
        "provider": "HF_TRANSFORMERS_ONNX",
        "provider_config": {
          "pipeline": "translation",
          "model_path": "Xenova/m2m100_418M",
          "dtype": "q8"
        }
      },
      "source_lang": "en",
      "target_lang": "es"
    },
    "dependencies": {
      "text": {
        "id": "2",
        "output": "text"
      }
    }
  },
  {
    "id": "4",
    "type": "DebugLogTask",
    "config": {
      "log_level": "info"
    },
    "dependencies": {
      "console": [
        { "id": "2", "output": "text" },
        { "id": "3", "output": "text" }
      ]
    }
  }
]
```

The JSON above is a good example as it shows how to use a compound task with multiple inputs. Compound tasks export arrays, so use a compound task to consume the output of another compound task. The `dependencies` object is used to specify which output of which task is used as input for the current task. It is a shorthand for creating a data flow (an edge) in the graph.

```ts
import { JsonTask } from "workglow";
const json = require("./example.json");
const task = new JsonTask({ json });
await task.run();
```

# Going Deeper

## Tasks

To use a task, instantiate it with some input and call `run()`:

```ts
const laMiniEmbeddingConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
    native_dimensions: 384,
  },
} as const;

const task = new TextEmbeddingTask({
  model: laMiniEmbeddingConfig,
  text: "The quick brown fox jumps over the lazy dog.",
});
const result = await task.run();
console.log(result);
```

You will notice that the workflow automatically creates ids for you, so it assumes that the object parameter is the input object. Using a task directly, you need to specify input object directly as above.

## TaskGraph

The task graph is a collection of tasks (nodes) and data flows (edges). It is the heart of using the library.

Example:

```ts
const laMiniModelConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
} as const;

const graph = new TaskGraph();
graph.addTask(
  new TextRewriterCompoundTask({
    model: laMiniModelConfig,
    text: "The quick brown fox jumps over the lazy dog.",
    prompt: "Rewrite the following text in reverse:",
  })
);
```

## Dataflows

Dataflows are the edges in the graph. They connect the output of one task to the input of another. They are created by specifying the source and target tasks and the output and input ids.

Example, adding a data flow to the graph similar to above:

```ts
const laMiniModelConfig = {
  provider: "HF_TRANSFORMERS_ONNX",
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
} as const;

const graph = new TaskGraph();
graph.addTask(
  new TextRewriterCompoundTask(
    {
      model: laMiniModelConfig,
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: "Rewrite the following text in reverse:",
    },
    { id: "1" }
  )
);
graph.addTask(new DebugLogTask({}, { id: "2" }));
graph.addDataflow(
  new Dataflow({
    sourceTaskId: "1",
    sourceTaskPortId: "text",
    targetTaskId: "2",
    targetTaskPortId: "message",
  })
);
```

This links the output of the TextRewriterCompoundTask (id 1) to the input of the DebugLogTask (id 2). The output of the TextRewriterCompoundTask is the `text` field, and the input of the DebugLogTask is the `message` field.

# Appendix

## Source

### `docs/`

You are here.

### `packages/storage`

Simple KV storage with multiple backends.

### `packages/job-queue`

This is a simple job queue implementation with concurrency limiters and multiple backends.

### `packages/task-graph`

This is the main task handling library, with tasks, compound tasks, data flows, etc. It uses the job queue for long running tasks, and it has ways to cache results using the storage layer.

### `packages/ai`

These are the LLM tasks, models, etc. These tasks are agnostic to the provider and thus are like abstract versions. AI providers contribute the concrete implementations. Which implementation is used is determined by the model repository.

### `providers/*`

Each AI provider lives in its own package under `providers/`: `@workglow/anthropic`, `@workglow/openai`, `@workglow/google-gemini`, `@workglow/ollama`, `@workglow/huggingface-transformers`, `@workglow/huggingface-inference`, `@workglow/node-llama-cpp`, `@workglow/tf-mediapipe`, and `@workglow/chrome-ai`. Each ships an `./ai` and `./ai-runtime` subpath. Shared helpers (cloud client base classes, registration utilities, OpenAI-shape chat plumbing) live in `@workglow/ai/provider-utils`. Non-AI vendor packages (Playwright, Electron, SQLite, Postgres, Supabase, bun-webview) also live under `providers/`.

### `packages/util`

This is a collection of utility functions.

### `examples/cli`

An example project that uses the library in a CLI settings using listr2 (`cat example.json | workglow json`, for example)

![cli example](img/cli.png)

### `examples/web`

An example project that uses the library in a web setting, running locally in browser.

![web example](img/web.png)

Don't forget to open the console for some goodies.

### `builder`

[Local Drag and Drop Editor](https://workglow.dev)
![Node Editor](img/builder.png)
