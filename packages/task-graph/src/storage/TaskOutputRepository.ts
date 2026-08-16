/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";
import { createServiceToken, EventEmitter } from "@workglow/util";
import type { CacheRef } from "../cache/CacheRef";
import type { StreamMode } from "../task/StreamTypes";
import type { TaskInput, TaskOutput } from "../task/TaskTypes";

export const TASK_OUTPUT_REPOSITORY = createServiceToken<TaskOutputRepository>(
  "taskgraph.taskOutputRepository"
);

export type TaskOutputEventListeners = {
  output_saved: (taskType: string) => void;
  output_retrieved: (taskType: string) => void;
  output_cleared: () => void;
  output_pruned: () => void;
};

export type TaskOutputEvents = keyof TaskOutputEventListeners;

export type TaskOutputEventListener<Event extends TaskOutputEvents> =
  TaskOutputEventListeners[Event];

export type TaskOutputEventParameters<Event extends TaskOutputEvents> = EventParameters<
  TaskOutputEventListeners,
  Event
>;

/**
 * Primary key of a single cached row, as a repository addresses it: the
 * `taskType` axis value the writer passed and the row `key` the repository
 * derived from the inputs via {@link TaskOutputRepository.keyFromInputs}.
 *
 * Run scoping is NOT baked into `taskType` here — a run-scoped delete takes the
 * `runId` separately and applies whatever namespacing it uses internally, so a
 * caller holding these pairs never has to know how a backing scopes runs.
 */
export interface RunCacheEntryKey {
  readonly taskType: string;
  readonly key: string;
}

/**
 * Abstract class for managing task outputs in a repository
 * Provides methods for saving, retrieving, and clearing task outputs
 */
export abstract class TaskOutputRepository {
  outputCompression: boolean;

  constructor({ outputCompression = true }) {
    this.outputCompression = outputCompression;
  }

  private get events() {
    if (!this._events) {
      this._events = new EventEmitter<TaskOutputEventListeners>();
    }
    return this._events;
  }
  private _events: EventEmitter<TaskOutputEventListeners> | undefined;

  on<Event extends TaskOutputEvents>(name: Event, fn: TaskOutputEventListener<Event>) {
    this.events.on(name, fn);
  }

  off<Event extends TaskOutputEvents>(name: Event, fn: TaskOutputEventListener<Event>) {
    this.events.off(name, fn);
  }

  waitOn<Event extends TaskOutputEvents>(name: Event) {
    return this.events.waitOn(name) as Promise<TaskOutputEventParameters<Event>>;
  }

  emit<Event extends TaskOutputEvents>(name: Event, ...args: TaskOutputEventParameters<Event>) {
    this._events?.emit(name, ...args);
  }

  /**
   * Persist a task output keyed by `(taskType, fingerprint(inputs))`.
   *
   * Backing implementations upsert by primary key (last-writer-wins). For
   * deterministic cache entries (`CachePolicy.kind === "deterministic"`) this
   * is benign because all writers produce equal values. Run-private writes
   * are single-writer-per-runId in practice (one worker per run), so the
   * upsert behavior is also fine there.
   */
  abstract saveOutput(
    taskType: string,
    inputs: TaskInput,
    output: TaskOutput,
    createdAt?: Date // for testing purposes
  ): Promise<void>;

  /**
   * OPTIONAL streaming sink — the single streaming writer contract.
   * Implementations that can ingest a byte stream without materializing the
   * full payload (e.g. a file-backed cache) declare this method; the runner
   * pipes each port's encoded deltas straight to it. The default base class
   * does NOT implement it — call {@link supportsStreaming} to branch.
   *
   * Persists ONE output port's already-encoded byte stream (a stream codec
   * applies the per-mode encoding before this call), keyed by
   * `(taskType, inputs, port)` so a task with several streamable ports stores
   * each independently. `metadata` carries side-band data (e.g. a `mime` hint).
   *
   * Returns a {@link CacheRef} that the runner places into `Output` at the
   * port's slot when the reference threshold is met; it carries `port` and
   * `mode` so the reader knows which codec to replay. The `$ref` string is
   * opaque; only this repository (and any wrapping namespacer like
   * {@link RunPrivateCacheRepo}) needs to know how to decode it via
   * {@link getOutputByRef} / {@link getOutputStreamByRef}.
   *
   * Implementations that provide this method MUST also provide
   * {@link getOutputByRef} (and ideally {@link getOutputStreamByRef}); a ref
   * written by one without a paired reader is unresolvable.
   *
   * Implementations SHOULD populate `size` on the returned ref: refs without
   * a known size are conservatively kept as refs, silently bypassing
   * below-threshold inlining for callers that expect small outputs inline.
   */
  saveOutputStreamPort?(
    taskType: string,
    inputs: TaskInput,
    port: string,
    mode: StreamMode,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ): Promise<CacheRef>;

