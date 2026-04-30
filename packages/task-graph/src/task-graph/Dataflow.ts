/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { areSemanticallyCompatible } from "@workglow/util/schema";
import { EventEmitter } from "@workglow/util";
import type { StreamEvent } from "../task/StreamTypes";
import { TaskError } from "../task/TaskError";
import { DataflowJson } from "../task/TaskJSON";
import { TaskIdType, TaskOutput, TaskStatus } from "../task/TaskTypes";
import { Task } from "../task/Task";
import {
  DataflowEventListener,
  DataflowEventListeners,
  DataflowEventParameters,
  DataflowEvents,
} from "./DataflowEvents";
import { TaskGraph } from "./TaskGraph";
import { TRANSFORM_DEFS, TransformRegistry } from "./TransformRegistry";
import type { ITransformStep } from "./TransformTypes";
import type { ServiceRegistry } from "@workglow/util";

export type DataflowIdType = `${string}[${string}] ==> ${string}[${string}]`;

export const DATAFLOW_ALL_PORTS = "*";
export const DATAFLOW_ERROR_PORT = "[error]";

/**
 * Represents a data flow between two tasks, indicating how one task's output is used as input for another task
 */
export class Dataflow {
  constructor(
    public sourceTaskId: TaskIdType,
    public sourceTaskPortId: string,
    public targetTaskId: TaskIdType,
    public targetTaskPortId: string
  ) {}
  public static createId(
    sourceTaskId: TaskIdType,
    sourceTaskPortId: string,
    targetTaskId: TaskIdType,
    targetTaskPortId: string
  ): DataflowIdType {
    return `${sourceTaskId}[${sourceTaskPortId}] ==> ${targetTaskId}[${targetTaskPortId}]`;
  }
  get id(): DataflowIdType {
    return Dataflow.createId(
      this.sourceTaskId,
      this.sourceTaskPortId,
      this.targetTaskId,
      this.targetTaskPortId
    );
  }
  public value: any = undefined;
  public status: TaskStatus = TaskStatus.PENDING;
  public error: TaskError | undefined;

  /**
   * Active stream for this dataflow edge.
   * Set when a streaming upstream task begins producing chunks.
   * Multiple downstream consumers can each get an independent reader via tee().
   */
  public stream: ReadableStream<StreamEvent> | undefined = undefined;

  /**
   * Most recent per-port snapshot data observed while `stream` was active.
   * Populated by the runner's stream-tap on `snapshot` events; cleared on
   * setStream / reset, or transferred to `value` on setPortData. Distinct
   * from `value` (final materialized output) — `latestSnapshot` is the
   * live mid-stream peek.
   */
  public latestSnapshot: unknown = undefined;

  /**
   * Returns the current effective value of this edge, regardless of
   * streaming state:
   *   1. `value` — set by setPortData / awaitStreamValue when stream finishes.
   *   2. `latestSnapshot` — set by the runner's snapshot tap during streaming.
   *   3. `undefined` — no data yet.
   *
   * Use this in any read path that wants "current edge value, regardless of
   * streaming state." `getPortData()` retains its strict semantics
   * (only `value`) for callers that explicitly need that.
   */
  public getCurrentValue(): unknown {
    if (this.value !== undefined) return this.value;
    return this.latestSnapshot;
  }

  /**
   * Sets the active stream on this dataflow.
   * @param stream The ReadableStream of StreamEvents from the upstream task
   */
  public setStream(stream: ReadableStream<StreamEvent>): void {
    // New stream invalidates any prior peek.
    this.latestSnapshot = undefined;
    this.stream = stream;
  }

  /**
   * Gets the active stream from this dataflow, or undefined if not streaming.
   */
  public getStream(): ReadableStream<StreamEvent> | undefined {
    return this.stream;
  }

