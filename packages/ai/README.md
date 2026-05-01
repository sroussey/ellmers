# @workglow/ai

Core AI abstractions and functionality for Workglow AI task pipelines.

## Overview

The `@workglow/ai` package provides the core AI abstractions, job definitions, and task implementations that form the foundation of Workglow's AI task execution system. It defines the interfaces and base classes that AI providers implement, along with a comprehensive set of AI tasks ready for use.

## Features

- **Built-in AI Tasks**: Pre-implemented tasks for common AI operations
- **Provider Interface**: Standard interface for AI service providers
- **Model Management**: Complete system for managing AI models and their associations with tasks, and can persist with multiple storage backends
- **Multi-Platform Support**: Works in browser, Node.js, and Bun environments
- **Type Safety**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
bun add @workglow/ai
```

## Quick Start

Here's a complete example of setting up and using the AI package with the Hugging Face Transformers ONNX provider from `@workglow/ai-provider`:

```typescript
import {
  TextGenerationTask,
  TextEmbeddingTask,
  getGlobalModelRepository,
  setGlobalModelRepository,
  InMemoryModelRepository,
  AiJob,
  AiJobInput,
} from "@workglow/ai";
import { Workflow, getTaskQueueRegistry, TaskInput, TaskOutput } from "@workglow/task-graph";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";
import { registerHuggingFaceTransformersInline } from "@workglow/ai-provider/hf-transformers/runtime";

// 1. Set up a model repository
const modelRepo = new InMemoryModelRepository();
setGlobalModelRepository(modelRepo);

// 2. Add a local ONNX model (Hugging Face Transformers)

await modelRepo.addModel({
  model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
  tasks: ["TextGenerationTask", "TextRewriterTask"],
  title: "LaMini-Flan-T5-783M",
  description: "LaMini-Flan-T5-783M quantized to 8bit",
  metadata: {},
});

// 3. Register provider (inline: full ONNX stack in this bundle; creates queue automatically)
await registerHuggingFaceTransformersInline();

// 4. Or manually set up job queue (when queue.autoCreate: false)
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

// 6. Create and run a workflow
const workflow = new Workflow();

const result = await workflow
  .TextGenerationTask({
    model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
    prompt: "Write a short story about a robot learning to paint.",
    maxTokens: 200,
    temperature: 0.8,
  })
  .run();

console.log(result.text);
```

## Available AI Tasks

### Text Processing Tasks

#### TextGenerationTask

Generates text based on prompts using language models.

```typescript
import { TextGenerationTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const gpt2ModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "Xenova/gpt2",
    dtype: "q8",
  },
} as const;

const task = new TextGenerationTask({
  model: gpt2ModelConfig,
  prompt: "Explain quantum computing in simple terms",
});

const result = await task.run();
// Output: { text: "Quantum computing is..." }
```

#### TextEmbeddingTask

Generates vector embeddings for text using embedding models.

```typescript
import { TextEmbeddingTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const embeddingModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
    native_dimensions: 384,
  },
} as const;

const task = new TextEmbeddingTask({
  model: embeddingModelConfig,
  text: "This is a sample text for embedding",
});

const result = await task.run();
// Output: { vector: [0.1, -0.2, 0.3, ...] }
```

#### TextTranslationTask

Translates text between different languages.

```typescript
import { TextTranslationTask } from "@workglow/ai";

const task = new TextTranslationTask({
  model: "translation-model",
  text: "Hello, how are you?",
  source_lang: "en",
  target_lang: "es",
});

const result = await task.run();
// Output: { translatedText: "Hola, ¿cómo estás?" }
```

#### TextSummaryTask

Generates summaries of longer text content.

```typescript
import { TextSummaryTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const summarizationModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "summarization",
    model_path: "Falconsai/text_summarization",
    dtype: "fp32",
  },
} as const;

const task = new TextSummaryTask({
  model: summarizationModelConfig,
  text: "Long article content here...",
  maxLength: 100,
});

const result = await task.run();
// Output: { summary: "Brief summary of the article..." }
```

#### TextRewriterTask

Rewrites text in different styles or tones.

```typescript
import { TextRewriterTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const laMiniModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
} as const;

