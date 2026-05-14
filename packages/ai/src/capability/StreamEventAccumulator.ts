/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent, TaskOutput } from "@workglow/task-graph";

const isNonEmptyObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0;

/**
 * Stateful accumulator that materialises a single output `T` from a sequence
 * of {@link StreamEvent}s. The semantics match the previous `collectStream`
 * exactly:
 *
 * - `text-delta` per port → concatenated per port (`Map<port, string>`).
 * - `object-delta` non-array → replace semantics (each delta is a more
 *   complete partial snapshot — last wins per port).
 * - `object-delta` array → upsert by `id` per port.
 * - `snapshot` → replace running state (last snapshot wins).
 * - `phase` → ignored (metadata only).
 * - `error` → throws immediately at observe time.
 * - `finish` → captured separately via {@link observeFinish}; mandatory before
 *   {@link materialize}.
 *
 * Mixed-mode (both text-delta and object-delta on the same stream) is
 * rejected at materialise time.
 *
 * This accumulator is **only** instantiated at explicit terminal-consumer
 * sites (AiTask.execute, StreamProcessor `ctx.shouldAccumulate` branch). Do
 * not use it inside run-fns, workers, AiJob, strategies, or dataflow nodes —
 * streams in this codebase can be conceptually unbounded.
 */
export class StreamEventAccumulator<T extends TaskOutput = TaskOutput> {
  private readonly textAccumulator = new Map<string, string>();
  private readonly objectAccumulator = new Map<string, Record<string, unknown> | unknown[]>();
  private hasTextDeltas = false;
  private hasObjectDeltas = false;
  private hasSnapshots = false;
  private snapshotAccumulator: T | undefined;
  private finished = false;
  private finishData: T | undefined;

  observe(event: StreamEvent<T>): void {
    switch (event.type) {
      case "text-delta": {
        this.hasTextDeltas = true;
        const e = event as Extract<StreamEvent<T>, { type: "text-delta" }>;
        this.textAccumulator.set(e.port, (this.textAccumulator.get(e.port) ?? "") + e.textDelta);
        return;
      }
      case "object-delta": {
        this.hasObjectDeltas = true;
        const e = event as Extract<StreamEvent<T>, { type: "object-delta" }>;
        const delta = e.objectDelta;
        if (Array.isArray(delta)) {
          const existing = this.objectAccumulator.get(e.port);
          const arr: unknown[] = Array.isArray(existing) ? [...existing] : [];
          for (const item of delta) {
            const itemObj = item as Record<string, unknown>;
            if (itemObj && typeof itemObj === "object" && "id" in itemObj) {
              const idx = arr.findIndex((ex) => (ex as Record<string, unknown>).id === itemObj.id);
              if (idx >= 0) arr[idx] = item;
              else arr.push(item);
            } else {
              arr.push(item);
            }
          }
          this.objectAccumulator.set(e.port, arr);
        } else {
          this.objectAccumulator.set(e.port, delta as Record<string, unknown>);
        }
        return;
      }
      case "snapshot": {
        this.hasSnapshots = true;
        this.snapshotAccumulator = (event as { data: T }).data;
        return;
      }
      case "phase":
        return;
      case "error":
        throw (event as { error: unknown }).error;
      case "finish":
        this.observeFinish(event as Extract<StreamEvent<T>, { type: "finish" }>);
        return;
    }
  }

  observeFinish(event: Extract<StreamEvent<T>, { type: "finish" }>): void {
    this.finished = true;
    this.finishData = event.data;
  }

  materialize(): T {
    if (!this.finished) {
      throw new Error("StreamEventAccumulator: stream ended without a finish event.");
    }
    if (this.hasTextDeltas && this.hasObjectDeltas) {
      throw new Error(
        "StreamEventAccumulator: stream mixed text-delta and object-delta events. " +
          "Mixed-mode streams are not supported."
      );
    }

    // One-shot: finish carries the complete payload.
    if (!this.hasTextDeltas && !this.hasObjectDeltas && !this.hasSnapshots) {
      if (isNonEmptyObject(this.finishData)) return this.finishData;
      return this.finishData as unknown as T;
    }

    // Snapshot (replace) mode — last snapshot wins, finish merged on top.
    if (this.hasSnapshots && !this.hasTextDeltas && !this.hasObjectDeltas) {
      if (isNonEmptyObject(this.finishData)) {
        return { ...(this.snapshotAccumulator as object), ...(this.finishData as object) } as T;
      }
      return this.snapshotAccumulator as T;
    }

    // Text-delta mode — per-port map → object.
    if (this.hasTextDeltas && !this.hasObjectDeltas) {
      const result: Record<string, unknown> = {};
      for (const [port, text] of this.textAccumulator) result[port] = text;
      if (isNonEmptyObject(this.finishData)) Object.assign(result, this.finishData);
      return result as unknown as T;
    }

    // Object-delta mode — per-port object → output, then merge finish.
    const merged: Record<string, unknown> = {};
    for (const [port, obj] of this.objectAccumulator) merged[port] = obj;
    if (isNonEmptyObject(this.finishData)) Object.assign(merged, this.finishData as object);
    return merged as unknown as T;
  }
}
