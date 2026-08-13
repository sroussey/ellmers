/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test-only surface for `@workglow/task-graph`.
 *
 * Two kinds of thing land here, and they have different rules:
 *
 * - **Test doubles** (this file's current contents) — subclasses and fakes that
 *   only tests construct. They may be defined inside this bundle, because the
 *   main bundle never references them, so there is no second copy to diverge
 *   from. They must still import their BASE classes by package specifier, or
 *   the base gets inlined here and `instanceof` stops working.
 * - **Reset hooks and shared registries** — anything the main bundle also
 *   touches. Those cannot live here; they go through an `_internal` bag on the
 *   public entry and are re-exported from this file, so both entries resolve to
 *   one instance.
 *
 * Nothing here is public API and none of it is re-exported from `.`.
 */

export { FsFolderTaskGraphRepository } from "./testing/FsFolderTaskGraphRepository";
export { InMemoryTaskGraphRepository } from "./testing/InMemoryTaskGraphRepository";
export { InMemoryTaskOutputRepository } from "./testing/InMemoryTaskOutputRepository";
export { RunPrivateInMemoryTaskOutputRepository } from "./testing/RunPrivateInMemoryTaskOutputRepository";
export { NonStreamingMemoryRepo, StreamingMemoryRepo } from "./testing/StreamingMemoryRepo";

/**
 * Shared base for durable streaming task-output repositories. Not a test double
 * itself — the backend adapters that extend it (SQLite, Postgres, Supabase,
 * IndexedDB) live in the packages that own their drivers, and MUST import it
 * from here by package specifier so they extend the one class.
 */
export { TabularStreamingTaskOutputRepository } from "./testing/TabularStreamingTaskOutputRepository";
export type { IBlobChunkStore } from "./testing/TabularStreamingTaskOutputRepository";

/**
 * The shared cast of fake tasks the task-graph suites act on. Re-exported as a
 * whole: importing it also patches `Workflow.prototype` with the fluent builder
 * methods it declares, so consumers get the classes and the builder surface from
 * one import.
 */
export * from "./testing/TestTasks";

/**
 * Conformance suite for {@link TaskOutputRepository}. An adapter supplies a
 * factory and inherits every behavioural assertion, so a new backend is a
 * ~15-line shim in its own package rather than an edit to someone else's tests.
 */
export { runTaskOutputRepositoryContract } from "./testing/taskOutputRepositoryContract";

/**
 * Conformance suite for {@link TaskGraphRepository} — graph round-trip and the
 * unregistered-task-type rejection.
 */
export { runTaskGraphRepositoryContract } from "./testing/taskGraphRepositoryContract";

/**
 * Conformance suite for a STREAMING task-output repository (JSON rows plus port
 * payloads as ordered blob chunks). Extracted from three per-backend suites that
 * were ~95% identical; adapters supply only their ref scheme and how to build a
 * sibling instance.
 */
export { runStreamingTaskOutputRepositoryContract } from "./testing/streamingTaskOutputRepositoryContract";
export type {
  StreamingRepositoryUnderTest,
  StreamingTaskOutputRepositoryContractOptions,
} from "./testing/streamingTaskOutputRepositoryContract";