const task = new TextRewriterTask({
  model: laMiniModelConfig,
  text: "This is a formal business proposal.",
  style: "casual",
});

const result = await task.run();
// Output: { rewrittenText: "This is a casual business idea..." }
```

#### TextQuestionAnswerTask

Answers questions based on provided context.

```typescript
import { TextQuestionAnswerTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const squadModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "question-answering",
    model_path: "Xenova/distilbert-base-uncased-distilled-squad",
    dtype: "q8",
  },
} as const;

const task = new TextQuestionAnswerTask({
  model: squadModelConfig,
  context: "The capital of France is Paris. It has a population of about 2.1 million.",
  question: "What is the population of Paris?",
});

const result = await task.run();
// Output: { answer: "About 2.1 million" }
```

## Image Generation

Two AI tasks produce an `ImageValue` from a text prompt:

- **`ImageGenerateTask`** — text-to-image.
- **`ImageEditTask`** — prompt-guided edit of an input image, with optional mask (inpaint) and optional `additionalImages` (multi-image compositing).

Both extend a shared `AiImageOutputTask` base (which extends `StreamingAiTask`) and follow the standard streaming convention: providers yield `snapshot` events as the image refines (each event carries a complete partial that replaces the prior one — providers do **not** accumulate), then a `finish` event with empty data. The base class stores the latest partial in `_latestPartial` via plain assignment (lifetime is JS GC; there is no refcount system) and exposes it through `executePreview()`, so downstream image tasks (`ImageGrayscaleTask`, `ImageResizeTask`, etc.) refresh live as the image refines. `cacheable` is seed-aware: without a seed, generation is non-deterministic, so the task is treated as not cacheable.

V1 supports OpenAI (`gpt-image-2`, `dall-e-3`), Google Gemini (`imagen-4`, `gemini-2.5-flash-image`), and HuggingFace Inference (Flux, FLUX.1-Kontext-dev for inpaint). Per-provider validators reject unsupported combinations (Gemini + mask, HF + multiple images) before any worker dispatch, surfacing as a `ProviderUnsupportedFeatureError` in the graph editor.

### Analysis Tasks

#### VectorSimilarityTask

Computes similarity between texts or embeddings.

```typescript
import { VectorSimilarityTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const gteSmallConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Supabase/gte-small",
    dtype: "q8",
    native_dimensions: 384,
  },
} as const;

const task = new VectorSimilarityTask({
  model: gteSmallConfig,
  text1: "I love programming",
  text2: "Coding is my passion",
});

const result = await task.run();
// Output: { similarity: 0.85 }
```

### Model Management Tasks

#### DownloadModelTask

Downloads and prepares AI models for use.

```typescript
import { DownloadModelTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const task = new DownloadModelTask({
  model: {
    provider: HF_TRANSFORMERS_ONNX,
    provider_config: {
      pipeline: "text2text-generation",
      model_path: "Xenova/LaMini-Flan-T5-783M",
      dtype: "q8",
    },
  },
});

const result = await task.run();
// Output includes resolved model config after download
```

## Model Management

### Setting Up Models

Models are managed through the `ModelRepository` system. You can use different storage backends:

#### In-Memory Repository (Development)

```typescript
import { InMemoryModelRepository, setGlobalModelRepository } from "@workglow/ai";

const modelRepo = new InMemoryModelRepository();
setGlobalModelRepository(modelRepo);
```

#### IndexedDB Repository (Browser)

```typescript
import { IndexedDbModelRepository, setGlobalModelRepository } from "@workglow/ai";

const modelRepo = new IndexedDbModelRepository("models", "task2models");
setGlobalModelRepository(modelRepo);
```

#### SQLite Repository (Server)

```typescript
import { SqliteModelRepository, setGlobalModelRepository } from "@workglow/ai";
import { Sqlite } from "@workglow/storage/sqlite";

await Sqlite.init();
const modelRepo = new SqliteModelRepository("./models.db");
setGlobalModelRepository(modelRepo);
```

#### PostgreSQL Repository (Production)

```typescript
import { PostgresModelRepository, setGlobalModelRepository } from "@workglow/ai";
import { Pool } from "pg";

const pool = new Pool({
  user: "username",
  host: "localhost",
  database: "mydb",
  password: "password",
  port: 5432,
});

const modelRepo = new PostgresModelRepository(pool);
setGlobalModelRepository(modelRepo);
```

### Adding Models

```typescript
import { getGlobalModelRepository } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const modelRepo = getGlobalModelRepository();

const gpt2ModelRecord = {
  model_id: "onnx:Xenova/gpt2:q8",
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "Xenova/gpt2",
    dtype: "q8",
  },
} as const;

