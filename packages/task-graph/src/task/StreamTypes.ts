/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema, JsonSchema } from "@workglow/util/schema";

/**
 * Stream mode determines how a task's streaming output is interpreted:
 * - `none`: No streaming (default). `execute()` returns `Promise<Output>`.
 * - `append`: Each chunk is a delta (e.g., a new token).
 * - `replace`: Each chunk is a corrected/revised snapshot of the complete output so far.
 * - `object`: Each chunk is a progressively more complete partial object snapshot.
 * - `binary`: Each chunk is an ordered byte slice; consumer concatenates into a Blob/ArrayBuffer.
 * - `mixed`: Multiple ports use different stream modes (e.g., append + object).
 *
 * Declared per-port via the `x-stream` schema extension property.
 * Absent `x-stream` = `"none"`.
 */
export type StreamMode = "none" | "append" | "replace" | "object" | "binary" | "mixed";

/**
 * Append mode: delta chunk (consumer accumulates).
 * `port` identifies which output port this delta belongs to.
 */
export type StreamTextDelta = {
  type: "text-delta";
  port: string;
  textDelta: string;
};

/**
 * Object delta for structured/object streaming.
 * `port` identifies which output port this delta belongs to.
 *
 * - **Non-array** (e.g. structured generation): each `objectDelta` is a
 *   progressively more complete partial object snapshot. Consumers should
 *   replace (not merge) their state with the latest delta.
 * - **Array** (e.g. tool calls): each `objectDelta` is a single-element
 *   array containing one item to upsert by `id` into the accumulated array.
 */
export type StreamObjectDelta = {
  type: "object-delta";
  port: string;
  objectDelta: Record<string, unknown> | unknown[];
};

/**
 * Binary mode: an ordered, append-only chunk of bytes (consumer concatenates).
 * `port` identifies which output port this delta belongs to. Chunks are
 * materialized on `finish` into a `Blob` or `ArrayBuffer` per the port's
 * schema `format` (see `materializeBinary`).
 */
export type StreamBinaryDelta = {
  type: "binary-delta";
  port: string;
  binaryDelta: Uint8Array;
};

/**
 * Replace mode: full snapshot chunk (replaces previous state).
 */
export type StreamSnapshot<Output = Record<string, any>> = {
  type: "snapshot";
  data: Output;
};

/**
 * Signals that the stream has finished. In append mode, the runner
 * accumulates text-delta chunks into the append port (determined by
 * the output schema's `x-stream: "append"` annotation); `data` may
 * carry additional fields (merged into the final output).
 * In replace mode, `data` contains the final output.
 */
export type StreamFinish<Output = Record<string, any>> = {
  type: "finish";
  data: Output;
};

/**
 * Signals that the stream encountered an error.
 */
export type StreamError = {
  type: "error";
  error: Error;
};

/**
 * Phase / status event yielded by a streaming source to signal a named
 * phase transition (e.g. "Preparing", "Generating", "Tool: search").
 *
 * Carries an optional `progress` percentage for phases where progress
 * is measurable (e.g. "Loading model" with fractional percent), or
 * absent for indeterminate phases.
 *
 * Phase events are metadata, not data:
 *  - They are emitted on `stream_chunk` for observability.
 *  - They are NOT accumulated into dataflow edges.
 *  - They are NOT included in the `finish` payload.
 *  - The TaskRunner translates each phase event into a single
 *    `progress` event with the phase's `progress` and `message`.
 *  - They do NOT flip the task status to STREAMING; only data events
 *    (`text-delta` / `object-delta` / `snapshot`) do.
 */
export type StreamPhase = {
  type: "phase";
  message: string;
  progress: number | undefined;
};

/**
 * Discriminated union of all stream event types.
 * Used as the element type for `AsyncIterable<StreamEvent>` streams
 * flowing through the DAG.
 */
export type StreamEvent<Output = Record<string, any>> =
  | StreamTextDelta
  | StreamObjectDelta
  | StreamBinaryDelta
  | StreamSnapshot<Output>
  | StreamFinish<Output>
  | StreamError
  | StreamPhase;

// ========================================================================
// Port-level stream helpers
// ========================================================================

/**
 * Reads the `x-stream` value from a specific port property in a DataPortSchema.
 * Returns `"none"` when the property or the `x-stream` annotation is absent.
 *
 * @param schema - The task's input or output DataPortSchema
 * @param portId - The property name (port ID) to inspect
 * @returns The StreamMode declared on that port
 */
