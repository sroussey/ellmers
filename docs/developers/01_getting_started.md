- [Developer Getting Started](#developer-getting-started)
- [Get Shit Done](#get-shit-done)
  - [Using TaskGraphBuilder \& a config helper](#using-taskgraphbuilder--a-config-helper)
  - [Using Task and TaskGraph directly (\& a config helper)](#using-task-and-taskgraph-directly--a-config-helper)
  - [Using Task and TaskGraph directly (no config helper)](#using-task-and-taskgraph-directly-no-config-helper)
  - [Preset Configs](#preset-configs)
    - [Registering Providers](#registering-providers)
    - [Registering Provider plus related Job Queue](#registering-provider-plus-related-job-queue)
  - [TaskGraphBuilder](#taskgraphbuilder)
  - [JSON Configuration](#json-configuration)
- [Going Deeper](#going-deeper)
  - [Tasks](#tasks)
  - [DataFlows](#dataflows)
- [Configuration Options](#configuration-options)
  - [Queues](#queues)
  - [LLM Providers](#llm-providers)
  - [Storage](#storage)
    - [Caching](#caching)
- [Appendix](#appendix)
  - [Source](#source)
    - [`docs/`](#docs)
    - [`packages/core`](#packagescore)
    - [`packages/cli`](#packagescli)
    - [`packages/web`](#packagesweb)

# Developer Getting Started

This project is not yet ready to be published on npm. So for now, use the source Luke.

git clone https://github.com/sroussey/ellmers.git
cd ellmers
bun install
bun run build
cd packages/web
bun run dev

This will bring up a web page where you can edit some json to change the graph. And there is a RUN button.

Also, you can open the panel (follow the instructions for enabling Console Formatters for best experience). A simple task graph builder is available there. Just type `builder` in the console and you can start building a graph. With the custom formatters, you can see the graph as you build it, as well as documentation. Everything self documents.

# Get Shit Done

## Using TaskGraphBuilder & a config helper

```ts
import { TaskGraphBuilder, registerHuggingfaceLocalTasksInMemory } from "ellmers-core/server";
// config and start up
registerHuggingfaceLocalTasksInMemory();

const builder = new TaskGraphBuilder();
builder
  .DownloadModel({ model: "Xenova/LaMini-Flan-T5-783M" })
  .TextRewriter({
    text: "The quick brown fox jumps over the lazy dog.",
    prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
  })
  .rename("text", "message")
  .DebugLog();
builder.run();
```

## Using Task and TaskGraph directly (& a config helper)

This is equivalent to creating the graph directly:

```ts
import {
  DownloadModelTask,
  TextRewriterCompoundTask,
  DebugLog,
  DataFlow,
  TaskGraph,
  TaskGraphRunner,
  registerHuggingfaceLocalTasksInMemory,
} from "ellmers-core/server";

// config and start up
registerHuggingfaceLocalTasksInMemory();

// build and run graph
const graph = new TaskGraph();
graph.addTask(new DownloadModel({ id: "1", input: { model: "Xenova/LaMini-Flan-T5-783M" } }));
graph.addTask(
  new TextRewriterCompoundTask({
    id: "2",
    input: {
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
    },
  })
);
graph.addTask(new DebugLog({ id: "3" }));
graph.addDataFlow(
  new DataFlow({
    sourceTaskId: "1",
    sourceTaskOutputId: "model",
    targetTaskId: "2",
    targetTaskInputId: "model",
  })
);
graph.addDataFlow(
  new DataFlow({
    sourceTaskId: "2",
    sourceTaskOutputId: "text",
    targetTaskId: "3",
    targetTaskInputId: "message",
  })
);

const runner = new TaskGraphRunner(graph);
runner.run();
```

## Using Task and TaskGraph directly (no config helper)

And unrolling the config helpers, we get the following equivalent code:

```ts
import {
  DownloadModelTask,
  TextRewriterCompoundTask,
  DebugLog,
  DataFlow,
  TaskGraph,
  TaskGraphRunner,
  getProviderRegistry,
  HuggingFaceLocal_DownloadRun,
  HuggingFaceLocal_TextRewriterRun,
  InMemoryJobQueue,
  ModelProcessorEnum,
  ConcurrencyLimiter,
  TaskInput,
  TaskOutput,
} from "ellmers-core/server";

// config and start up
const ProviderRegistry = getProviderRegistry();
export const flanT5p786m = new ONNXTransformerJsModel( // auto registers on creation
  "Xenova/LaMini-Flan-T5-783M",
  [ModelUseCaseEnum.TEXT_GENERATION, ModelUseCaseEnum.TEXT_REWRITING],
  "text2text-generation"
);
ProviderRegistry.registerRunFn(
  DownloadModelTask.type,
  ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
  HuggingFaceLocal_DownloadRun
);
ProviderRegistry.registerRunFn(
  TextRewriterTask.type,
  ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS,
  HuggingFaceLocal_TextRewriterRun
);
const jobQueue = new InMemoryJobQueue<TaskInput, TaskOutput>(
  "local_hf",
  new ConcurrencyLimiter(1, 10),
  10
);
ProviderRegistry.registerQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS, jobQueue);
jobQueue.start();

// build and run graph
const graph = new TaskGraph();
graph.addTask(new DownloadModel({ id: "1", input: { model: "Xenova/LaMini-Flan-T5-783M" } }));
graph.addTask(
  new TextRewriterCompoundTask({
    id: "2",
    input: {
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
    },
  })
);
graph.addTask(new DebugLog({ id: "3" }));
graph.addDataFlow(
  new DataFlow({
    sourceTaskId: "1",
    sourceTaskOutputId: "model",
    targetTaskId: "2",
    targetTaskInputId: "model",
  })
);
graph.addDataFlow(
  new DataFlow({
    sourceTaskId: "2",
    sourceTaskOutputId: "text",
    targetTaskId: "3",
    targetTaskInputId: "message",
  })
);

const runner = new TaskGraphRunner(graph);
runner.run();
```

## Preset Configs

### Registering Providers

Tasks are agnostic to the provider. Text embedding can me done with several providers, such as Huggingface / ONNX or MediaPipe locally, or OpenAI etc via API calls.

- **`registerHuggingfaceLocalTasks()`** - Registers the Huggingface Local provider. Now you can use a onnx model name for TextEmbedding, etc.
- **`registerMediaPipeTfJsLocalTasks()`** - Registers the MediaPipe TfJs Local provider. Now you can use one of the MediaPipe models.

### Registering Provider plus related Job Queue

In memory:

- **`registerHuggingfaceLocalTasksInMemory`** function sets up the Huggingface Local provider (above), and a InMemoryJobQueue with a Concurrency Limiter so the ONNX queue only runs one task/job at a time.
- **`registerMediaPipeTfJsLocalInMemory`** does the same for MediaPipe.

Using Sqlite:

- **`registerHuggingfaceLocalTasksSqlite`** function sets up the Huggingface Local provider, and a SqliteJobQueue with a Concurrency Limiter
- **`registerMediaPipeTfJsLocalSqlite`** does the same for MediaPipe.

## TaskGraphBuilder

## JSON Configuration

# Going Deeper

## Tasks

## DataFlows

# Configuration Options

## Queues

## LLM Providers

## Storage

### Caching

# Appendix

## Source

### `docs/`

You are here.

### `packages/core`

This is the main library code.

### `packages/cli`

An example project that uses the library in a CLI settings using listr2 (`cat example.json | ellmers json`, for example)

![cli example](img/cli.png)

### `packages/web`

An example project that uses the library in a web setting, running locally in browser.

![web example](img/web.png)

Don't forget to open the console for some goodies.
