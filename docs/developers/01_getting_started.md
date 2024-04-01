- [Developer Getting Started](#developer-getting-started)
- [Get Shit Done](#get-shit-done)
  - [Using TaskGraphBuilder \& a config helper](#using-taskgraphbuilder--a-config-helper)
  - [Using Task and TaskGraph directly (\& a config helper)](#using-task-and-taskgraph-directly--a-config-helper)
  - [Using Task and TaskGraph directly (no config helper)](#using-task-and-taskgraph-directly-no-config-helper)
  - [Preset Configs](#preset-configs)
    - [Registering Providers](#registering-providers)
    - [Registering Provider plus related Job Queue](#registering-provider-plus-related-job-queue)
      - [In memory:](#in-memory)
      - [Using Sqlite:](#using-sqlite)
  - [TaskGraphBuilder](#taskgraphbuilder)
  - [JSON Configuration](#json-configuration)
- [Going Deeper](#going-deeper)
  - [Tasks](#tasks)
  - [TaskGraph](#taskgraph)
  - [DataFlows](#dataflows)
  - [TaskGraphRunner](#taskgraphrunner)
- [Appendix](#appendix)
  - [Source](#source)
    - [`docs/`](#docs)
    - [`packages/core`](#packagescore)
    - [`packages/cli`](#packagescli)
    - [`packages/web`](#packagesweb)

# Developer Getting Started

This project is not yet ready to be published on npm. So for now, use the source Luke.

```bash
git clone https://github.com/sroussey/ellmers.git
cd ellmers
bun install
bun run build
cd packages/web
bun run dev
```

This will bring up a web page where you can edit some json to change the graph, and run it.

Also, you can open DevTools and edit that way (follow the instructions for enabling Console Formatters for best experience). A simple task graph builder is available there. Just type `builder` in the console and you can start building a graph. With the custom formatters, you can see the graph as you build it, as well as documentation. Everything self documents.

After this, plese read [Architecture](02_architecture.md) before attempting to [write your own Tasks](03_extending.md).

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

You can use as much or as little "magic" as you want. The config helpers are there to make it easier to get started, but eventually you will want to do it yourself.

## Preset Configs

### Registering Providers

Tasks are agnostic to the provider. Text embedding can me done with several providers, such as Huggingface / ONNX or MediaPipe locally, or OpenAI etc via API calls.

- **`registerHuggingfaceLocalTasks()`** - Registers the Huggingface Local provider. Now you can use a onnx model name for TextEmbedding, etc.
- **`registerMediaPipeTfJsLocalTasks()`** - Registers the MediaPipe TfJs Local provider. Now you can use one of the MediaPipe models.

### Registering Provider plus related Job Queue

LLM providers have long running functions. These are handled by a Job Queue. There are some pre-built ones:

#### In memory:

- **`registerHuggingfaceLocalTasksInMemory`** function sets up the Huggingface Local provider (above), and a InMemoryJobQueue with a Concurrency Limiter so the ONNX queue only runs one task/job at a time.
- **`registerMediaPipeTfJsLocalInMemory`** does the same for MediaPipe.

#### Using Sqlite:

- **`registerHuggingfaceLocalTasksSqlite`** function sets up the Huggingface Local provider, and a SqliteJobQueue with a Concurrency Limiter
- **`registerMediaPipeTfJsLocalSqlite`** does the same for MediaPipe.

## TaskGraphBuilder

Every task in the library has a corresponding method in the TaskGraphBuilder. The builder is a simple way to build a graph. It is not meant to be a full replacement for the creating a TaskGraph directly, but it is a good way to get started.

Tasks are the smallest unit of work, therefore they take simple inputs. Most Tasks has a corresponding CompoundTask version that takes arrays for some inputs. These are the ones that the task builder uses.

An example is TextEmbeddingTask and TextEmbeddingCompoundTask. The first takes a single model input, the second accepts an array of model inputs. Since models can have different providers, the Compound version creates a single task version for each model input. The builder is smart enough to know that the Compound version is needed when an array is passed, and as such, you don't need to differentiate between the two:

```ts
import { TaskGraphBuilder } from "ellmers-core/server";
const builder = new TaskGraphBuilder();
builder.TextEmbedding({
  model: "Xenova/LaMini-Flan-T5-783M",
  text: "The quick brown fox jumps over the lazy dog.",
});
await builder.run();
```

OR

```ts
import { TaskGraphBuilder } from "ellmers-core/server";
const builder = new TaskGraphBuilder();
builder.TextEmbedding({
  model: ["Xenova/LaMini-Flan-T5-783M", "Universal Sentence Encoder"],
  text: "The quick brown fox jumps over the lazy dog.",
});
await builder.run();
```

The builder will look at outputs of one task and automatically connect it to the input of the next task, if the output and input names and types match. If they don't, you can use the `rename` method to rename the output of the first task to match the input of the second task.

```ts
import { TaskGraphBuilder } from "ellmers-core/server";
const builder = new TaskGraphBuilder();
builder
  .DownloadModel({
    model: ["Xenova/LaMini-Flan-T5-783M", "Universal Sentence Encoder"],
  })
  .TextEmbedding({
    text: "The quick brown fox jumps over the lazy dog.",
  });
  .rename("vector", "message")
  .DebugLog();
await builder.run();
```

The first task downloads the models (this is separated mostly for ui purposes so progress on the text embedding is separate from the progress of downloading the models). The second task will take the output of the first task and use it as input, in this case the names of the models. The builder will automatically create that data flow. The `rename` method is used to rename the `vector` output of the embedding task to match the expected `message` input of the second task.

## JSON Configuration

There is a JSONTask that can be used to build a graph. This is useful for saving and loading graphs, or for creating a graph from a JSON file. The Web example also uses this to build a graph from the JSON in the text area.

```json
[
  {
    "id": "1",
    "type": "DownloadModelCompoundTask",
    "input": {
      "model": ["Xenova/LaMini-Flan-T5-783M", "Xenova/m2m100_418M"]
    }
  },
  {
    "id": "2",
    "type": "TextRewriterCompoundTask",
    "input": {
      "text": "The quick brown fox jumps over the lazy dog.",
      "prompt": ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"]
    },
    "dependencies": {
      "model": {
        "id": "1",
        "output": "text_generation_model"
      }
    }
  },
  {
    "id": "3",
    "type": "TextTranslationCompoundTask",
    "input": {
      "model": "Xenova/m2m100_418M",
      "source": "en",
      "target": "es"
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
    "input": {
      "level": "info"
    },
    "dependencies": {
      "message": [
        {
          "id": "2",
          "output": "text"
        },
        {
          "id": "3",
          "output": "text"
        }
      ]
    }
  }
]
```

The JSON above is a good example as it shows how to use a compound task with multiple inputs. Compound tasks export arrays, so use a compound task to consume the output of another compound task. The `dependencies` object is used to specify which output of which task is used as input for the current task. It is a shorthand for creating a data flow (an edge) in the graph.

```ts
import { JSONTask } from "ellmers-core/server";
const json = require("./example.json");
const task = new JSONTask({ input: { json } });
await task.run();
```

# Going Deeper

## Tasks

To use a task, instantiate it with some input and call `run()`:

```ts
const task = new TextEmbeddingTask({
  id: "1",
  input: {
    model: "Xenova/LaMini-Flan-T5-783M",
    text: "The quick brown fox jumps over the lazy dog.",
  },
});
const result = await task.run();
console.log(result);
```

You will notice that the builder automatically creates ids for you, so it assumes that the object parameter is the input object. Using a task directly, you need to specify input object directly as above.

## TaskGraph

The task graph is a collection of tasks (nodes) and data flows (edges). It is the heart of using the library.

Example:

```ts
const graph = new TaskGraph();
graph.addTask(
  new TextRewriterCompoundTask({
    input: {
      model: "Xenova/LaMini-Flan-T5-783M",
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
    },
  })
);
```

## DataFlows

DataFlows are the edges in the graph. They connect the output of one task to the input of another. They are created by specifying the source and target tasks and the output and input ids.

Example, adding a data flow to the graph similar to above:

```ts
const graph = new TaskGraph();
graph.addTask(
  new TextRewriterCompoundTask({
    id: "1",
    input: {
      model: "Xenova/LaMini-Flan-T5-783M",
      text: "The quick brown fox jumps over the lazy dog.",
      prompt: ["Rewrite the following text in reverse:", "Rewrite this to sound like a pirate:"],
    },
  })
);
graph.addTask(
  new DebugLogTask({
    id: "2",
  })
);
graph.addDataFlow(
  new DataFlow({
    sourceTaskId: "1",
    sourceTaskOutputId: "text",
    targetTaskId: "2",
    targetTaskInputId: "message",
  })
);
```

This links the output of the TextRewriterCompoundTask (id 1) to the input of the DebugLogTask (id 2). The output of the TextRewriterCompoundTask is the `text` field, and the input of the DebugLogTask is the `message` field.

## TaskGraphRunner

The TaskGraphRunner is used to run the graph. It understands that some tasks depend on others, and will run them in the correct order. It also handles compound tasks which have sub graphs.

```ts
const runner = new TaskGraphRunner(graph);
runner.run();
```

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
