/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamEvent, TaskIdType, Workflow } from "@workglow/task-graph";
import { describe, expect, it, vi } from "vitest";
import { runWithStreamChunks } from "../evals/streamSubscribe";

type WorkflowListener = (taskId: TaskIdType, event: StreamEvent) => void;

/** A minimal stand-in for `Workflow`'s `on`/`off`/`run` — enough surface for `runWithStreamChunks`. */
function fakeWorkflow(run: () => Promise<unknown>): {
  workflow: Workflow;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
} {
  const on = vi.fn();
  const off = vi.fn();
  const workflow = { on, off, run } as unknown as Workflow;
  return { workflow, on, off };
}

describe("runWithStreamChunks", () => {
  it("subscribes nothing when no listener is given", async () => {
    const { workflow, on, off } = fakeWorkflow(async () => ({ ok: true }));
    await runWithStreamChunks(workflow, undefined);
    expect(on).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();
  });

  it("subscribes for a successful run and unsubscribes the same listener after", async () => {
    const { workflow, on, off } = fakeWorkflow(async () => ({ ok: true }));
    await runWithStreamChunks(workflow, vi.fn());
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0][0]).toBe("stream_chunk");
    expect(off).toHaveBeenCalledTimes(1);
    expect(off.mock.calls[0][0]).toBe("stream_chunk");
    expect(off.mock.calls[0][1]).toBe(on.mock.calls[0][1]);
  });

  it("unsubscribes even when the run throws", async () => {
    const boom = new Error("boom");
    const { workflow, on, off } = fakeWorkflow(async () => {
      throw boom;
    });
    await expect(runWithStreamChunks(workflow, vi.fn())).rejects.toThrow(boom);
    expect(on).toHaveBeenCalledTimes(1);
    expect(off).toHaveBeenCalledTimes(1);
    expect(off.mock.calls[0][1]).toBe(on.mock.calls[0][1]);
  });

  it("forwards a stream_chunk event's payload to the caller's listener", async () => {
    let registered: WorkflowListener | undefined;
    const on = vi.fn((_name: string, listener: WorkflowListener) => {
      registered = listener;
    });
    const off = vi.fn();
    const workflow = { on, off, run: async () => ({}) } as unknown as Workflow;
    const onStreamChunk = vi.fn();

    await runWithStreamChunks(workflow, onStreamChunk);

    const event = { type: "text-delta", delta: "hi" } as unknown as StreamEvent;
    registered?.("task-1" as TaskIdType, event);
    expect(onStreamChunk).toHaveBeenCalledTimes(1);
    expect(onStreamChunk).toHaveBeenCalledWith(event);
  });
});
