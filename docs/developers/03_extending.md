# Extending the System

This document covers how to write your own tasks. For a more practical guide to getting started, see the [Developer Getting Started](./01_getting_started.md) guide. Reviewing the [Architecture](02_architecture.md) is required reading before attempting to write your own Tasks.

- [Write a new Task](#write-a-new-task)
  - [Tasks must have a `run()` method](#tasks-must-have-a-run-method)
  - [Define Inputs and Outputs](#define-inputs-and-outputs)
  - [Register the Task](#register-the-task)
- [Schema Format Annotations](#schema-format-annotations)
  - [Built-in Format Annotations](#built-in-format-annotations)
  - [Example: Using Format Annotations](#example-using-format-annotations)
  - [Creating Custom Format Resolvers](#creating-custom-format-resolvers)
- [Job Queues and LLM tasks](#job-queues-and-llm-tasks)
- [Write a new Compound Task](#write-a-new-compound-task)
- [Preview Task UIs](#preview-task-uis)
- [AI and RAG Tasks](#ai-and-rag-tasks)
  - [Document Processing Tasks](#document-processing-tasks)
  - [Vector and Embedding Tasks](#vector-and-embedding-tasks)
  - [Retrieval and Generation Tasks](#retrieval-and-generation-tasks)
  - [Chainable RAG Pipeline Example](#chainable-rag-pipeline-example)
  - [Retrieval Pipeline Example](#retrieval-pipeline-example)
  - [Hierarchical Document Structure](#hierarchical-document-structure)
  - [Task Data Flow](#task-data-flow)

## Write a new Task

To write a new Task, you need to create a new class that extends the `Task` class.

### Tasks must have a `run()` method

Here we will write an example of a simple Task that prints a message to the console. Below is the starting code for the Task:

```ts
export class SimpleDebugLogTask extends Task {
  execute() {
    console.dir(<something>, { depth: null });
  }
}
```

We ran too far ahead to the main `run()` method. We need to define the inputs and outputs for the Task first.

### Define Inputs and Outputs

The first thing we need to do is define the inputs and outputs for the Task. This is done by defining the `inputSchema` and `outputSchema` static methods on the class using json schemas. Common types include `boolean`, `number`, `string` (text), etc.

Here is the code for the `SimpleDebugLogTask` with the inputs defined:

```ts
export class SimpleDebugLogTask extends Task<{ message: any }> {
  public static inputSchema = () => {
    return {
      type: "object",
      properties: {
        message: {},
      },
      required: ["message"],
    };
  };
  execute() {
    console.dir(this.runInputData.message, { depth: null });
  }
}

new SimpleDebugLogTask({ message: "hello world" }).run();
```

Since the code itself can't read the TypeScript types, we declare the runtime schemas in `inputSchema` and `outputSchema`. We still create a type `SimpleDebugLogTaskInputs` to help us since we are writing TypeScript code.

`defaults` and `runInputData` need some explanation. When we instantiate a Task, we pass in an object of input defaults which gets saved in `defaults` (and copied to `runInputData`). In the above example, that is all that happens. However, when in a graph, the outputs of other tasks can be passed in as inputs (these are called dataflows). Dataflows can add to, or override, data from the `defaults` object. The `runInputData` object is the final object that the Task will use when calling `run()`.

Since `defaults` can be 100% of the input data or 0%, we use a TypeScript Partial. Between defaults and data coming from the graph via dataflows, `runInputData` will always have all the data. If not, it is a fatal error.

It is common practice to have an output, and in a case like this, we can add an output that is the same as the input.

Below we write the schemas first so we can use `FromSchema` to make types and not need to define the input and output multiple times (you could use Typebox or Zod4 for this as well).

```ts
import {DataPortSchemaObject} from "workglow";
const SimpleDebugLogTaskInputSchema = {
  type: "object",
  properties: {
    message: {
      title: "Message",
      description: "The message to log",
    },
  },
  required: ["message"],
} as const satisfies DataPortSchemaObject;
type SimpleDebugLogTaskInputs = FromSchema<SimpleDebugLogTaskInputSchema>;

const SimpleDebugLogTaskOutputSchema = {
  type: "object";
  properties: {
    message: {
      title: "Message";
      description: "The message to log";
    };
  };
  required: ["message"];
} as const satisfies DataPortSchemaObject;
type SimpleDebugLogTaskOutputs = FromSchema<SimpleDebugLogTaskOutputSchema>;

export class SimpleDebugLogTask extends Task<SimpleDebugLogTaskInputs, SimpleDebugLogTaskOutputs> {
  public static cachePolicy: CachePolicy = { kind: "none" };
  public static inputSchema = () => SimpleDebugLogTaskInputSchema;
  public static outputSchema = () => SimpleDebugLogTaskOutputSchema;
  execute() {
    console.dir(this.runInputData.message, { depth: null });
    this.runOutputData.output = this.runInputData.message;
    return this.runOutputData;
  }
}

new SimpleDebugLogTask({ message: "hello world" }).run();
```

In the above code, we added an output to the Task. We also set `cachePolicy` to `{ kind: "none" }` to tell the system that this Task has side effects and should always run the execute method. This is important for the system to know if it can cache the output of the Task or not.

### Register the Task

To register the Task, you need to add it to the `TaskRegistry` class. The `TaskRegistry` class is a singleton that holds all the registered Tasks and has a `registerTask` method that takes a Task class as an argument.

```ts
TaskRegistry.registerTask(SimpleDebugLogTask);
```

To use the Task in Workflow, there are a few steps:

```ts
export const simpleDebug = (input: DebugLogTaskInput) => {
  return new SimpleDebugTask({} as DebugLogTaskInput, {}).run(input);
};

declare module "workglow" {
  interface Workflow {
    simpleDebug: CreateWorkflow<DebugLogTaskInput, DebugLogTaskOutput, TaskConfig>;
  }
}

Workflow.prototype.simpleDebug = CreateWorkflow(SimpleDebugTask);
```

## Schema Format Annotations

When defining task input schemas, you can use `format` annotations to enable automatic resolution of string identifiers to object instances. The TaskRunner inspects input schemas and resolves annotated string values before task execution.

### Built-in Format Annotations

The system supports several format annotations out of the box:

| Format            | Description                         | Helper Function        |
| ----------------- | ----------------------------------- | ---------------------- |
| `model`           | Any AI model configuration          | `TypeModel()`          |
| `model:TaskName`  | Model compatible with specific task | —                      |
| `storage:tabular` | Tabular data storage                | `TypeTabularStorage()` |
| `knowledge-base`  | Knowledge base instance             | `TypeKnowledgeBase()`  |
| `credential`      | Credential from credential store    | —                      |
| `tasks`           | Task class from task registry       | —                      |

### Example: Using Format Annotations

```typescript
import { Task, type DataPortSchema } from "workglow";
import { TypeTabularStorage } from "workglow";
import { FromSchema } from "workglow";

const MyTaskInputSchema = {
  type: "object",
  properties: {
    // Model input - accepts string ID or ModelConfig object
    model: {
      title: "AI Model",
      description: "Model for text generation",
      format: "model:TextGenerationTask",
      oneOf: [
        { type: "string", title: "Model ID" },
        { type: "object", title: "Model Config" },
      ],
    },
    // Repository input - uses helper function
    dataSource: TypeTabularStorage({
      title: "Data Source",
      description: "Repository containing source data",
    }),
    // Regular string input (no resolution)
    prompt: { type: "string", title: "Prompt" },
  },
  required: ["model", "dataSource", "prompt"],
} as const satisfies DataPortSchema;

type MyTaskInput = FromSchema<typeof MyTaskInputSchema>;

export class MyTask extends Task<MyTaskInput> {
  static readonly type = "MyTask";
  static inputSchema = () => MyTaskInputSchema;

  async executePreview(
    input: MyTaskInput,
    ctx: IExecutePreviewContext
  ): Promise<MyTaskOutput | undefined> {
    // By the time executePreview runs, model is a ModelConfig object
    // and dataSource is an ITabularStorage instance
    const { model, dataSource, prompt } = input;
    // ...
  }
}
```

### Creating Custom Format Resolvers

You can extend the resolution system by registering custom resolvers:

```typescript
import { registerInputResolver } from "workglow";

// Register a resolver for "template:*" formats
registerInputResolver("template", async (id, format, registry) => {
  const templateRepo = registry.get(TEMPLATE_REPOSITORY);
  const template = await templateRepo.findById(id);
  if (!template) {
    throw new Error(`Template "${id}" not found`);
  }
  return template;
});
```

Then use it in your schemas:

```typescript
const inputSchema = {
  type: "object",
  properties: {
    emailTemplate: {
      type: "string",
      format: "template:email",
      title: "Email Template",
    },
  },
};
```

When a task runs with `{ emailTemplate: "welcome-email" }`, the resolver automatically converts it to the template object before execution.

## Execution Strategies and AI tasks

AI tasks delegate execution to an `IAiExecutionStrategy` resolved per-model at runtime. Two built-in strategies exist:

- **`DirectExecutionStrategy`** — runs the job inline (API providers like OpenAI, Anthropic, or local WASM runtimes).
- **`QueuedExecutionStrategy`** — submits the job to a job queue with concurrency control (GPU-bound providers like HuggingFace Transformers with WebGPU, LlamaCpp).

Providers register a strategy resolver in the `AiProviderRegistry` during registration. `AiTask` extends `Task` directly and calls `strategy.execute()` / `strategy.executeStream()` in its `execute()` method.

Subclasses of `AiTask` are organized around a specific task. Which model is used will determine the execution strategy, and is required. This abstract class will look up the model and determine the strategy to use based on `AiProviderRegistry`.

To add a new embedding source, for example, you would not create a new task, but a new job queue for the new provider and then register how to run the embedding service in the `AiProviderRegistry` for the specific task, in this case `TextEmbeddingTask`. Then you use the existing `TextEmbeddingTask` with your new model name. This allows swapping out the model without changing the task, running multiple models in parallel, and so on.

## Write a new Compound Task

You can organize a group of tasks to look like one task (think of a grouping UI in an Illustrator type program). The task will build the subgraph based on the input data, and will emit a `'regenerate'` event after the subgraph has been rebuilt. This is useful for tasks that have a variable number of subtasks. An example would be the `TextEmbeddingCompoundTask` which takes a list of strings and returns a list of embeddings. Or it can take a list of models and return a list of embeddings for each model.

Compound Tasks are not cached (though any or all of their children may be).

## Preview Task UIs

Tasks can also be made previewable. Preview mode is for UI editors — when the user edits a task input, the editor calls `runPreview()` to propagate a low-fidelity result through the graph without running the expensive `execute()` work. This is useful for a UI node editor: change a color in one task and it is propagated downstream without incurring costs for re-running the entire graph, like a spreadsheet where changing a cell triggers recalculation of dependent cells.

Tasks implement preview by overriding `executePreview()`, which is called only by `runPreview()` and never by `run()`. The two paths are strictly orthogonal: `run()` produces the committed result via `execute()` (or `executeStream()`), and `runPreview()` produces a preview via `executePreview()`. Most tasks share a pure helper between the two, so preview behavior matches execute when both are cheap.

## AI and RAG Tasks

The `workglow` package provides a comprehensive set of tasks for building RAG (Retrieval-Augmented Generation) pipelines. These tasks are designed to chain together in workflows without requiring external loops.

### Document Processing Tasks

| Task                      | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `StructuralParserTask`    | Parses markdown/text into hierarchical document trees |
| `TextChunkerTask`         | Splits text into chunks with configurable strategies  |
| `HierarchicalChunkerTask` | Token-aware chunking that respects document structure |
| `TopicSegmenterTask`      | Segments text by topic using heuristics or embeddings |
| `DocumentEnricherTask`    | Adds summaries and entities to document nodes         |

### Vector and Embedding Tasks

| Task                    | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `TextEmbeddingTask`     | Generates embeddings using configurable models              |
| `ChunkVectorUpsertTask` | Stores chunks + embeddings in a KnowledgeBase (1:1 aligned) |
| `VectorQuantizeTask`    | Quantizes vectors for storage efficiency                    |

### Retrieval and Generation Tasks

| Task                     | Description                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `ChunkRetrievalTask`     | End-to-end retrieval: embeds query, runs similarity or hybrid search |
| `QueryExpanderTask`      | Rule-based query expansion (multi-query / synonyms)                  |
| `RerankerTask`           | Reranks results (simple heuristic or reciprocal-rank-fusion)         |
| `HierarchyJoinTask`      | Enriches retrieval metadata with parent context                      |
| `ContextBuilderTask`     | Builds formatted context for LLM prompts                             |
| `TextQuestionAnswerTask` | Generates answers from context                                       |
| `TextGenerationTask`     | General text generation                                              |

### Chainable RAG Pipeline Example

Tasks chain together through compatible input/output schemas:

```typescript
import { Workflow } from "workglow";
import { createKnowledgeBase } from "workglow";

// Create a KnowledgeBase (auto-registers globally as "my-kb")
const kb = await createKnowledgeBase({
  name: "my-kb",
  vectorDimensions: 384,
});

// Document ingestion pipeline
await new Workflow()
  .structuralParser({
    text: markdownContent,
    title: "My Document",
    format: "markdown",
  })
  .documentEnricher({
    generateSummaries: true,
    extractEntities: true,
  })
  .hierarchicalChunker({
    maxTokens: 512,
    overlap: 50,
    strategy: "hierarchical",
  })
  .textEmbedding({
    model: "Xenova/all-MiniLM-L6-v2",
  })
  .chunkVectorUpsert({
    knowledgeBase: "my-kb",
  })
  .run();
```

### Retrieval Pipeline Example

```typescript
const answer = await new Workflow()
  .chunkRetrieval({
    knowledgeBase: "my-kb",
    query,
    model: "Xenova/all-MiniLM-L6-v2",
    topK: 10,
  })
  .reranker({
    query,
    topK: 5,
  })
  .contextBuilder({
    format: "markdown",
    maxLength: 2000,
  })
  .textQuestionAnswer({
    question: query,
    model: "Xenova/LaMini-Flan-T5-783M",
  })
  .run();
```

### Hierarchical Document Structure

Documents are represented as trees with typed nodes:

```typescript
type DocumentNode =
  | DocumentRootNode // Root of document
  | SectionNode // Headers, structural sections
  | ParagraphNode // Text blocks
  | SentenceNode // Fine-grained (optional)
  | TopicNode; // Detected topic segments

// Each node contains:
interface BaseNode {
  nodeId: string; // Deterministic content-based ID
  range: { start: number; end: number };
  text: string;
  enrichment?: {
    summary?: string;
    entities?: Entity[];
    keywords?: string[];
  };
}
```

### Task Data Flow

Each task passes through what the next task needs:

| Task                  | Passes Through           | Adds                                       |
| --------------------- | ------------------------ | ------------------------------------------ |
| `structuralParser`    | -                        | `doc_id`, `documentTree`, `nodeCount`      |
| `documentEnricher`    | `doc_id`, `documentTree` | `summaryCount`, `entityCount`              |
| `hierarchicalChunker` | `doc_id`                 | `chunks: ChunkRecord[]`, `text[]`, `count` |
| `textEmbedding`       | (implicit)               | `vector[]`                                 |
| `chunkVectorUpsert`   | -                        | `count`, `doc_id`, `chunk_ids`             |

This design eliminates the need for external loops - the entire pipeline chains together naturally.