  /**
   * OPTIONAL reader counterpart of {@link saveOutputStreamPort}. Resolves a
   * {@link CacheRef} previously produced by that writer to a `Blob`.
   * Returns `undefined` on cache miss (TTL expiry, manual clear). The runner
   * never calls this directly; consumers calling `JobHandle.result()` or
   * `resolveOutput` reach it through the resolver layer.
   */
  getOutputByRef?(ref: CacheRef): Promise<Blob | undefined>;

  /**
   * OPTIONAL streaming reader counterpart of {@link saveOutputStreamPort}. Returns
   * an async iterable of bytes for the referenced entry, or `undefined` when
   * the entry is absent or this backing does not support streaming retrieval.
   *
   * Always a Promise, even for a backing that can answer synchronously
   * (filesystem `openSync`, in-memory). Resolving the ref is one await per ref,
   * not per chunk, so the cost is nil — and the uniform shape is what lets a
   * caller hand the result straight to a consumer that takes an iterable
   * (`StreamPortCodec.materialize`), rather than every call site deciding for
   * itself whether this particular backing needs awaiting. It also keeps the
   * absent-entry answer honest for asynchronous backings (IndexedDB, SQL) that
   * cannot probe existence synchronously: a dangling ref resolves to
   * `undefined` — a cache miss — where an un-awaited Promise would read as a
   * live stream.
   *
   * Implementations MUST yield bounded-size chunks (e.g. filesystem read
   * chunks): cache-hit replay paces consumers per chunk, so yielding the
   * whole payload as one chunk defeats the memory bound this reader exists
   * to provide.
   */
  getOutputStreamByRef?(ref: CacheRef): Promise<AsyncIterable<Uint8Array> | undefined>;

  /**
   * OPTIONAL cleanup hook for orphan blobs. Called by the runner when a
   * stream-write succeeded (producing a {@link CacheRef}) but the row write
   * that points at it failed — without this, the blob would persist on disk
   * with no row referencing it, and the row-driven cleanup paths would never
   * find it. Implementations SHOULD be best-effort and idempotent (no error
   * on missing entry). Returns when the deletion attempt has settled.
   */
  deleteOutputByRef?(ref: CacheRef): Promise<void>;

  /**
   * True when this repository implements the streaming writer
   * {@link saveOutputStreamPort}. The single capability probe: every streaming
   * path (single binary port, or per-port under `noAccumulation`) writes
   * through that one method, so one answer covers them all. What differs
   * between those paths is the runner's gating, not the backing's capability.
   */
  supportsStreaming(): boolean {
    return typeof this.saveOutputStreamPort === "function";
  }

  abstract getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined>;

  abstract clear(): Promise<void>;

  abstract size(): Promise<number>;

  abstract clearOlderThan(olderThanInMs: number): Promise<void>;

  /**
   * Whether entries written to this repository will survive a process crash / restart.
   *
   * Used by the task runner to warn when `kind: "private"` tasks are configured with a
   * non-durable backing store (e.g., in-memory) — restart-survival, which is the whole
   * point of the private cache tier, will not actually work in that case.
   */
  abstract isDurable(): boolean;

  /**
   * Run-scoped write for the private cache: persist an entry under a specific
   * `runId`. Used by {@link RunPrivateCacheRepo} so the run id is a first-class
   * column (indexed) rather than a `taskType` prefix.
   *
   * Default implementation throws — only run-private backing repositories
   * (e.g. `RunPrivateTaskOutputRepository`) implement it.
   */
  async saveOutputForRun(
    _runId: string,
    _taskType: string,
    _inputs: TaskInput,
    _output: TaskOutput,
    _createdAt?: Date
  ): Promise<void> {
    throw new Error(
      `${this.constructor.name}: saveOutputForRun is not supported by this repository.`
    );
  }

  /** Run-scoped read counterpart to {@link saveOutputForRun}. Default throws. */
  async getOutputForRun(
    _runId: string,
    _taskType: string,
    _inputs: TaskInput
  ): Promise<TaskOutput | undefined> {
    throw new Error(
      `${this.constructor.name}: getOutputForRun is not supported by this repository.`
    );
  }

  /**
   * Delete every entry for `runId`. Used by `RunPrivateCacheRepo.clearRun()`.
   * Indexed on the run-private schema's runId-leading primary key. Default throws.
   */
  async deleteRun(_runId: string): Promise<void> {
    throw new Error(`${this.constructor.name}: deleteRun is not supported by this repository.`);
  }