// Add an ONNX model from Hugging Face
await modelRepo.addModel({
  ...gpt2ModelRecord,
  tasks: ["TextGenerationTask"],
  title: "GPT-2",
  description: "GPT-2 ONNX",
  metadata: {},
});

// Connect model to specific tasks
await modelRepo.connectTaskToModel("TextGenerationTask", gpt2ModelRecord.model_id);

// Find models for a specific task
const textGenModels = await modelRepo.findModelsByTask("TextGenerationTask");
```

## Provider Setup

AI providers handle the actual execution of AI tasks. You need to register provider functions for each model provider and task type combination.

### Basic Provider Registration

```typescript
import { registerHuggingFaceTransformersInline } from "@workglow/ai-provider/hf-transformers/runtime";

// Inline: run functions registered on the current thread (tasks wired inside the provider)
await registerHuggingFaceTransformersInline();
```

### Worker-Based Provider Registration

For compute-intensive tasks that should run in workers:

```typescript
import { registerHuggingFaceTransformers } from "@workglow/ai-provider/hf-transformers";

await registerHuggingFaceTransformers({
  worker: () => new Worker(new URL("./worker_hft.ts", import.meta.url), { type: "module" }),
});
// Worker file must call registerHuggingFaceTransformersWorker() from @workglow/ai-provider/hf-transformers/runtime
```

### Job Queue Setup

Each provider needs a job queue for task execution:

```typescript
import { getTaskQueueRegistry, TaskInput, TaskOutput } from "@workglow/task-graph";
import { ConcurrencyLimiter, JobQueueClient, JobQueueServer } from "@workglow/job-queue";
import { InMemoryQueueStorage } from "@workglow/storage";
import { AiJob, AiJobInput } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

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
```

## Workflow Integration

AI tasks integrate seamlessly with Workglow workflows:

```typescript
import { Workflow } from "@workglow/task-graph";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const gpt2ModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "Xenova/gpt2",
    dtype: "q8",
  },
} as const;

const gteSmallConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Supabase/gte-small",
    dtype: "q8",
    native_dimensions: 384,
  },
} as const;

const workflow = new Workflow();

// Chain AI tasks together
const result = await workflow
  .textGeneration({
    model: gpt2ModelConfig,
    prompt: "Write about artificial intelligence",
  })
  .textEmbedding({
    model: gteSmallConfig,
    text: workflow.previous().text, // Use previous task output
  })
  .similarity({
    model: gteSmallConfig,
    text1: "artificial intelligence",
    embedding2: workflow.previous().vector, // Use embedding from previous task
  })
  .run();

console.log("Final similarity score:", result.similarity);
```

## RAG (Retrieval-Augmented Generation) Pipelines

The AI package provides a comprehensive set of tasks for building RAG pipelines. These tasks chain together in workflows without requiring external loops.

### Document Processing Tasks

| Task                      | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `StructuralParserTask`    | Parses markdown/text into hierarchical document trees |
| `TextChunkerTask`         | Splits text into chunks with configurable strategies  |
| `HierarchicalChunkerTask` | Token-aware chunking that respects document structure |
| `TopicSegmenterTask`      | Segments text by topic using heuristics or embeddings |
| `DocumentEnricherTask`    | Adds summaries and entities to document nodes         |

### Vector and Storage Tasks

| Task                    | Description                                                                       |
| ----------------------- | --------------------------------------------------------------------------------- |
| `ChunkVectorUpsertTask` | Stores chunks + their embeddings in a KnowledgeBase (input: `chunks` + `vector`)  |
| `VectorQuantizeTask`    | Quantizes vectors for storage efficiency                                          |

### Retrieval and Generation Tasks

| Task                 | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `ChunkRetrievalTask` | End-to-end retrieval: embeds the query, runs similarity or hybrid search |
| `QueryExpanderTask`  | Expands queries (multi-query / synonyms) for better retrieval coverage   |
| `RerankerTask`       | Reranks search results (simple heuristic or reciprocal-rank-fusion)      |
| `HierarchyJoinTask`  | Enriches retrieved metadata with parent summaries, section titles, entities |
| `ContextBuilderTask` | Builds formatted context for LLM prompts                                 |

### Complete RAG Workflow Example

```typescript
import { Workflow } from "@workglow/task-graph";
import { createKnowledgeBase } from "@workglow/knowledge-base";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

