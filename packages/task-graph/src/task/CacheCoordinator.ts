/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PortCodec } from "@workglow/util";
import { getLogger, getPortCodec } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { type CachePolicy, isPolicyCached, isPolicyPrivate } from "../cache/CachePolicy";
import type { CacheRef } from "../cache/CacheRef";
import { isCacheRef, makeCacheRef } from "../cache/CacheRef";
import type { CacheRegistry } from "../cache/CacheRegistry";
import { RunPrivateCacheRepo } from "../cache/RunPrivateCacheRepo";
import { streamRefViaBacking } from "../cache/resolveRef";
import { getStreamPortCodec } from "../cache/streamCodec";
import type { TaskOutputRepository } from "../storage/TaskOutputRepository";
import type { ITask } from "./ITask";
import type { BinaryRefSink, StreamSink } from "./StreamProcessor";
import type { StreamEvent } from "./StreamTypes";
import {
  assertBinaryFormat,
  CACHE_HIT_USAGE,
  foldObjectDelta,
  getPortStreamMode,
  getStreamingPorts,
  isDeltaStreamMode,
  materializeBinary,
  REFUSAL_OUTPUT_KEY,
  USAGE_OUTPUT_KEY,
} from "./StreamTypes";
import type { TaskRunContext } from "./TaskRunContext";
import type { TaskInput, TaskOutput } from "./TaskTypes";
import { TaskStatus } from "./TaskTypes";

interface SchemaProperties {
  properties?: Record<string, { format?: string }>;
}

/**
 * Graph-computed consumer hints driving cache-hit behavior for binary
 * {@link CacheRef} output ports: hydrate bytes into the enriched finish event
 * for materializing consumers, replay chunked `binary-delta` events for
 * stream-capable consumers, or (neither flag set) leave refs untouched.
 */