  /**
   * Consumes the active stream to completion and materializes the value.
   *
   * Accumulation of text-delta chunks is the responsibility of the **source
   * task** (via TaskRunner.executeStreamingTask when shouldAccumulate=true).
   * When accumulation is needed the source task emits an enriched finish event
   * that carries the fully-assembled port data. All downstream edges share that
   * enriched event through tee'd ReadableStreams, so no edge needs to
   * re-accumulate independently.
   *
   * This method therefore only reads snapshot and finish events:
   * - **snapshot**: used for replace-mode tasks that emit incremental snapshots.
   * - **finish**: the primary materialization path; carries complete data when
   *   the source task accumulated, or provider-level data otherwise.
   * - text-delta / object-delta: ignored here (handled by source task).
   *
   * After consumption the stream reference is cleared. Calling this method on
   * a dataflow that has no stream is a no-op.
   */
  public async awaitStreamValue(): Promise<void> {
    if (!this.stream) return;

    const reader = this.stream.getReader();
    let lastSnapshotData: any = undefined;
    let finishData: any = undefined;
    let streamError: Error | undefined;

    try {
      while (true) {
        const { done, value: event } = await reader.read();
        if (done) break;

        switch (event.type) {
          case "snapshot":
            lastSnapshotData = event.data;
            break;
          case "finish":
            finishData = event.data;
            break;
          case "error":
            streamError = event.error;
            break;
          // text-delta, object-delta: source task handles accumulation
        }
      }
    } finally {
      reader.releaseLock();
      this.stream = undefined;
    }

    if (streamError) {
      this.error = streamError as TaskError;
      this.setStatus(TaskStatus.FAILED);
      throw streamError;
    }

    // Priority: snapshot > finish.
    // The source task enriches the finish event with accumulated text when
    // shouldAccumulate=true, so finishData carries complete port data.
    if (lastSnapshotData !== undefined) {
      this.setPortData(lastSnapshotData);
    } else if (finishData !== undefined) {
      this.setPortData(finishData);
    }
  }

  public reset() {
    this.latestSnapshot = undefined;
    this.status = TaskStatus.PENDING;
    this.error = undefined;
    this.value = undefined;
    this.stream = undefined;
    this._compatibilityCache = undefined;
    this.emit("reset");
    this.emit("status", this.status);
  }

  public setStatus(status: TaskStatus) {
    if (status === this.status) return;
    this.status = status;
    switch (status) {
      case TaskStatus.PROCESSING:
        this.emit("start");
        break;
      case TaskStatus.STREAMING:
        this.emit("streaming");
        break;
      case TaskStatus.COMPLETED:
        this.emit("complete");
        break;
      case TaskStatus.ABORTING:
        this.emit("abort");
        break;
      case TaskStatus.PENDING:
        this.emit("reset");
        break;
      case TaskStatus.FAILED:
        this.emit("error", this.error!);
        break;
      case TaskStatus.DISABLED:
        this.emit("disabled");
        break;
    }
    this.emit("status", this.status);
  }

  setPortData(entireDataBlock: any) {
    if (this.sourceTaskPortId === DATAFLOW_ALL_PORTS) {
      this.value = entireDataBlock;
    } else if (this.sourceTaskPortId === DATAFLOW_ERROR_PORT) {
      this.error = entireDataBlock;
    } else {
      this.value = entireDataBlock[this.sourceTaskPortId];
    }
    // The materialised value supersedes the mid-stream peek; clear the slot.
    this.latestSnapshot = undefined;
  }

  getPortData(): TaskOutput {
    let result: TaskOutput;
    if (this.targetTaskPortId === DATAFLOW_ALL_PORTS) {
      result = this.value;
    } else if (this.targetTaskPortId === DATAFLOW_ERROR_PORT) {
      result = { [DATAFLOW_ERROR_PORT]: this.error };
    } else {
      result = { [this.targetTaskPortId]: this.value };
    }
    return result;
  }

  toJSON(): DataflowJson {
    const base: DataflowJson = {
      sourceTaskId: this.sourceTaskId,
      sourceTaskPortId: this.sourceTaskPortId,
      targetTaskId: this.targetTaskId,
      targetTaskPortId: this.targetTaskPortId,
    };
    if (this._transforms.length > 0) {
      base.transforms = this._transforms.map((s) => ({ id: s.id, params: s.params }));
    }
    return base;
  }

  /**
   * Cached result of the last semantic compatibility check.
   * Invalidated by calling {@link invalidateCompatibilityCache}.
   */
  protected _compatibilityCache?: "static" | "runtime" | "incompatible";

  /**
   * Transform steps applied to data flowing through this dataflow.
   */
  private _transforms: Array<ITransformStep> = [];

  /**
   * Returns the list of transform steps applied to this dataflow.
   */
  getTransforms(): ReadonlyArray<ITransformStep> {
    return this._transforms;
  }