// 1. Set up a model repository
const modelRepo = new InMemoryModelRepository();
setGlobalModelRepository(modelRepo);

// 2. Add a local ONNX model (Hugging Face Transformers)
await modelRepo.addModel({
  model_id: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text2text-generation",
    model_path: "Xenova/LaMini-Flan-T5-783M",
    dtype: "q8",
  },
  tasks: ["TextGenerationTask", "TextRewriterTask"],
  title: "LaMini-Flan-T5-783M",
  description: "LaMini-Flan-T5-783M quantized to 8bit",
  metadata: {},
});

await modelRepo.addModel({
  model_id: "onnx:Xenova/all-MiniLM-L6-v2:q8",
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "feature-extraction",
    model_path: "Xenova/all-MiniLM-L6-v2",
    dtype: "q8",
    native_dimensions: 384,
  },
  tasks: ["TextEmbeddingTask"],
  title: "All MiniLM L6 V2 384D",
  description: "Xenova/all-MiniLM-L6-v2",
  metadata: {},
});

// Create a KnowledgeBase (auto-registers globally as "my-kb")
const kb = await createKnowledgeBase({
  name: "my-kb",
  vectorDimensions: 384, // must match your embedding model
});

// Document ingestion - fully chainable, no loops required
await new Workflow()
  .structuralParser({
    text: markdownContent,
    title: "Documentation",
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
    model: "onnx:Xenova/all-MiniLM-L6-v2:q8",
  })
  .chunkVectorUpsert({
    knowledgeBase: "my-kb",
  })
  .run();

// Query pipeline — ChunkRetrievalTask handles embedding + vector search end-to-end
const result = await new Workflow()
  .chunkRetrieval({
    knowledgeBase: "my-kb",
    query: "What is transfer learning?",
    model: "onnx:Xenova/all-MiniLM-L6-v2:q8",
    topK: 10,
  })
  .reranker({
    query: "What is transfer learning?",
    topK: 5,
  })
  .contextBuilder({
    format: "markdown",
    maxLength: 2000,
  })
  .textQuestionAnswer({
    question: "What is transfer learning?",
    model: "onnx:Xenova/LaMini-Flan-T5-783M:q8",
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
```

Each node contains:

- `nodeId` - Deterministic content-based ID
- `range` - Source character offsets
- `text` - Content
- `enrichment` - Summaries, entities, keywords (optional)
- `children` - Child nodes (for parent nodes)

### Task Data Flow

Each task passes through what the next task needs:

| Task                  | Passes Through           | Adds                                  |
| --------------------- | ------------------------ | ------------------------------------- |
| `structuralParser`    | -                        | `doc_id`, `documentTree`, `nodeCount` |
| `documentEnricher`    | `doc_id`, `documentTree` | `summaryCount`, `entityCount`         |
| `hierarchicalChunker` | `doc_id`                 | `chunks`, `text[]`, `count`           |
| `textEmbedding`       | (implicit)               | `vector[]`                            |
| `chunkToVector`       | -                        | `ids[]`, `vectors[]`, `metadata[]`    |
| `chunkVectorUpsert`   | -                        | `count`, `ids`                        |

This design eliminates the need for external loops - the entire pipeline chains together naturally.

## Error Handling

AI tasks include comprehensive error handling:

```typescript
import { TaskConfigurationError } from "@workglow/task-graph";

try {
  const task = new TextGenerationTask({
    model: "nonexistent-model",
    prompt: "Test prompt",
  });

  const result = await task.run();
} catch (error) {
  if (error instanceof TaskConfigurationError) {
    console.error("Configuration error:", error.message);
    // Handle missing model, invalid parameters, etc.
  } else {
    console.error("Runtime error:", error.message);
    // Handle API failures, network issues, etc.
  }
}
```

## Advanced Configuration

### Model Input Resolution

AI tasks accept model inputs as either string identifiers or direct `ModelConfig` objects. When a string is provided, the TaskRunner automatically resolves it to a `ModelConfig` before task execution using the `ModelRepository`.

```typescript
import { TextGenerationTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const gpt2ModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "Xenova/gpt2",
    dtype: "q8",
  },
} as const;

// Inline ModelConfig (provider + provider_config)
const task = new TextGenerationTask({
  model: gpt2ModelConfig,
  prompt: "Generate text",
});

// Registered model_id strings (e.g. onnx:org/model:q8) are still resolved via ModelRepository when you pass a string instead
```

This resolution is handled by the input resolver system, which inspects schema `format` annotations (like `"model"` or `"model:TextGenerationTask"`) to determine how string values should be resolved.

### Supported Format Annotations

| Format            | Description                              | Resolver                |
| ----------------- | ---------------------------------------- | ----------------------- |
| `model`           | Any AI model configuration               | ModelRepository         |
| `model:TaskName`  | Model compatible with specific task type | ModelRepository         |
| `storage:tabular` | Tabular data storage                     | TabularStorageRegistry  |
| `knowledge-base`  | Knowledge base instance                  | KnowledgeBaseRegistry   |
| `credential`      | Credential from credential store         | CredentialStoreRegistry |
| `tasks`           | Task class from task registry            | TaskRegistry            |

### Custom Model Validation

Tasks automatically validate that specified models exist and are compatible:

```typescript
import { TextGenerationTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const gpt2ModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "Xenova/gpt2",
    dtype: "q8",
  },
} as const;

