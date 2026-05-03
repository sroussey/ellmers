/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPortCodec } from "@workglow/util";
import type { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { ITask } from "./ITask";
import type { StreamEvent } from "./StreamTypes";
import { Task } from "./Task";
import type { TaskInput, TaskOutput } from "./TaskTypes";
import type { TaskRunContext } from "./TaskRunContext";

interface SchemaProperties {
  properties?: Record<string, { format?: string }>;
}

/**
 * @internal
 * Cache key normalization, lookup, save, and cache-hit stream-event emission
 * for streamable tasks. The three previously module-private helpers
 * (serializeOutputPorts, deserializeOutputPorts, normalizeInputsForCacheKey)
 * are private statics here.
 *
 * outputCache is passed as a method argument (not stored as a class field)
 * because the facade resolves it per-run in handleStart and may differ
 * between runs.
 */
export class CacheCoordinator<Input extends TaskInput, Output extends TaskOutput> {
  constructor(private readonly task: ITask<Input, Output, any>) {}

  /**
   * Serializes format-annotated input properties (via their port codecs) so the
   * resulting object is a stable, serialization-equivalent representation
   * suitable for use as a cache key. Properties without a format annotation are
   * passed through unchanged. No-op when no cache is configured.
   */
  async buildKey(inputs: Input, outputCache: TaskOutputRepository | undefined): Promise<Input> {
    if (!outputCache) return inputs;
    const inputSchema = (this.task.constructor as typeof Task).inputSchema();
    return (await CacheCoordinator.normalizeInputsForCacheKey(
      inputs as Record<string, unknown>,
      inputSchema as unknown as SchemaProperties
    )) as Input;
  }

  /**
   * Looks up a cached output. On a hit for a streaming task, also emits the
   * synthetic stream_start / stream_chunk(finish) / stream_end events so
   * downstream consumers see the same event shape as a fresh run.
   *
   * Returns the deserialized output if found, undefined otherwise.
   */
  async lookup(
    keyInputs: Input,
    outputCache: TaskOutputRepository | undefined,
    isStreamable: boolean,
    ctx: TaskRunContext
  ): Promise<Output | undefined> {
    if (!outputCache || !this.task.cacheable) return undefined;

    const cached = await outputCache.getOutput(this.task.type, keyInputs);
    if (cached === undefined) return undefined;

    const outputSchema = (this.task.constructor as typeof Task).outputSchema();
    const outputs = (await CacheCoordinator.deserializeOutputPorts(
      cached as Record<string, unknown>,
      outputSchema as unknown as SchemaProperties
    )) as Output;

    ctx.telemetrySpan?.addEvent("workglow.task.cache_hit");

    if (isStreamable) {
      this.task.runOutputData = outputs;
      this.task.emit("stream_start");
      this.task.emit("stream_chunk", { type: "finish", data: outputs } as StreamEvent);
      this.task.emit("stream_end", outputs);
    } else {
      this.task.runOutputData = outputs;
    }

    return outputs;
  }

  /**
   * Serializes and saves output. No-op when no cache is configured or task is
   * not cacheable.
   */
  async save(
    keyInputs: Input,
    output: Output,
    outputCache: TaskOutputRepository | undefined
  ): Promise<void> {
    if (!outputCache || !this.task.cacheable || output === undefined) return;
    const outputSchema = (this.task.constructor as typeof Task).outputSchema();
    const wireOutputs = await CacheCoordinator.serializeOutputPorts(
      output as Record<string, unknown>,
      outputSchema as unknown as SchemaProperties
    );
    await outputCache.saveOutput(this.task.type, keyInputs, wireOutputs as Output);
  }

  // ========================================================================
  // Private static helpers (lifted from current module-private functions in
  // TaskRunner.ts)
  // ========================================================================

  private static async serializeOutputPorts(
    output: Record<string, unknown>,
    schema: SchemaProperties
  ): Promise<Record<string, unknown>> {
    if (!schema?.properties) return output;
    const out: Record<string, unknown> = { ...output };
    for (const [key, prop] of Object.entries(schema.properties)) {
      const codec = prop.format ? getPortCodec(prop.format) : undefined;
      if (codec && out[key] !== undefined) {
        out[key] = await codec.serialize(out[key]);
      }
    }
    return out;
  }

  private static async deserializeOutputPorts(
    output: Record<string, unknown>,
    schema: SchemaProperties
  ): Promise<Record<string, unknown>> {
    if (!schema?.properties) return output;
    const out: Record<string, unknown> = { ...output };
    for (const [key, prop] of Object.entries(schema.properties)) {
      const codec = prop.format ? getPortCodec(prop.format) : undefined;
      if (codec && out[key] !== undefined) {
        out[key] = await codec.deserialize(out[key]);
      }
    }
    return out;
  }

  private static async normalizeInputsForCacheKey(
    inputs: Record<string, unknown>,
    schema: SchemaProperties
  ): Promise<Record<string, unknown>> {
    if (!schema?.properties) return inputs;
    const out: Record<string, unknown> = { ...inputs };
    for (const [key, prop] of Object.entries(schema.properties)) {
      const codec = prop.format ? getPortCodec(prop.format) : undefined;
      if (codec && out[key] !== undefined) {
        out[key] = await codec.serialize(out[key]);
      }
    }
    return out;
  }
}