export function getPortStreamMode(schema: DataPortSchema | JsonSchema, portId: string): StreamMode {
  if (typeof schema === "boolean") return "none";
  const prop = (schema.properties as Record<string, any>)?.[portId];
  if (!prop || typeof prop === "boolean") return "none";
  const xStream = prop["x-stream"];
  if (xStream === "append" || xStream === "replace" || xStream === "object" || xStream === "binary")
    return xStream;
  return "none";
}

/**
 * Returns all ports that declare an `x-stream` annotation, along with their mode.
 *
 * @param schema - The task's output (or input) DataPortSchema
 * @returns Array of `{ port, mode }` for every annotated port
 */
export function getStreamingPorts(
  schema: DataPortSchema
): Array<{ port: string; mode: StreamMode }> {
  if (typeof schema === "boolean") return [];
  const props = schema.properties;
  if (!props) return [];

  const result: Array<{ port: string; mode: StreamMode }> = [];
  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop === "boolean") continue;
    const xStream = (prop as any)["x-stream"];
    if (
      xStream === "append" ||
      xStream === "replace" ||
      xStream === "object" ||
      xStream === "binary"
    ) {
      result.push({ port: name, mode: xStream });
    }
  }
  return result;
}

/**
 * Returns the dominant output stream mode for a task by inspecting its output schema.
 * Returns `"mixed"` when ports use different modes (e.g., append + object).
 * Returns `"none"` if no output port declares streaming.
 */
export function getOutputStreamMode(outputSchema: DataPortSchema): StreamMode {
  const ports = getStreamingPorts(outputSchema);
  if (ports.length === 0) return "none";

  const mode = ports[0].mode;
  for (let i = 1; i < ports.length; i++) {
    if (ports[i].mode !== mode) {
      return "mixed";
    }
  }
  return mode;
}

/**
 * Determines whether a task supports streaming by checking if any output port
 * has an `x-stream` annotation AND the task implements `executeStream()`.
 *
 * @param task - The task to inspect (must have `outputSchema()` and optionally `executeStream`)
 * @returns true if the task can produce streaming output
 */
export function isTaskStreamable(task: {
  outputSchema(): DataPortSchema;
  executeStream?: (...args: any[]) => any;
}): boolean {
  if (typeof task.executeStream !== "function") return false;
  return getOutputStreamMode(task.outputSchema()) !== "none";
}

/**
 * Returns the port ID (property name) of the first output port that declares
 * `x-stream: "append"`, or `undefined` if no such port exists.
 *
 * @param schema - The task's output DataPortSchema
 * @returns The port name with append streaming, or undefined
 */
export function getAppendPortId(schema: DataPortSchema): string | undefined {
  if (typeof schema === "boolean") return undefined;
  const props = schema.properties;
  if (!props) return undefined;

  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop === "boolean") continue;
    if ((prop as any)["x-stream"] === "append") return name;
  }
  return undefined;
}

/**
 * Determines whether a dataflow edge needs to accumulate stream events
 * into a materialized value for the target port.
 *
 * Accumulation is needed when:
 * - The source output port declares streaming (`x-stream` is set)
 * - AND the target input port does NOT accept the same stream mode
 *
 * @param sourceSchema - Output schema of the source task
 * @param sourcePort - Port ID on the source task
 * @param targetSchema - Input schema of the target task
 * @param targetPort - Port ID on the target task
 * @returns true if the edge should accumulate; false if stream can pass through
 */
export function edgeNeedsAccumulation(
  sourceSchema: DataPortSchema,
  sourcePort: string,
  targetSchema: DataPortSchema,
  targetPort: string
): boolean {
  const sourceMode = getPortStreamMode(sourceSchema, sourcePort);
  if (sourceMode === "none") return false;
  const targetMode = getPortStreamMode(targetSchema, targetPort);
  return sourceMode !== targetMode;
}

/**
 * Returns the port ID (property name) of the first output port that declares
 * `x-stream: "object"`, or `undefined` if no such port exists.
 *
 * @param schema - The task's output DataPortSchema
 * @returns The port name with object streaming, or undefined
 */
export function getObjectPortId(schema: DataPortSchema): string | undefined {
  if (typeof schema === "boolean") return undefined;
  const props = schema.properties;
  if (!props) return undefined;

  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop === "boolean") continue;
    if ((prop as any)["x-stream"] === "object") return name;
  }
  return undefined;
}

