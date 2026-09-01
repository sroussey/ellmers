# workglow

Convenience meta-package that re-exports all Workglow packages for single-import usage.

## Overview

The `workglow` package is a single entry point that re-exports the published `@workglow/*` libraries. Instead of installing and importing from multiple packages, you can use `workglow` to get everything in one import.

## Features

- **Single Import**: Access all Workglow APIs from one package
- **Multi-Platform**: Browser, Node.js, and Bun entry points
- **Debug in Browser**: Chrome DevTools formatters from `@workglow/task-graph` are included only in the browser build
- **Provider Subpaths**: Opt-in provider subpath exports (`workglow/anthropic`, `workglow/openai`, etc.) preserve lazy SDK loading
- **All Optional Peers Surfaced**: AI SDKs and storage backends are optional peer dependencies -- install only what you need

## Installation

```bash
bun add workglow
```

## Quick Start

```typescript
import { Workflow, TextGenerationTask, registerHuggingFaceTransformersInline } from "workglow";

// Register a provider (inline ONNX in this bundle)
await registerHuggingFaceTransformersInline();

// Create and run a workflow
const workflow = new Workflow();
workflow.addTask(new TextGenerationTask({ input: { prompt: "Hello, world!" } }));
const result = await workflow.run();
```

## Included Packages

| Package                    | Description                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@workglow/util`           | Utility functions and shared types                                                                                            |
| `@workglow/storage`        | Storage abstraction (IndexedDB, PostgreSQL, Supabase) plus `/sqlite` and `/postgres` SQL drivers (optional peers, lazy SDKs)  |
| `@workglow/job-queue`      | Job queue management and task scheduling                                                                                      |
| `@workglow/task-graph`     | DAG task graph construction and execution; browser build also exports DevTools formatters (`installDevToolsFormatters`, etc.) |
| `@workglow/knowledge-base` | Knowledge base, document management, and RAG infrastructure                                                                   |
| `@workglow/ai`             | Core AI functionality, tasks, model management, and provider helpers (`/provider-utils`)                                      |
| `@workglow/<vendor>`       | Standalone provider packages (Anthropic, OpenAI, Gemini, Ollama, HuggingFace, llama.cpp, MediaPipe, Chrome AI)                |
| `@workglow/tasks`          | Pre-built utility tasks (arrays, scalars, vectors, etc.)                                                                      |

## Provider Subpath Exports

SDK-dependent code is isolated behind separate vendor packages, each exposing `/ai` (main thread) and `/ai-runtime` (worker / inline runtime). Each `workglow/<vendor>` entry mirrors the corresponding standalone provider package:

```typescript
// Anthropic (requires: @anthropic-ai/sdk)
import { ANTHROPIC_TASKS } from "workglow/anthropic";

// Google Gemini (requires: @google/genai)
import { GEMINI_TASKS } from "workglow/google-gemini";

// HuggingFace Transformers (requires: @huggingface/transformers)
import { HFT_TASKS } from "workglow/hf-transformers";

// Ollama (requires: ollama)
import { OLLAMA_TASKS } from "workglow/ollama";

// OpenAI (requires: openai)
import { OPENAI_TASKS } from "workglow/openai";

// TensorFlow MediaPipe (requires: @mediapipe/tasks-*)
import { TFMP_TASKS } from "workglow/tf-mediapipe";
```

## Optional Peer Dependencies

Install only the providers and backends you need:

```bash
# AI Provider SDKs
bun add @anthropic-ai/sdk        # For Anthropic
bun add @google/genai    # For Google Gemini
bun add @huggingface/transformers   # For HuggingFace Transformers ONNX
bun add ollama                   # For Ollama
bun add openai                   # For OpenAI

# MediaPipe (browser-only ML)
bun add @mediapipe/tasks-text @mediapipe/tasks-vision @mediapipe/tasks-audio @mediapipe/tasks-genai

# Storage backends
bun add @sqlite.org/sqlite-wasm   # Browser SQLite
# Node.js and Bun need no install: SQLite comes from the built-in node:sqlite
bun add pg                        # PostgreSQL
bun add @supabase/supabase-js     # Supabase
```

For SQLite-backed APIs, call **`await Sqlite.init()`** once before `new Sqlite.Database(...)` or any storage constructor that opens SQLite by file path. `Sqlite` is exported from the `workglow` package (and from `@workglow/storage/sqlite`).

## License

Apache-2.0