// Models are validated before task execution
const task = new TextGenerationTask({
  model: gpt2ModelConfig,
  prompt: "Generate text",
});

// Validation happens during task.run()
```

### Progress Tracking

Monitor AI task progress:

```typescript
import { TextGenerationTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const gpt2ModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "Xenova/gpt2",
    dtype: "q8",
  },
} as const;

const task = new TextGenerationTask({
  model: gpt2ModelConfig,
  prompt: "Long generation task...",
});

task.on("progress", (progress, message, details) => {
  console.log(`Progress: ${progress}% - ${message}`);
});

const result = await task.run();
```

### Task Cancellation

All AI tasks support cancellation via AbortSignal:

```typescript
import { TextGenerationTask } from "@workglow/ai";
import { HF_TRANSFORMERS_ONNX } from "@workglow/ai-provider/hf-transformers";

const gpt2ModelConfig = {
  provider: HF_TRANSFORMERS_ONNX,
  provider_config: {
    pipeline: "text-generation",
    model_path: "Xenova/gpt2",
    dtype: "q8",
  },
} as const;

const controller = new AbortController();

const task = new TextGenerationTask({
  model: gpt2ModelConfig,
  prompt: "Generate text...",
});

// Cancel after 10 seconds
setTimeout(() => controller.abort(), 10000);

try {
  const result = await task.run({ signal: controller.signal });
} catch (error) {
  if (error.name === "AbortError") {
    console.log("Task was cancelled");
  }
}
```

## Environment-Specific Usage

### Browser Usage

```typescript
import { IndexedDbModelRepository } from "@workglow/ai";

// Use IndexedDB for persistent storage in browser
const modelRepo = new IndexedDbModelRepository();
```

### Node.js Usage

```typescript
import { SqliteModelRepository } from "@workglow/ai";
import { Sqlite } from "@workglow/storage/sqlite";

await Sqlite.init();
// Use SQLite for server-side storage
const modelRepo = new SqliteModelRepository("./models.db");
```

### Bun Usage

```typescript
import { InMemoryModelRepository } from "@workglow/ai";

// Direct imports work with Bun via conditional exports
const modelRepo = new InMemoryModelRepository();
```

## Dependencies

This package depends on:

- `@workglow/job-queue` - Job queue system for task execution
- `@workglow/storage` - Storage abstractions for model and data persistence
- `@workglow/task-graph` - Task graph system for workflow management
- `@workglow/util` - Utility functions and shared components, including JSON Schema types and utilities

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
