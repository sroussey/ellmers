/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResourceScope, ServiceRegistry } from "@workglow/util";
import type { Taskish } from "../task-graph/Conversions";
import type { ITask } from "./ITask";
import type { StreamEvent, StreamMode, Usage } from "./StreamTypes";
import {
  getOutputStreamMode,
  getStreamingPorts,
  mergeUsage,
  REFUSAL_CATEGORY_OUTPUT_KEY,
  REFUSAL_OUTPUT_KEY,
  USAGE_OUTPUT_KEY,
} from "./StreamTypes";
import { TaskAbortedError, TaskError } from "./TaskError";
import type { TaskRunContext } from "./TaskRunContext";
import type { TaskConfig, TaskInput, TaskOutput } from "./TaskTypes";
import { TaskStatus } from "./TaskTypes";

/**
 * Per-call run-state inputs shared by StreamProcessor.run. Bundles facade
 * state pulled at call time (registry, resourceScope, inputStreams) and
 * facade methods bound to the facade instance (onProgress, own).
 *
 * @internal
 */
export interface StreamProcessorDeps {
  readonly registry: ServiceRegistry;
  readonly resourceScope: ResourceScope | undefined;
  readonly inputStreams: Map<string, ReadableStream<StreamEvent>> | undefined;
  readonly onProgress: (
    progress: number | undefined,
    message?: string,
    ...args: any[]
  ) => Promise<void>;
  readonly own: <T extends Taskish<any, any>>(i: T, config?: TaskConfig) => T;
  readonly disown: <T extends Taskish<any, any>>(i: T) => void;
}

/**
 * @internal
 * Streaming event loop. Consumes a task's executeStream() output, manages
 * text/object delta accumulators, mode switching (append/object/replace),
 * and finish-event enrichment. Honors ctx.shouldAccumulate and
 * ctx.abortController.signal.
 */
export class StreamProcessor<Input extends TaskInput, Output extends TaskOutput> {
  constructor(private readonly task: ITask<Input, Output, any>) {}