export interface CacheReplayContext {
  readonly hasMaterializingConsumers: boolean;
  readonly hasStreamingConsumers: boolean;
  /**
   * Graph-installed producer park for gated passthrough edges (see
   * {@link IRunConfig.edgeBackpressure}). When present, cache-hit replay
   * awaits it after each emitted delta so a slow consumer paces the replay
   * exactly as it paces a fresh run; absent, replay is read-speed.
   */
  readonly edgeBackpressure?: (port?: string) => Promise<void>;
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
   *
   * IMPORTANT: this relies on each `PortCodec.serialize` producing a
   * DETERMINISTIC wire form for equal inputs. The PortCodec contract does not
   * itself guarantee determinism — a codec that embeds a timestamp, a fresh id,
   * or non-canonical ordering will fingerprint differently every run, so the
   * deterministic cache silently never hits for that port. Codecs used on
   * cacheable input ports MUST serialize deterministically.
   *
   * The reserved sentinel field `__cv` (cache version) is injected into the
   * normalized object before fingerprinting so that bumping a task's `static
   * version` automatically invalidates its cached outputs. Tasks must never
   * declare an input port named `__cv`.
   */
  async buildKey(inputs: Input, outputCache: TaskOutputRepository | undefined): Promise<Input> {
    if (!outputCache) return inputs;
    // Instance schema, not the static one: dynamic-schema tasks add ports at
    // runtime, and the key must normalize the same ports the save/lookup
    // paths serialize.
    const inputSchema = this.task.inputSchema();
    const normalized = await CacheCoordinator.normalizeInputsForCacheKey(
      inputs as Record<string, unknown>,
      inputSchema as unknown as SchemaProperties
    );
    (normalized as Record<string, unknown>).__cv = this.task.getCacheVersion();
    return normalized as Input;
  }

  /**
   * Looks up a cached output. On a hit for a streaming task, also emits the
   * synthetic stream_start / stream_chunk(finish) / stream_end events so
   * downstream consumers see the same event shape as a fresh run.
   *
   * Returns the deserialized output if found, undefined otherwise.
   */
  /**
   * Cache identity for the `taskType` axis of {@link TaskOutputRepository}.
   *
   * Deterministic entries key by task class. Private (run-resume) entries
   * normally key by task instance id so two nodes of the same type in one
   * graph do not collide — but only when the id is stable across restarts.
   * When the id is the autogenerated v4 UUID default (no caller pin), a
   * restart would mint a fresh id and orphan every prior row, so we fall
   * back to the task type to preserve a best-effort intra-type crash-resume.
   * The fallback is announced once per process via {@link RunPrivateCacheRepo}.
   */
  private cacheIdentityKey(policy: CachePolicy, outputCache: TaskOutputRepository): string {
    if (!isPolicyPrivate(policy)) return this.task.type;
    if (this.task.hasDeterministicId()) return String(this.task.id);
    if (outputCache instanceof RunPrivateCacheRepo) outputCache.noteFallbackKey();
    return this.task.type;
  }

  async lookup(
    keyInputs: Input,
    outputCache: TaskOutputRepository | undefined,
    policy: CachePolicy,
    isStreamable: boolean,
    ctx: TaskRunContext,
    replay?: CacheReplayContext
  ): Promise<Output | undefined> {
    if (!outputCache || !this.task.cacheable) return undefined;

    // A corrupt stored value or a codec/schema drift can make getOutput or
    // deserializeOutputPorts throw. Caching is a transparent optimization: a bad
    // entry should cost at most a recompute, never convert a runnable task into a
    // hard failure. Degrade any decode failure to a cache miss (the deterministic
    // path is safe to recompute by definition).
    // Instance schema, not the static one: a dynamic-schema task's
    // streaming/format ports may not exist on the static schema, and the
    // fresh-run write path (sinks, threshold hydration) keys off the instance
    // schema.
    const outputSchema = this.task.outputSchema();
    let cached: unknown;
    let outputs: Output;
    try {
      cached = await outputCache.getOutput(this.cacheIdentityKey(policy, outputCache), keyInputs);
      if (cached === undefined) return undefined;

      outputs = (await CacheCoordinator.deserializeOutputPorts(
        cached as Record<string, unknown>,
        outputSchema
      )) as Output;
    } catch (err) {
      getLogger().warn(
        `CacheCoordinator: failed to read/decode cached output for ${this.task.type}; treating as cache miss`,
        { error: err }
      );
      return undefined;
    }

    ctx.telemetrySpan?.addEvent("workglow.task.cache_hit");

    // A replayed output spent nothing. Stating that explicitly is what lets a UI
    // show "cached" instead of an empty cell that means "no model ran".
    this.task.runUsage = CACHE_HIT_USAGE;
    try {
      this.task.emit("usage", CACHE_HIT_USAGE, this.task.runUsageModelId);
    } catch (err) {
      getLogger().error("usage listener threw", { taskId: this.task.id, error: err });
    }

    if (isStreamable) {
      // A corrupt stored stream or a backing that throws mid-resolution must
      // degrade to a miss exactly like the row-decode guard above: caching is
      // a transparent optimization, and a bad entry should cost at most a
      // recompute, never a hard failure.
      let replayed: "none" | "handled" | "miss";
      try {
        replayed = await this.replayStreamRefs(outputs, outputCache, outputSchema, replay);
      } catch (err) {
        getLogger().warn(
          `CacheCoordinator: failed to replay cached stream refs for ${this.task.type}; treating as cache miss`,
          { error: err }
        );
        return undefined;
      }
      // A dangling ref converts the hit into a miss: the caller re-executes
      // and the rewrite self-heals the cache entry.
      if (replayed === "miss") return undefined;
      if (replayed === "none") {
        this.task.runOutputData = outputs;
        this.task.emit("stream_start");
        this.task.emit("stream_chunk", { type: "finish", data: outputs } as StreamEvent);
        this.task.emit("stream_end", outputs);
      }
    } else {
      this.task.runOutputData = outputs;
    }

    return outputs;
  }

  /**
   * Cache-hit stream-out for {@link CacheRef} output ports of any streamable
   * mode (`append` / `object` / `binary`).
   *
   * Mirrors the fresh-run event contract: the emitted finish event carries the
   * materialized value (string / folded object / `Blob`/`ArrayBuffer`) for
   * consumers that need it, while the returned output keeps the small ref at the
   * port slot. When a stream-capable consumer exists, the cached bytes are
   * re-emitted as the mode's delta events first (binary chunked directly;
   * append/object decoded through the per-mode codec).
   *
   * Returns:
   *  - `"none"`    — nothing to replay (no refs at streamable ports, or no
   *                  consumer hint set); caller emits the default synthetic
   *                  finish.
   *  - `"handled"` — events were emitted here; caller must not re-emit.
   *  - `"miss"`    — a ref no longer resolves; caller treats the lookup as a
   *                  cache miss.
   */
  private async replayStreamRefs(
    outputs: Output,
    outputCache: TaskOutputRepository,
    outputSchema: DataPortSchema,
    replay: CacheReplayContext | undefined
  ): Promise<"none" | "handled" | "miss"> {
    const needBytes = replay?.hasMaterializingConsumers === true;
    const replayDeltas = replay?.hasStreamingConsumers === true;
    if (!needBytes && !replayDeltas) return "none";
    if (outputs === null || typeof outputs !== "object") return "none";

    const source = outputs as Record<string, unknown>;
    const refPorts = getStreamingPorts(outputSchema).filter(
      (p) => isDeltaStreamMode(p.mode) && isCacheRef(source[p.port])
    );
    if (refPorts.length === 0) return "none";

    // Resolve every ref before emitting any event so a dangling ref becomes a
    // clean miss with zero observable side effects. allSettled (not all) so a
    // failed resolution cannot strand the streams that DID open — a backing
    // may hold a file handle per resolved stream, and every fulfilled one
    // must be released before the lookup degrades, wherever it sits relative
    // to the failure.
    const settled = await Promise.allSettled(
      refPorts.map(async ({ port }) => ({
        port,
        stream: await streamRefViaBacking(source[port] as CacheRef, outputCache),
      }))
    );
    const streams = new Map<string, AsyncIterable<Uint8Array>>();
    let sawFailure = false;
    let failure: unknown;
    let sawDangling = false;
    for (const entry of settled) {
      if (entry.status === "rejected") {
        sawFailure = true;
        failure = entry.reason;
        continue;
      }
      if (entry.value.stream === undefined) {
        sawDangling = true;
        continue;
      }
      streams.set(entry.value.port, entry.value.stream);
    }
    if (sawFailure || sawDangling) {
      for (const s of streams.values()) {
        void s[Symbol.asyncIterator]().return?.(undefined);
      }
      // A resolver throw is anomalous — surface it to lookup's replay guard,
      // which warns and treats it as a miss. A dangling ref is the expected
      // self-heal path and misses quietly.
      if (sawFailure) throw failure;
      return "miss";
    }

    this.task.runOutputData = outputs;
    this.task.emit("stream_start");
    // Flipping to STREAMING before the first data event is what makes the
    // graph runner attach edge streams (same contract as StreamProcessor).
    this.task.status = TaskStatus.STREAMING;
    this.task.emit("status", this.task.status);

    // Replay pacing: on a gated passthrough edge, await the consumer's gate
    // after each emitted delta so a cache hit honors the same memory bound as
    // a fresh run. Ungated consumers replay at read speed, matching the
    // fresh-run edge enqueue behavior.
    const pace = replay?.edgeBackpressure;
    const finishData: Record<string, unknown> = { ...source };
    for (const { port, mode } of refPorts) {
      const stream = streams.get(port)!;
      if (mode === "binary") {
        // Stream chunk-by-chunk; whole-artifact buffering happens only when a
        // materializing consumer needs the settled value.
        const chunks: Uint8Array[] | undefined = needBytes ? [] : undefined;
        for await (const chunk of stream) {
          chunks?.push(chunk);
          if (replayDeltas) {
            this.task.emit("stream_chunk", {
              type: "binary-delta",
              port,
              binaryDelta: chunk,
            } as StreamEvent);
            if (pace) await pace(port);
          }
        }
        if (chunks !== undefined) {
          finishData[port] = materializeBinary(chunks, assertBinaryFormat(outputSchema, port));
        }
      } else {
        // append / object: decode the byte stream once — emit each delta to
        // any stream-capable consumer and fold it into the settled value when
        // a materializing consumer needs it. No whole-log buffering.
        const codec = getStreamPortCodec(mode);
        let text = "";
        let folded: Record<string, unknown> | unknown[] | undefined;
        for await (const ev of codec.decode(stream, port)) {
          if (replayDeltas) {
            this.task.emit("stream_chunk", ev as StreamEvent);
            if (pace) await pace(port);
          }
          if (needBytes) {
            if (ev.type === "text-delta") text += ev.textDelta;
            else if (ev.type === "object-delta") folded = foldObjectDelta(folded, ev.objectDelta);
          }
        }
        if (needBytes) {
          finishData[port] = mode === "append" ? text : folded;
        }
      }
    }
    this.task.emit("stream_chunk", { type: "finish", data: finishData } as StreamEvent);
    this.task.emit("stream_end", finishData);
    return "handled";
  }

  /**
   * Serializes and saves output. No-op when no cache is configured or task is
   * not cacheable.
   */
  async save(
    keyInputs: Input,
    output: Output,
    outputCache: TaskOutputRepository | undefined,
    policy: CachePolicy
  ): Promise<void> {
    if (!outputCache || !this.task.cacheable || output === undefined) return;
    // Never memoize a refused output: a transient refusal (e.g. a safety-classifier
    // flake) would otherwise replay as "the answer" until a cache-version bump.
    if (
      output !== null &&
      typeof output === "object" &&
      (output as Record<string, unknown>)[REFUSAL_OUTPUT_KEY]
    ) {
      return;
    }
    // Token counts are a fact about ONE execution, not about the value. Serving
    // this entry later costs zero tokens, so replaying the original counts would
    // invent spend that never happened. Unlike a refusal (which blocks the save
    // entirely), the value itself is still worth memoizing — strip the field.
    const outputSchema = this.task.outputSchema();
    const wireOutputs = await CacheCoordinator.serializeOutputPorts(
      CacheCoordinator.withoutUsage(output as Record<string, unknown>),
      outputSchema
    );
    await outputCache.saveOutput(
      this.cacheIdentityKey(policy, outputCache),
      keyInputs,
      wireOutputs as Output
    );
  }

  // ========================================================================
  // Policy-aware routing methods
  // ========================================================================

  /**
   * Resolve the repository slot to use given a registry and policy. Returns
   * `undefined` if the registry is missing, the policy is `kind: "none"`, or
   * the relevant slot is unregistered. All callers treat `undefined` as "skip
   * caching" — no errors, no warnings.
   */
  private repoFor(
    registry: CacheRegistry | undefined,
    policy: CachePolicy
  ): TaskOutputRepository | undefined {
    if (!registry || !isPolicyCached(policy)) return undefined;
    return isPolicyPrivate(policy) ? registry.private : registry.deterministic;
  }

  public async buildKeyForPolicy(
    inputs: Input,
    registry: CacheRegistry | undefined,
    policy: CachePolicy
  ): Promise<Input> {
    return this.buildKey(inputs, this.repoFor(registry, policy));
  }

  public async lookupByPolicy(
    keyInputs: Input,
    registry: CacheRegistry | undefined,
    policy: CachePolicy,
    isStreamable: boolean,
    ctx: TaskRunContext,
    replay?: CacheReplayContext
  ): Promise<Output | undefined> {
    return this.lookup(
      keyInputs,
      this.repoFor(registry, policy),
      policy,
      isStreamable,
      ctx,
      replay
    );
  }

  public async saveByPolicy(
    keyInputs: Input,
    output: Output,
    registry: CacheRegistry | undefined,
    policy: CachePolicy
  ): Promise<void> {
    return this.save(keyInputs, output, this.repoFor(registry, policy), policy);
  }

  /**
   * Best-effort cleanup of orphan blobs after a row commit fails. When
   * `saveByPolicy` rejects after a stream sink already wrote bytes and minted
   * a {@link CacheRef}, the blob has no row pointing at it and is effectively
   * leaked until the next janitor sweep. Walk every delta-mode streaming port
   * (`append` / `object` / `binary` — all three can carry per-port refs),
   * locate any {@link CacheRef} values, and ask the backing to delete them.
   * Per-ref deletion failures are swallowed — they should not mask the
   * original save error the caller is about to re-throw.
   */
  public async cleanupOrphanBlobsForStreamPorts(
    output: Output,
    registry: CacheRegistry | undefined,
    policy: CachePolicy,
    outputSchema: DataPortSchema
  ): Promise<void> {
    if (output === null || typeof output !== "object") return;
    const cache = this.repoFor(registry, policy);
    if (!cache || typeof cache.deleteOutputByRef !== "function") return;
    const source = output as Record<string, unknown>;
    const refPorts = getStreamingPorts(outputSchema)
      .filter((p) => isDeltaStreamMode(p.mode))
      .map((p) => p.port);
    await Promise.all(
      refPorts.map(async (port) => {
        const value = source[port];
        if (!isCacheRef(value)) return;
        try {
          await cache.deleteOutputByRef!(value);
        } catch {
          // Best-effort: the periodic janitor sweep will reclaim what we miss.
        }
      })
    );
  }

  /**
   * Build the per-port `BinaryRefSink` map the runner passes to
   * `StreamProcessor.run()` so binary streams pipe straight to the cache and
   * `Output` carries a {@link CacheRef} at the port slot.
   *
   * Returns `undefined` when any of the conditions for the ref path are not
   * met: no cache is configured by policy, the cache does not implement
   * `saveOutputStreamPort`, the task is not cacheable, or the output schema has
   * no `x-stream: "binary"` port. This path supports single-binary-port tasks
   * only; tasks with multiple binary ports fall back to the accumulation path.
   *
   * The threshold ({@link IRunConfig.referenceThresholdBytes}) controls
   * whether the ref *survives* in the final Output, not whether the sink
   * runs: when total bytes streamed end up below the threshold, the runner
   * rehydrates the ref to an inline `Blob`/`ArrayBuffer` via
   * {@link hydrateRefsBelowThreshold}. Setting threshold to `0` forces
   * every binary port to a ref regardless of size.
   */
  public getBinaryRefSinksByPolicy(
    keyInputs: Input,
    registry: CacheRegistry | undefined,
    policy: CachePolicy,
    outputSchema: DataPortSchema
  ): ReadonlyMap<string, BinaryRefSink> | undefined {
    if (!this.task.cacheable) return undefined;
    const cache = this.repoFor(registry, policy);
    if (!cache || !cache.supportsStreaming()) return undefined;
    // Without the no-accumulation flag the runner drives at most one sink per
    // task, so a second binary port would have neither a sink nor an
    // accumulator. Enforce the single-binary-port restriction here as well as
    // in the accumulation decision (StreamPump.canStreamBinaryToCache) —
    // multi-port tasks fall back to pure accumulation.
    const binaryPorts = getStreamingPorts(outputSchema).filter((p) => p.mode === "binary");
    if (binaryPorts.length !== 1) return undefined;
    const port = binaryPorts[0].port;
    const taskType = this.task.type;
    // The single-binary case IS the port-aware writer with one binary port, so
    // it adapts here rather than in the repository: this is the one call site
    // that has to synthesize nothing (the port id is already in hand), and a
    // base-class shim would have to invent a port name for a portless
    // signature — reintroducing the second writer this collapsed away.
    //
    // Re-wrap the backing's CacheRef so an implementation that pre-dates the
    // `kind` brand still produces a discriminator-bearing ref. Branded refs
    // pass through unchanged (preserving size/mime hints).
    const sink: BinaryRefSink = async (chunks) => {
      const raw = await cache.saveOutputStreamPort!(
        taskType,
        keyInputs,
        port,
        "binary",
        chunks,
        {}
      );
      return isCacheRef(raw) ? raw : makeCacheRef(raw);
    };
    return new Map([[port, sink]]);
  }

  /**
   * Per-port {@link StreamSink} map for the no-accumulation path: every
   * streamable output port (`append` / `object` / `binary`) gets its own sink
   * keyed by `(taskType, inputs, port)` via {@link TaskOutputRepository.saveOutputStreamPort},
   * so a multi-port task stores each port's bytes independently — no overwrite,
   * no single-binary-port restriction. The {@link StreamProcessor} encodes each
   * port's deltas with the mode codec before handing the bytes to the sink.
   *
   * Returns `undefined` when no cache is configured by policy, the cache does
   * not implement `saveOutputStreamPort`, the task is not cacheable, or the
   * schema has no streamable port. `replace`-mode ports are
   * excluded — a snapshot-driven port has no single-port delta byte stream and
   * stays on the accumulation path.
   */
  public getRefSinksByPolicy(
    keyInputs: Input,
    registry: CacheRegistry | undefined,
    policy: CachePolicy,
    outputSchema: DataPortSchema
  ): ReadonlyMap<string, StreamSink> | undefined {
    if (!this.task.cacheable) return undefined;
    const cache = this.repoFor(registry, policy);
    if (!cache || !cache.supportsStreaming()) return undefined;
    const ports = getStreamingPorts(outputSchema).filter(
      (p) => p.mode === "append" || p.mode === "object" || p.mode === "binary"
    );
    if (ports.length === 0) return undefined;
    const taskType = this.task.type;
    const sinks = new Map<string, StreamSink>();
    for (const { port, mode } of ports) {
      sinks.set(port, {
        mode,
        write: async (chunks) => {
          const raw = await cache.saveOutputStreamPort!(
            taskType,
            keyInputs,
            port,
            mode,
            chunks,
            {}
          );
          return isCacheRef(raw) ? raw : makeCacheRef(raw);
        },
      });
    }
    return sinks;
  }

  /**
   * Post-process the streaming task's `Output`: for every **binary streaming
   * port** (per the schema) whose value is a {@link CacheRef} with
   * `size < referenceThresholdBytes`, rehydrate the bytes via `getOutputByRef`
   * and inline them as `Blob`/`ArrayBuffer` (per the port's `format`
   * annotation). Refs at or above the threshold are left in place.
   * `referenceThresholdBytes === 0` forces every ref to survive regardless of
   * size.
   *
   * Restricted to schema-declared binary streaming ports so that legitimate
   * non-binary fields that happen to carry a `{$ref: string}` shape (e.g. a
   * JSON-Schema reference embedded in metadata) are not mistakenly resolved
   * against the cache.
   *
   * Refs without a known `size` are kept as-is (the writer didn't measure;
   * conservatively assume "large enough to keep as ref"). Backings that want
   * threshold-based rehydration MUST populate `size` on the CacheRef they
   * return from `saveOutputStreamPort`.
   */
  public async hydrateRefsBelowThreshold(
    output: Output,
    registry: CacheRegistry | undefined,
    policy: CachePolicy,
    outputSchema: DataPortSchema,
    referenceThresholdBytes: number
  ): Promise<Output> {
    if (referenceThresholdBytes === 0) return output;
    if (output === null || typeof output !== "object") return output;
    const cache = this.repoFor(registry, policy);
    if (!cache || typeof cache.getOutputByRef !== "function") return output;

    // Every streamable mode can carry a ref now (append/object via the per-port
    // codec, binary via getOutputByRef). Rehydrate a below-threshold ref back to
    // its value: a string for append, the folded array/object for object, a
    // Blob/ArrayBuffer for binary.
    const ports = getStreamingPorts(outputSchema).filter(
      (p) => p.mode === "append" || p.mode === "object" || p.mode === "binary"
    );
    if (ports.length === 0) return output;

    const source = output as Record<string, unknown>;
    let out: Record<string, unknown> | undefined;
    const rehydrations = await Promise.all(
      ports.map(async ({ port, mode }) => {
        const value = source[port];
        if (!isCacheRef(value)) return undefined;
        const size = value.size;
        if (size === undefined || size >= referenceThresholdBytes) return undefined;
        if (mode === "binary") {
          const blob = await cache.getOutputByRef!(value);
          if (blob === undefined) return undefined;
          const format = assertBinaryFormat(outputSchema, port);
          const inlined = format === "binary" ? await blob.arrayBuffer() : blob;
          return { port, inlined };
        }
        // append / object: replay the encoded bytes through the mode codec.
        const stream = await streamRefViaBacking(value, cache);
        if (stream === undefined) return undefined;
        const inlined = await getStreamPortCodec(mode).materialize(stream, port);
        return { port, inlined };
      })
    );
    for (const r of rehydrations) {
      if (!r) continue;
      out ??= { ...source };
      out[r.port] = r.inlined;
    }
    return (out ?? source) as Output;
  }

  // ========================================================================
  // Private static helpers (lifted from current module-private functions in
  // TaskRunner.ts)
  // ========================================================================

  private static withoutUsage(output: Record<string, unknown>): Record<string, unknown> {
    if (output === null || typeof output !== "object" || !(USAGE_OUTPUT_KEY in output)) {
      return output;
    }
    const stripped = { ...output };
    delete stripped[USAGE_OUTPUT_KEY];
    return stripped;
  }

  /**
   * Wire codec for a single output port. An explicit `format` annotation
   * wins; a format-less `x-stream: "binary"` port falls back to the codec of
   * its mode-derived canonical format ({@link assertBinaryFormat} defaults it
   * to `"blob"`). Without the fallback, a JSON-row backing would stringify
   * that port's inline `Blob`/`ArrayBuffer` to `{}` and poison every later
   * cache hit.
   */
  private static outputPortWireCodec(schema: DataPortSchema, port: string): PortCodec | undefined {
    if (typeof schema === "boolean") return undefined;
    const prop = (schema.properties as Record<string, unknown> | undefined)?.[port];
    if (!prop || typeof prop === "boolean") return undefined;
    const format = (prop as { format?: string }).format;
    if (format !== undefined) return getPortCodec(format);
    if (getPortStreamMode(schema, port) === "binary") {
      return getPortCodec(assertBinaryFormat(schema, port));
    }
    return undefined;
  }

  private static async serializeOutputPorts(
    output: Record<string, unknown>,
    schema: DataPortSchema
  ): Promise<Record<string, unknown>> {
    if (typeof schema === "boolean" || !schema?.properties) return output;
    const out: Record<string, unknown> = { ...output };
    for (const key of Object.keys(schema.properties)) {
      const codec = CacheCoordinator.outputPortWireCodec(schema, key);
      if (codec && out[key] !== undefined) {
        out[key] = await codec.serialize(out[key]);
      }
    }
    return out;
  }

  private static async deserializeOutputPorts(
    output: Record<string, unknown>,
    schema: DataPortSchema
  ): Promise<Record<string, unknown>> {
    if (typeof schema === "boolean" || !schema?.properties) return output;
    const out: Record<string, unknown> = { ...output };
    for (const key of Object.keys(schema.properties)) {
      const codec = CacheCoordinator.outputPortWireCodec(schema, key);
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
