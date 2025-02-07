- [Architecture Documentation](#architecture-documentation)
  - [Design Principles](#design-principles)
- [Overview](#overview)
  - [Storage](#storage)
  - [Source Data](#source-data)
  - [LLM Providers](#llm-providers)
  - [Job Queues](#job-queues)
  - [Tasks](#tasks)
- [Tasks](#tasks-1)
  - [Task Classes](#task-classes)
  - [TaskGraph](#taskgraph)
  - [TaskGraphRunner](#taskgraphrunner)
  - [TaskGraphBuilder](#taskgraphbuilder)
- [Warnings / ToDo](#warnings--todo)

# Architecture Documentation

This document covers the architecture and the reasoning behind the design decisions. For a more practical guide to getting started, see the [Developer Getting Started](./01_getting_started.md) guide. After reading this document, read [extending the system](03_extending.md) to see how to create your own Tasks. And if you want a rambling background on the motivations behind this project, see the [Motivations](../background/01_motivations.md) guide.

## Design Principles

- **Simple to Use**: The system should be simple to use and easy to extend.
- **Orthogonal Systems**: The system should be composed of orthogonal systems that can be easily swapped out. For example, there is an optional caching layer in the task graph runner, which was many different caching system options (in memory, indexeddb in browser, filesystem, sqlite, postgres, etc.).
- **Resumable**: The system should be resumable, so that if the user closes the app while processing, they can come back to it later.
- **No-Code/Low-Code**: The system should be able to be used by no-code/low-code users, so tasks enumerate their inputs and outputs explicitly, as well as some other metadata like if it has side effects, its name and category, etc.
- **Code Generation**: Ideally you should be able to back and forth from a task graph to code and back again.
- **Task Graphs**: The system should be based on graphs, where tasks are connected by data flows to for a directed acyclic graph (DAG).

# Overview

The system is composed of several different systems, several of which that can be swapped out for different implementations. These systems are:

## Storage

- **QueueRepository**: The QueueRepository is responsible for storing the tasks that are waiting to be run. There are implementations for in-memory, indexeddb in the browser, filesystem, sqlite, postgres, etc.
- **TaskOutputRepository**: The TaskOutputRepository is responsible for storing the output of tasks. It can be added to a TaskRunner to provide cacheing of intermediate steps. There are implementations for in-memory, indexeddb in the browser, filesystem, sqlite, postgres, etc. You can create your own to say, only cache the last 10 runs of a task, or cache everything but runs of a task that had a certain input, like a specific model etc.

## Source Data

- **FileSource**: The FileSource is responsible for reading and writing files. There are implementations for reading and writing files to the filesystem.
- **Sqlite**: The Sqlite is responsible for reading and writing Sqlite.
- **Postgres**: The Postgres is responsible for interfacing with Postgres.

## LLM Providers

- **HuggingFace**: The HuggingFace provider is a simple wrapper around the Tranformers.js library and is intended for running models locally. This library uses ONNX under the hood, which is optimized for running on the command line, but it also works in the browser using WASM and soon WebGPU.
- **MediaPipe**: The MediaPipe provider is a simple wrapper around the MediaPipe library and is intended for running models locally. This library uses Tensorflow.js under the hood.
- **OpenAI**: The OpenAI provider is a simple wrapper around the OpenAI API and is intended for running models in the cloud.\*
- **Anthropic**: The Anthropic provider is a simple wrapper around the Anthropic API and is intended for running models in the cloud.\*

## Job Queues

Some tasks are run in a queue, so that a full task queue can resume where it left off (in concert with a TaskOutputRepository). Queues handling things like retries, timeouts, and other things that are not directly related to the task itself. There are several different queue implementations, including:

- **InMemoryJobQueue**: The InMemoryQueue is a simple in-memory queue that is not resumable.
- **IndexedDbJobQueue**: The IndexedDbQueue is a queue that is stored in the browser's indexeddb and is resumable.
- **SqliteJobQueue**: The SqliteQueue is a queue that is stored in a Sqlite database and is resumable.
- **PostgresJobQueue**: The PostgresQueue is a queue that is stored in a Postgres database and is resumable.

Queues can have limiters, like only running one task at a time, or based on rate limits.

- **RateLimiter**: The RateLimiter is a simple rate limiter that can be used to limit the number of tasks that are run in a certain time period. If a task using an API errors out, the rate limiter can use details of error response to determine how long to wait before trying again. There are several different rate limiter implementations, including:
  - **SqliteRateLimiter**: The SqliteRateLimiter is a rate limiter that is stored in a Sqlite database.
  - **PostgresRateLimiter**: The PostgresRateLimiter is a rate limiter that is stored in a Postgres database.
  - **InMemoryRateLimiter**: The InMemoryRateLimiter is a rate limiter that is stored in memory.
  - **IndexedDbRateLimiter**: The IndexedDbRateLimiter is a rate limiter that is stored in the browser's indexeddb.\*
- **ConcurrencyLimiter**: The ConcurrencyLimiter is a simple concurrency limiter that can be used to limit the number of tasks that are run at the same time.
- **CompositeLimiter**: The CompositeLimiter is a simple composite limiter that can be used to combine multiple limiters.

## Tasks

Tasks are the main building blocks of the system. They are simple or compound tasks that are the nodes in a directed acyclic graph (DAG), where the edges are DataFlows.

- **Task** Each task class has well defined inputs and outputs definitions. When a task is created, it can some of its inputs provided (defaults). The remainder of the inputs will come from the outputs of other tasks in the graph. When combined, the data can be found in runInputData at the time the task is run.
- **DataFlow** The tasks in a graph are connected by edges called DataFlows. These define the which task and which output of that task are connected to which input of the next task.

# Tasks

```mermaid

flowchart LR
  subgraph CompoundTask
    direction LR
    subgraph DownloadModelCompoundTask
        direction LR
        DownloadModelTask_1[DownloadModelTask model 1]
        DownloadModelTask_2[DownloadModelTask model 2]
    end
    subgraph RewriteTextCompoundTask
        direction LR
        RewriteTextTask1[RewriteTextTask model 1]
        RewriteTextTask2[RewriteTextTask model 2]
    end
    subgraph TextEmeddingCompoundTask
        direction LR
        TextEmeddingTask1[TextEmeddingTask model 1]
        GenerateTextTask2[TextEmeddingTask model 2]
    end
  end

  A[Load document] --> B[Split document into paragraphs]
  B --> CompoundTask
  DownloadModelCompoundTask --> RewriteTextCompoundTask
  RewriteTextCompoundTask --> TextEmeddingCompoundTask
  CompoundTask --> C[Save to Database]


```

## Task Classes

```mermaid
classDiagram

    note "Task = SimpleTask | CompoundTask"

    class TaskBase{
      string id
      string name
      static string type$
      static string category$
      static TaskInputDefinition[] inputs$
      static TaskOutputDefinition[] outputs$
      static readonly sideeffects = false$
      run() TaskOutput
      runReactive() TaskOutput
    }
    <<abstract>> TaskBase
    style TaskBase type:abstract,stroke-dasharray: 5 5

    class SimpleTask{
      bool isCompound = false
    }
    <<abstract>> SimpleTask
    TaskBase <|-- SimpleTask
    style SimpleTask type:abstract,stroke-dasharray: 5 5

    class CompoundTask{
      bool isCompound = true
      TaskGraph subGraph
      static readonly sideeffects = true$
    }
    <<abstract>> CompoundTask
    TaskBase <|-- CompoundTask
    style CompoundTask type:abstract,stroke-dasharray: 5 5

    class OutputTask{
      static readonly sideeffects = true$
    }
    <<abstract>> OutputTask
    SimpleTask <|-- OutputTask
    style OutputTask type:abstract,stroke-dasharray: 5 5

    class JobQueueTask{
      string queue
      string currentJobId
    }
    <<abstract>> JobQueueTask
    SimpleTask <|-- JobQueueTask
    style JobQueueTask type:abstract,stroke-dasharray: 5 5

    class JobQueueAiTask{
      string model
    }
    <<abstract>> JobQueueAiTask
    JobQueueTask <|-- JobQueueAiTask
    style JobQueueAiTask type:abstract,stroke-dasharray: 5 5



  class DownloadModelTask{
    run() model
  }
  JobQueueAiTask <|-- DownloadModelTask
  style DownloadModelTask type:model,stroke-width:2px

  class TextEmbeddingTask{
    string text
    run() vector
  }
  JobQueueAiTask <|-- TextEmbeddingTask
  style TextEmbeddingTask type:model,stroke-width:2px

  class TextGenerationTask{
    string prompt
    run() text
  }
  JobQueueAiTask <|-- TextGenerationTask
  style TextGenerationTask type:model,stroke-width:2px

  class TextQuestionAnswerTask{
    string question
    string context
    run() answer
  }
  JobQueueAiTask <|-- TextQuestionAnswerTask
  style TextQuestionAnswerTask type:model,stroke-width:2px

  class TextRewriterTask{
    string prompt
    string text
    run() text
  }
  JobQueueAiTask <|-- TextRewriterTask
  style TextRewriterTask type:model,stroke-width:2px

  class TextSummaryTask{
    string text
    run() text
  }
  JobQueueAiTask <|-- TextSummaryTask
  style TextSummaryTask type:model,stroke-width:2px

  class TextTranslationTask{
    string text
    string source
    string target
    run() text
  }
  JobQueueAiTask <|-- TextTranslationTask
  style TextTranslationTask type:model,stroke-width:2px

  class DebugLogTask{
    any message
    log_level level
    run() message
  }
  OutputTask <|-- DebugLogTask
  style DebugLogTask type:output,stroke-width:1px

  class LambdaTask{
    Function fn
    any input
    run() output
  }
  SimpleTask <|-- LambdaTask
  style LambdaTask type:utility,stroke-width:1px

  class JavaScriptTask{
    Function code
    any input
    run() output
  }
  SimpleTask <|-- JavaScriptTask
  style JavaScriptTask type:utility,stroke-width:1px

```

## TaskGraph

```mermaid
classDiagram

  class TaskGraph{
    TaskBase[] tasks
  }

Task *-- TaskGraph
style Task type:abstract,stroke-dasharray: 5 5
```

## TaskGraphRunner

```mermaid
classDiagram

  class TaskGraphRunner{
    Map<number, Task[]> layers
    Map<unknown, TaskInput> provenanceInput
    TaskGraph dag
    TaskOutputRepository repository
    assignLayers(Task[] sortedNodes)
    runGraph(TaskInput parentProvenance) TaskOutput
    runGraphReactive() TaskOutput
  }

```

The TaskGraphRunner is responsible for executing tasks in a task graph. Key features include:

- **Layer-based Execution**: Tasks are organized into layers based on dependencies, allowing parallel execution of independent tasks
- **Provenance Tracking**: Tracks the lineage and input data that led to each task's output
- **Caching Support**: Can use a TaskOutputRepository to cache task outputs and avoid re-running tasks
- **Reactive Mode**: Supports reactive execution where tasks can respond to input changes without full re-execution
- **Smart Task Scheduling**: Automatically determines task execution order based on dependencies

## TaskGraphBuilder

```mermaid
classDiagram

  class TaskGraphBuilder{
    -TaskGraphRunner _runner
    -TaskGraph _graph
    -TaskOutputRepository _repository
    -DataFlow[] _dataFlows
    +EventEmitter events
    run() TaskOutput
    pop()
    parallel(...builders) TaskGraphBuilder
    rename(string source, string target, number index) TaskGraphBuilder
    reset() TaskGraphBuilder
    toJSON() TaskGraphJson
    toDependencyJSON() JsonTaskItem[]
    +DownloadModel(model)
    +TextEmbedding(model text)
    +TextGeneration(model prompt)
    +TextQuestionAnswer(model question context)
    +TextRewriter(model prompt text)
    +TextSummary(model text)
    +TextTranslation(model text source target)
    +DebugLog(message level)
    +Lambda(fn input)
    +JavaScript(code input)
  }

```

The TaskGraphBuilder provides a fluent interface for constructing task graphs. Key features include:

- **Event System**: Emits events for graph changes and execution status
- **Parallel Execution**: Can run multiple task graphs in parallel
- **Repository Integration**: Optional integration with TaskOutputRepository for caching
- **JSON Support**: Can import/export graphs as JSON
- **Smart Task Connection**: Automatically connects task outputs to inputs based on naming
- **Task Management**: Methods for adding, removing, and modifying tasks in the graph

# Warnings / ToDo

-**Items marked with \* are not yet implemented.** These are good items for a first time contributor to work on. ;)

-**Graphs are not yet resumable** While much work has gone into making the system resumable, the TaskRunner has a ways to go before it is fully resumable. This is a major TODO item.
