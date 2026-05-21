/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight entry point for worker contexts.
 *
 * Exports only the DI, logging, worker infrastructure, and parse utilities
 * needed by AI provider workers — without the heavy JSON Schema validation
 * (ajv, URI.js, nearley, json-pointer) that bloats the main barrel export.
 *
 * AI provider packages should import from `@workglow/util/worker` in files
 * that run inside Web Workers / worker threads.
 */

// DI — ServiceRegistry, globalServiceRegistry, createServiceToken, Container
// organize-imports-ignore

export * from "./di";

// Logging — getLogger, setLogger, ILogger, ConsoleLogger, NullLogger
export * from "./logging";

// Worker infrastructure — WorkerServerBase, WORKER_SERVER, WorkerManager, WORKER_MANAGER
// Note: Platform-specific WorkerServer registration (Worker.browser/node/bun) is NOT
// included here. The worker registration files must import @workglow/util to trigger
// the side-effect that registers the WorkerServer implementation.
export * from "./worker/WorkerServerBase";
export * from "./worker/WorkerManager";
// H8: scrubStack helper for sanitizing absolute filesystem paths out of
// worker error stacks. Exported here so third-party worker code in the
// same process can apply the same sanitizer to its own error reporting.
export * from "./worker/scrubStack";

// Partial JSON parsing for streaming AI responses (zero deps)
export * from "./json-schema/parsePartialJson";

// Type-only re-exports used by ModelSchema files and provider code
export type { DataPortSchemaObject } from "./json-schema/DataPortSchema";
export type { FromSchema } from "./json-schema/FromSchema";
export type { JsonSchema, JsonSchemaCustomProps } from "./json-schema/JsonSchema";

// TypedArray type used by HFT embedding providers
export type { TypedArray } from "./vector/TypedArray";