  async run(
    input: Input,
    ctx: TaskRunContext,
    deps: StreamProcessorDeps
  ): Promise<Output | undefined> {
    const streamMode: StreamMode = getOutputStreamMode(this.task.outputSchema());
    if (streamMode === "append") {
      const ports = getStreamingPorts(this.task.outputSchema());
      if (ports.length === 0) {
        throw new TaskError(
          `Task ${this.task.type} declares append streaming but no output port has x-stream: "append"`
        );
      }
    }
    if (streamMode === "object") {
      const ports = getStreamingPorts(this.task.outputSchema());
      if (ports.length === 0) {
        throw new TaskError(
          `Task ${this.task.type} declares object streaming but no output port has x-stream: "object"`
        );
      }
    }

    const accumulated = ctx.shouldAccumulate ? new Map<string, string>() : undefined;
    const accumulatedObjects = ctx.shouldAccumulate
      ? new Map<string, Record<string, unknown> | unknown[]>()
      : undefined;
    let streamingStarted = false;
    let finalOutput: Output | undefined;
    let refusalText = "";
    let refusalCategory: string | undefined;
    let usage: Usage | undefined;

    this.task.emit("stream_start");

    const stream = this.task.executeStream!(input, {
      signal: ctx.abortController.signal,
      updateProgress: deps.onProgress,
      own: deps.own,
      disown: deps.disown,
      registry: deps.registry,
      resourceScope: deps.resourceScope,
      inputStreams: deps.inputStreams,
    });

    for await (const event of stream) {
      // For snapshot events, update runOutputData BEFORE emitting stream_chunk
      // so listeners see the latest snapshot when they handle the event.
      if (event.type === "snapshot") {
        this.task.runOutputData = event.data as Output;
      }

      switch (event.type) {
        case "phase": {
          // Phase events are metadata: emit for observability, translate to a
          // progress event with optional progress + message, do NOT mutate
          // accumulators or runOutputData, do NOT flip status to STREAMING.
          this.task.emit("stream_chunk", event as StreamEvent);
          await deps.onProgress(event.progress, event.message);
          break;
        }
        case "text-delta": {
          if (!streamingStarted) {
            streamingStarted = true;
            this.task.status = TaskStatus.STREAMING;
            this.task.emit("status", this.task.status);
          }
          if (accumulated) {
            accumulated.set(event.port, (accumulated.get(event.port) ?? "") + event.textDelta);
          }
          this.task.emit("stream_chunk", event as StreamEvent);
          break;
        }
        case "object-delta": {
          if (!streamingStarted) {
            streamingStarted = true;
            this.task.status = TaskStatus.STREAMING;
            this.task.emit("status", this.task.status);
          }
          if (accumulatedObjects) {
            const existing = accumulatedObjects.get(event.port);
            if (Array.isArray(event.objectDelta)) {
              // Array delta: upsert items by `id` into accumulated array
              const arr: unknown[] = Array.isArray(existing) ? [...existing] : [];
              for (const item of event.objectDelta) {
                const itemObj = item as Record<string, unknown>;
                if (itemObj && typeof itemObj === "object" && "id" in itemObj) {
                  const idx = arr.findIndex(
                    (e) => (e as Record<string, unknown>).id === itemObj.id
                  );
                  if (idx >= 0) arr[idx] = item;
                  else arr.push(item);
                } else {
                  arr.push(item);
                }
              }
              accumulatedObjects.set(event.port, arr);
            } else {
              // Non-array (e.g. structured generation): replace semantics
              accumulatedObjects.set(event.port, event.objectDelta);
            }
          }
          // Update runOutputData with accumulated state so listeners see growing state
          this.task.runOutputData = {
            ...this.task.runOutputData,
            [event.port]: accumulatedObjects?.get(event.port) ?? event.objectDelta,
          } as Output;
          this.task.emit("stream_chunk", event as StreamEvent);
          break;
        }
        case "snapshot": {
          if (!streamingStarted) {
            streamingStarted = true;
            this.task.status = TaskStatus.STREAMING;
            this.task.emit("status", this.task.status);
          }
          this.task.emit("stream_chunk", event as StreamEvent);
          break;
        }
        case "finish": {
          usage = mergeUsage(usage, event.usage);
          // Re-attached to every finish this processor constructs below, so a
          // downstream StreamPump consumer sees the same token counts the
          // provider reported. Spread conditionally: an unreported usage must
          // leave no key at all rather than an explicit `usage: undefined`.
          const usageOnEvent = event.usage ? { usage: event.usage } : {};
          if (accumulated || accumulatedObjects) {
            // Emit an enriched finish event: merge accumulated deltas into
            // the finish payload so downstream dataflows get complete port data
            // without needing to re-accumulate themselves.
            const merged: Record<string, unknown> = { ...(event.data || {}) };
            if (accumulated) {
              for (const [port, text] of accumulated) {
                if (text.length > 0) merged[port] = text;
              }
            }
            if (accumulatedObjects) {
              for (const [port, obj] of accumulatedObjects) {
                merged[port] = obj;
              }
            }
            // For replace-mode streams, finish carries data: {} by convention.
            // Fall back to the last snapshot (runOutputData) so the final output
            // is not silently cleared when the finish payload is empty.
            if (streamMode === "replace" && Object.keys(merged).length === 0) {
              const lastSnapshot = this.task.runOutputData;
              if (lastSnapshot && Object.keys(lastSnapshot).length > 0) {
                finalOutput = lastSnapshot as Output;
                this.task.emit("stream_chunk", {
                  type: "finish",
                  data: lastSnapshot,
                  ...usageOnEvent,
                } as StreamEvent);
                break;
              }
            }
            finalOutput = merged as unknown as Output;
            this.task.emit("stream_chunk", {
              type: "finish",
              data: merged,
              ...usageOnEvent,
            } as StreamEvent);
          } else {
            // No accumulation. For replace-mode streams the provider's finish
            // event carries `data: {}` by convention — the snapshots already
            // delivered the value, so the finish payload is intentionally
            // empty. Fall back to `runOutputData` (set on every snapshot above)
            // so we don't clobber the last snapshot with an empty object. This
            // mirrors the same fallback in the accumulation branch.
            const finishData = (event.data ?? {}) as Record<string, unknown>;
            if (streamMode === "replace" && Object.keys(finishData).length === 0) {
              const lastSnapshot = this.task.runOutputData;
              if (lastSnapshot && Object.keys(lastSnapshot).length > 0) {
                finalOutput = lastSnapshot as Output;
                this.task.emit("stream_chunk", {
                  type: "finish",
                  data: lastSnapshot,
                  ...usageOnEvent,
                } as StreamEvent);
                break;
              }
            }
            finalOutput = event.data as Output;
            this.task.emit("stream_chunk", event as StreamEvent);
          }
          break;
        }
        case "refusal": {
          // A refusal is a valid outcome, not an error: flip to STREAMING like a
          // data event, accumulate the text, and surface it via the reserved
          // `refusal` output field after the stream ends. The task still
          // COMPLETES; consumers detect it by checking `output.refusal`.
          if (!streamingStarted) {
            streamingStarted = true;
            this.task.status = TaskStatus.STREAMING;
            this.task.emit("status", this.task.status);
          }
          refusalText += event.refusal;
          if (event.category) refusalCategory = event.category;
          this.task.emit("stream_chunk", event as StreamEvent);
          break;
        }
        case "error": {
          throw event.error;
        }
      }
    }

    // Check if the task was aborted during streaming
    if (ctx.abortController.signal.aborted) {
      throw new TaskAbortedError("Task aborted during streaming");
    }

    if (finalOutput !== undefined) {
      this.task.runOutputData = finalOutput;
    }

    // Fold an accumulated refusal into the final output's reserved field so
    // programmatic consumers (run() result, collectStream, agent loops) can
    // detect it. Kept off streamed data edges (Dataflow treats refusal as
    // metadata, like phase).
    if (refusalText.length > 0) {
      this.task.runOutputData = {
        ...(this.task.runOutputData as Record<string, unknown> | undefined),
        [REFUSAL_OUTPUT_KEY]: refusalText,
        ...(refusalCategory ? { [REFUSAL_CATEGORY_OUTPUT_KEY]: refusalCategory } : {}),
      } as unknown as Output;
    }

    // Same treatment for token accounting: a reserved output field, kept off
    // dataflow edges, applied after any refusal so a refused turn still reports
    // what it was billed. Absent when no provider reported usage.
    if (usage) {
      this.task.runOutputData = {
        ...(this.task.runOutputData as Record<string, unknown> | undefined),
        [USAGE_OUTPUT_KEY]: usage,
      } as unknown as Output;
    }

    this.task.emit("stream_end", this.task.runOutputData as Output);

    return this.task.runOutputData as Output;
  }
}