/**
 * Returns the port ID (property name) of the first output port that declares
 * `x-stream: "binary"`, or `undefined` if no such port exists.
 *
 * @param schema - The task's output DataPortSchema
 * @returns The port name with binary streaming, or undefined
 */
export function getBinaryPortId(schema: DataPortSchema): string | undefined {
  if (typeof schema === "boolean") return undefined;
  const props = schema.properties;
  if (!props) return undefined;

  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop === "boolean") continue;
    if ((prop as any)["x-stream"] === "binary") return name;
  }
  return undefined;
}

/**
 * Canonical vocabulary for the `format` annotation on a binary streaming output
 * port. `"blob"` materializes chunks into a `Blob` (the default); `"binary"`
 * materializes them into an `ArrayBuffer`. Any other value is rejected at
 * registration time (see {@link assertBinaryFormat}) so a typo like `"Blob"`
 * cannot silently fall through to the ArrayBuffer branch.
 */
export type BinaryFormat = "blob" | "binary";

/**
 * Reads the `format` annotation of a single output port from the task's output
 * schema. Returns the raw string (or `undefined`) — callers needing the
 * canonical {@link BinaryFormat} vocabulary should go through
 * {@link assertBinaryFormat}, which rejects unknown values.
 */
export function getBinaryPortFormat(schema: DataPortSchema, port: string): string | undefined {
  if (typeof schema === "boolean") return undefined;
  const prop = (schema.properties as Record<string, any>)?.[port];
  if (!prop || typeof prop === "boolean") return undefined;
  return prop.format as string | undefined;
}

/**
 * Resolves the `format` annotation on a binary streaming port to a canonical
 * {@link BinaryFormat}. `undefined` and `"blob"` both resolve to `"blob"`;
 * `"binary"` resolves to `"binary"`. Anything else throws — a casing typo such
 * as `"Blob"` or a leftover legacy value would otherwise be silently coerced
 * to one branch and produce the wrong runtime type, so this is checked at
 * task-registration time and again on the streaming hot paths.
 */
export function assertBinaryFormat(schema: DataPortSchema, port: string): BinaryFormat {
  const f = getBinaryPortFormat(schema, port);
  if (f === undefined || f === "blob") return "blob";
  if (f === "binary") return "binary";
  throw new Error(
    `Port "${port}" has x-stream:"binary" but format:"${f}". Allowed: "blob" | "binary".`
  );
}

/**
 * Materializes ordered binary chunks into the value type declared by the
 * output port's canonical {@link BinaryFormat}:
 *  - `"blob"`   → `Blob` (the default)
 *  - `"binary"` → `ArrayBuffer`
 *
 * Chunks are concatenated in arrival order. Callers MUST pass chunks in the
 * order they were emitted, and MUST resolve `format` through
 * {@link assertBinaryFormat} so unknown values are rejected at registration
 * rather than reinterpreted here.
 *
 * @param chunks - Ordered binary chunks to concatenate
 * @param format - Canonical binary format selector
 * @returns The materialized `Blob` or `ArrayBuffer`
 */
export function materializeBinary(
  chunks: readonly Uint8Array[],
  format: BinaryFormat
): Blob | ArrayBuffer {
  if (format === "blob") return new Blob(chunks as unknown as BlobPart[]);
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
}

/**
 * Returns a map of port names to their JSON Schemas for every output port
 * that declares `"x-structured-output": true`.
 *
 * @param schema - The task's output DataPortSchema
 * @returns Map of port-name → JSON Schema for structured output ports
 */
export function getStructuredOutputSchemas(schema: DataPortSchema): Map<string, JsonSchema> {
  const result = new Map<string, JsonSchema>();
  if (typeof schema === "boolean") return result;
  const props = schema.properties;
  if (!props) return result;

  for (const [name, prop] of Object.entries(props)) {
    if (!prop || typeof prop === "boolean") continue;
    if ((prop as any)["x-structured-output"] === true) {
      result.set(name, prop as JsonSchema);
    }
  }
  return result;
}

/**
 * Returns true if the schema has any output port with `"x-structured-output": true`.
 */
export function hasStructuredOutput(schema: DataPortSchema): boolean {
  return getStructuredOutputSchemas(schema).size > 0;
}
