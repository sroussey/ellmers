/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Replace-mode hardening: a task that declares `x-stream: "replace"` must carry
 * its value explicitly — either a final `snapshot` or a non-empty `finish`
 * payload. A producer that emits an empty `finish` with no preceding snapshot is
 * a bug (it silently cleared the output before this hardening); the runner now
 * surfaces a clear error instead of returning an empty object.
 */

import type { StreamEvent } from "@workglow/task-graph";
import {
  type CachePolicy,
  type IExecuteContext,
  type IRunConfig,
  Task,
} from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

type In = { prompt: string };
type Out = { text: string };

function inputSchema(): DataPortSchema {
  return {
    type: "object",
    properties: { prompt: { type: "string", default: "test" } },
    additionalProperties: false,
  } as const satisfies DataPortSchema;
}

function replaceOutputSchema(): DataPortSchema {
  return {
    type: "object",
    properties: { text: { type: "string", "x-stream": "replace" } },
    additionalProperties: false,
  } as const satisfies DataPortSchema;
}

/** Emits only an empty finish — no snapshot, no deltas. The broken producer. */
class ReplaceNoValueTask extends Task<In, Out> {
  public static override type = "ReplaceHardening_NoValue";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override inputSchema(): DataPortSchema {
    return inputSchema();
  }
  public static override outputSchema(): DataPortSchema {
    return replaceOutputSchema();
  }
  async *executeStream(_i: In, _c: IExecuteContext): AsyncIterable<StreamEvent<Out>> {
    yield { type: "finish", data: {} as Out };
  }
  override async execute(): Promise<Out | undefined> {
    return { text: "" };
  }
}

/** Emits a final snapshot then an empty finish — the canonical replace shape. */
class ReplaceSnapshotTask extends Task<In, Out> {
  public static override type = "ReplaceHardening_Snapshot";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override inputSchema(): DataPortSchema {
    return inputSchema();
  }
  public static override outputSchema(): DataPortSchema {
    return replaceOutputSchema();
  }
  async *executeStream(_i: In, _c: IExecuteContext): AsyncIterable<StreamEvent<Out>> {
    yield { type: "snapshot", data: { text: "final" } as Out };
    yield { type: "finish", data: {} as Out };
  }
  override async execute(): Promise<Out | undefined> {
    return { text: "final" };
  }
}

/** Carries the value in a non-empty finish payload (no snapshot). */
class ReplaceExplicitFinishTask extends Task<In, Out> {
  public static override type = "ReplaceHardening_ExplicitFinish";
  public static override cachePolicy: CachePolicy = { kind: "none" };
  public static override inputSchema(): DataPortSchema {
    return inputSchema();
  }
  public static override outputSchema(): DataPortSchema {
    return replaceOutputSchema();
  }
  async *executeStream(_i: In, _c: IExecuteContext): AsyncIterable<StreamEvent<Out>> {
    yield { type: "finish", data: { text: "explicit" } as Out };
  }
  override async execute(): Promise<Out | undefined> {
    return { text: "explicit" };
  }
}

describe("Replace-mode hardening", () => {
  it("throws a clear error when finish is empty and no snapshot was emitted (accumulation path)", async () => {
    const task = new ReplaceNoValueTask({ defaults: { prompt: "test" } });
    await expect(task.run({ prompt: "test" })).rejects.toThrow(/replace/i);
  });

  it("throws when finish is empty and no snapshot was emitted (no-accumulation path)", async () => {
    const task = new ReplaceNoValueTask({ defaults: { prompt: "test" } });
    const config: IRunConfig = { shouldAccumulate: false };
    await expect(task.runner.run({ prompt: "test" }, config)).rejects.toThrow(/replace/i);
  });

  it("resolves from the last snapshot when finish is empty", async () => {
    const task = new ReplaceSnapshotTask({ defaults: { prompt: "test" } });
    const result = await task.run({ prompt: "test" });
    expect(result.text).toBe("final");
  });

  it("resolves from a non-empty finish payload", async () => {
    const task = new ReplaceExplicitFinishTask({ defaults: { prompt: "test" } });
    const result = await task.run({ prompt: "test" });
    expect(result.text).toBe("explicit");
  });
});
