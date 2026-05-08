# @workglow/test

Testing utilities and sample data for Workglow AI task pipelines.

## Overview

The `@workglow/test` package provides testing utilities, sample data, and in-memory implementations for developing and testing Workglow AI applications. It includes mock repositories, sample task configurations, and helper functions for setting up test environments.

## Features

- **In-Memory Repositories**: Mock implementations of task graph and output repositories for testing
- **Sample Data**: Pre-configured sample tasks and workflows for testing and development
- **Test Bindings**: Helper functions for setting up test environments
- **Multi-Platform Support**: Works in browser, Node.js, and Bun environments

## Installation

```bash
npm install @workglow/test
# or
bun add @workglow/test
```

## Usage

### In-Memory Repositories

```typescript
import { InMemoryTaskGraphRepository, InMemoryTaskOutputRepository } from "@workglow/test";

// Create in-memory repositories for testing
const taskGraphRepo = new InMemoryTaskGraphRepository();
const taskOutputRepo = new InMemoryTaskOutputRepository();
```

### Sample Data and Models

```typescript
import { registerHuggingfaceLocalModels, registerMediaPipeTfJsLocalModels } from "@workglow/test";

// Register sample AI models for testing
await registerHuggingfaceLocalModels();
await registerMediaPipeTfJsLocalModels();
```

### AI Provider Setup

```typescript
import { registerHuggingFaceTransformersInline } from "@workglow/huggingface-transformers/ai-runtime";

// Set up HuggingFace Transformers inline for testing
await registerHuggingFaceTransformersInline();
```

## API Reference

### Repositories

- `InMemoryTaskGraphRepository` - In-memory implementation of task graph storage
- `InMemoryTaskOutputRepository` - In-memory implementation of task output storage
- `IndexedDbTaskGraphRepository` - Browser-based IndexedDB storage for task graphs
- `IndexedDbTaskOutputRepository` - Browser-based IndexedDB storage for task outputs

### Sample Registration Functions

- `registerHuggingfaceLocalModels()` - Registers sample HuggingFace models
- `registerMediaPipeTfJsLocalModels()` - Registers sample MediaPipe TensorFlow.js models

## Dependencies

This package depends on other Workglow packages:

- `@workglow/ai`
- `@workglow/job-queue`
- `@workglow/storage`
- `@workglow/task-graph`
- `@workglow/tasks`
- `@workglow/util`

## License

Apache 2.0 - See [LICENSE](./LICENSE) for details.