  /**
   * Replaces the transform chain with the given steps and invalidates the compatibility cache.
   * Accepts either strict {@link ITransformStep} or steps whose `params` is omitted;
   * omitted `params` is normalised to `undefined`.
   */
  setTransforms(
    steps: ReadonlyArray<{ readonly id: string; readonly params?: Record<string, unknown> }>
  ): void {
    this._transforms = steps.map((s) => ({ id: s.id, params: s.params }));
    this.invalidateCompatibilityCache();
  }

  /**
   * Appends a single transform step to the chain and invalidates the compatibility cache.
   * Accepts either strict {@link ITransformStep} or a step whose `params` is omitted;
   * omitted `params` is normalised to `undefined`.
   */
  addTransform(step: { readonly id: string; readonly params?: Record<string, unknown> }): void {
    this._transforms.push({ id: step.id, params: step.params });
    this.invalidateCompatibilityCache();
  }

  /**
   * Removes the transform step at the given index and invalidates the compatibility cache.
   */
  removeTransform(index: number): void {
    this._transforms.splice(index, 1);
    this.invalidateCompatibilityCache();
  }

  /**
   * Fold the transform chain over `this.value`. On any throw, sets
   * `this.error` and TaskStatus.FAILED, then re-throws so the caller
   * (typically TaskGraphRunner) fails the run. Without the re-throw the
   * runner's status-push step would overwrite the FAILED edge state with
   * the source task's COMPLETED status, silently delivering corrupt data.
   */
  async applyTransforms(registry: ServiceRegistry): Promise<void> {
    if (this._transforms.length === 0) return;
    const defs = registry.get(TRANSFORM_DEFS);
    let cur: unknown = this.value;
    try {
      for (const step of this._transforms) {
        const def = defs.get(step.id);
        if (!def) {
          throw new Error(`Unknown transform: ${step.id}`);
        }
        cur = await def.apply(cur, step.params ?? {});
      }
      this.value = cur;
    } catch (e) {
      const error =
        e instanceof TaskError ? e : new TaskError(e instanceof Error ? e.message : String(e));
      if (!(e instanceof TaskError) && e instanceof Error && e.stack) {
        error.stack = e.stack;
      }
      this.error = error;
      this.setStatus(TaskStatus.FAILED);
      throw e;
    }
  }

  /**
   * Invalidates the cached semantic compatibility result so the next call
   * to {@link semanticallyCompatible} recomputes it. Call this when
   * either endpoint's schema changes (e.g., in response to a schemaChange event).
   */
  public invalidateCompatibilityCache(): void {
    this._compatibilityCache = undefined;
  }

  semanticallyCompatible(
    graph: TaskGraph,
    dataflow: Dataflow,
    registry?: ServiceRegistry
  ): "static" | "runtime" | "incompatible" {
    const sourceTask = graph.getTask(dataflow.sourceTaskId)!;
    const targetTask = graph.getTask(dataflow.targetTaskId)!;

    // Only use the cache when both endpoint tasks have stable (non-dynamic) schemas.
    // Tasks with dynamic schemas may emit `schemaChange` events, which would make
    // a cached result stale. Checking the static `hasDynamicSchemas` flag (defined
    // on Task with a default of `false`) is sufficient because tasks with stable
    // schemas never emit `schemaChange`. Unknown constructors default to no caching.
    const shouldCache =
      !((sourceTask.constructor as typeof Task).hasDynamicSchemas ?? true) &&
      !((targetTask.constructor as typeof Task).hasDynamicSchemas ?? true);

    if (shouldCache && this._compatibilityCache !== undefined) {
      return this._compatibilityCache;
    }

    const targetSchema = targetTask.inputSchema();
    const sourceSchema = sourceTask.outputSchema();

    if (typeof targetSchema === "boolean") {
      if (targetSchema === false) {
        return "incompatible";
      }
      return "static";
    }
    if (typeof sourceSchema === "boolean") {
      if (sourceSchema === false) {
        return "incompatible";
      }
      return "runtime";
    }

    let targetSchemaProperty =
      DATAFLOW_ALL_PORTS === dataflow.targetTaskPortId
        ? true // Accepts any schema (equivalent to Type.Any())
        : (targetSchema.properties as any)?.[dataflow.targetTaskPortId];
    // If the specific property doesn't exist but additionalProperties is true,
    // treat it as accepting any schema
    if (targetSchemaProperty === undefined && targetSchema.additionalProperties === true) {
      targetSchemaProperty = true;
    }
    let sourceSchemaProperty =
      DATAFLOW_ALL_PORTS === dataflow.sourceTaskPortId
        ? true // Accepts any schema (equivalent to Type.Any())
        : (sourceSchema.properties as any)?.[dataflow.sourceTaskPortId];
    // If the specific property doesn't exist but additionalProperties is true,
    // treat it as outputting any schema
    if (sourceSchemaProperty === undefined && sourceSchema.additionalProperties === true) {
      sourceSchemaProperty = true;
    }

    // Compose source schema through the transform chain before comparing.
    // Resolves transform defs from the same registry used by applyTransforms so
    // that custom TRANSFORM_DEFS overrides are reflected in both places.
    // When the source schema is `true` (accepts any — e.g. a boundary task
    // with `additionalProperties: true`), start the chain from `{}` so
    // transforms can still narrow the effective schema. Without this a chain
    // like `pick → unixToIsoDate` from an InputTask would short-circuit to
    // "static" against any target regardless of the transforms' output type.
    let effectiveSourceSchema = sourceSchemaProperty;
    if (this._transforms.length > 0) {
      const defs = registry ? registry.get(TRANSFORM_DEFS) : TransformRegistry.all;
      try {
        let cur: any = effectiveSourceSchema === true ? {} : effectiveSourceSchema;
        for (const step of this._transforms) {
          const def = defs.get(step.id);
          if (!def) {
            // Do not cache missing transform definitions because the registry
            // supports runtime registration and a later call may become compatible.
            return "incompatible";
          }
          cur = def.inferOutputSchema(cur, step.params ?? {});
        }
        effectiveSourceSchema = cur;
      } catch {
        if (shouldCache) this._compatibilityCache = "incompatible";
        return "incompatible";
      }
    }

    const result = areSemanticallyCompatible(effectiveSourceSchema, targetSchemaProperty);
    if (shouldCache) {
      this._compatibilityCache = result;
    }
    return result;
  }