  /**
   * OPTIONAL targeted counterpart of {@link deleteRun}: delete exactly the
   * listed rows of `runId`, and nothing else.
   *
   * Declared only by backings whose {@link deleteRun} cannot select a run's
   * rows without scanning — the win is skipping that scan, so a backing with an
   * indexed run-scoped delete should NOT declare this. `entries` are the raw
   * (unscoped) `taskType` and row `key` pairs; the backing applies its own run
   * namespacing.
   *
   * The caller is responsible for the list being COMPLETE: any row of `runId`
   * not listed survives, and is reclaimed later by {@link deleteRunOlderThan}.
   * {@link RunPrivateCacheRepo} therefore falls back to {@link deleteRun}
   * whenever it cannot vouch for its recorded write-set.
   *
   * Implementations must NOT sweep run-scoped side storage (e.g. sidecar blobs
   * selected by a name prefix) the caller did not name: a row this call leaves
   * in place keeps a `CacheRef` into that storage, and a prefix sweep silently
   * dangles it. The caller names its blobs through
   * {@link deleteOutputByRefForRun}; the rest is the age sweep's job.
   */
  deleteRunEntries?(runId: string, entries: readonly RunCacheEntryKey[]): Promise<void>;

  /**
   * OPTIONAL derivation of a row `key` from a task's cache-key inputs — the
   * same function the backing's own write path uses. Exposed so a wrapper can
   * record the exact key a write landed under (see {@link deleteRunEntries})
   * instead of re-deriving it from an assumed hash, which would silently stop
   * matching if a backing changed its keying.
   */
  keyFromInputs?(inputs: TaskInput): Promise<string>;

  /**
   * Delete entries for `runId` created more than `olderThanMs` ago. Used by
   * `RunPrivateCacheRepo.clearOlderThan()`. Default throws.
   */
  async deleteRunOlderThan(_runId: string, _olderThanMs: number): Promise<void> {
    throw new Error(
      `${this.constructor.name}: deleteRunOlderThan is not supported by this repository.`
    );
  }

  /**
   * Count entries for `runId`. Used by `RunPrivateCacheRepo.size()` so the
   * wrapper's count reflects only its own run. Default throws.
   */
  async sizeForRun(_runId: string): Promise<number> {
    throw new Error(`${this.constructor.name}: sizeForRun is not supported by this repository.`);
  }

  /**
   * OPTIONAL run-scoped counterpart of {@link saveOutputStreamPort}. Keys one
   * output port's encoded byte stream by `(runId, taskType, inputs, port)` so a
   * streaming task with `kind: "private"` writes through the same sidecar as
   * the deterministic tier without leaking across runs.
   * {@link RunPrivateCacheRepo} forwards to this method when the backing
   * declares it; backings that cannot stream (e.g. a tabular run-private table)
   * omit it and the private tier degrades to accumulation. The returned
   * {@link CacheRef}'s `$ref` is opaque; the SAME backing resolves it via
   * {@link getOutputByRef} / {@link getOutputStreamByRef} and reclaims it when
   * {@link deleteRun} runs for `runId`.
   */
  saveOutputStreamPortForRun?(
    runId: string,
    taskType: string,
    inputs: TaskInput,
    port: string,
    mode: StreamMode,
    chunks: AsyncIterable<Uint8Array>,
    metadata: Record<string, unknown>
  ): Promise<CacheRef>;

  /**
   * OPTIONAL run-scoped reader counterpart of {@link getOutputByRef}. A `ref`
   * that was NOT produced by a `*ForRun` writer for the given `runId` MUST
   * resolve to `undefined` — foreign refs are treated as cache misses, never
   * as errors, to match {@link getOutputByRef}'s idempotency contract.
   * {@link RunPrivateCacheRepo} routes its by-ref reads through this method
   * so a wrapper never resolves another run's blob.
   */
  getOutputByRefForRun?(ref: CacheRef, runId: string): Promise<Blob | undefined>;

  /**
   * OPTIONAL run-scoped streaming reader counterpart of
   * {@link getOutputStreamByRef}. A `ref` that was NOT produced by a `*ForRun`
   * writer for the given `runId` MUST resolve to `undefined`; foreign refs
   * never throw. Same Promise-returning shape as the unscoped variant.
   */
  getOutputStreamByRefForRun?(
    ref: CacheRef,
    runId: string
  ): Promise<AsyncIterable<Uint8Array> | undefined>;

  /**
   * OPTIONAL run-scoped counterpart of {@link deleteOutputByRef}. A `ref` that
   * was NOT produced by a `*ForRun` writer for the given `runId` MUST be a
   * no-op — foreign refs never touch disk / storage, matching the base
   * contract's best-effort idempotency (no throw on missing entry).
   */
  deleteOutputByRefForRun?(ref: CacheRef, runId: string): Promise<void>;
}