  // ========================================================================
  // Event handling methods
  // ========================================================================

  /**
   * Event emitter for dataflow events
   */
  public get events(): EventEmitter<DataflowEventListeners> {
    if (!this._events) {
      this._events = new EventEmitter<DataflowEventListeners>();
    }
    return this._events;
  }
  protected _events: EventEmitter<DataflowEventListeners> | undefined;

  public subscribe<Event extends DataflowEvents>(
    name: Event,
    fn: DataflowEventListener<Event>
  ): () => void {
    return this.events.subscribe(name, fn);
  }

  /**
   * Registers an event listener
   */
  public on<Event extends DataflowEvents>(name: Event, fn: DataflowEventListener<Event>): void {
    this.events.on(name, fn);
  }

  /**
   * Removes an event listener
   */
  public off<Event extends DataflowEvents>(name: Event, fn: DataflowEventListener<Event>): void {
    this.events.off(name, fn);
  }

  /**
   * Registers a one-time event listener
   */
  public once<Event extends DataflowEvents>(name: Event, fn: DataflowEventListener<Event>): void {
    this.events.once(name, fn);
  }

  /**
   * Returns a promise that resolves when the specified event is emitted
   */
  public waitOn<Event extends DataflowEvents>(
    name: Event
  ): Promise<DataflowEventParameters<Event>> {
    return this.events.waitOn(name) as Promise<DataflowEventParameters<Event>>;
  }

  /**
   * Emits an event
   */
  public emit<Event extends DataflowEvents>(
    name: Event,
    ...args: DataflowEventParameters<Event>
  ): void {
    this._events?.emit(name, ...args);
  }
}

/**
 * Represents a data flow between two tasks, indicating how one task's output is used as input for another task
 *
 * This is a helper class that parses a data flow id string into a Dataflow object
 *
 * @param dataflow - The data flow string, e.g. "sourceTaskId[sourceTaskPortId] ==> targetTaskId[targetTaskPortId]"
 */
export class DataflowArrow extends Dataflow {
  constructor(dataflow: DataflowIdType) {
    // Parse the dataflow string using regex
    const pattern =
      /^([a-zA-Z0-9-]+?)\[([a-zA-Z0-9-]+?)\] ==> ([a-zA-Z0-9-]+?)\[([a-zA-Z0-9-]+?)\]$/;
    const match = dataflow.match(pattern);

    if (!match) {
      throw new Error(`Invalid dataflow format: ${dataflow}`);
    }

    const [, sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId] = match;
    super(sourceTaskId, sourceTaskPortId, targetTaskId, targetTaskPortId);
  }
}
