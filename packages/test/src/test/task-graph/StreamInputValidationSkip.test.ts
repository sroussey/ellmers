/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Whole-value input validation is a settled-value concept: an input port fed by
 * a live event stream has no settled value to validate this run (its slot may
 * hold only a `CacheRef`). `Task.validateInput(input, skipPorts)` therefore
 * exempts the named ports — dropping them from both the validated object and a
 * derived schema (properties + required) — so neither a type mismatch on a ref
 * nor a `required` check rejects an otherwise valid streaming run. Ports not in
 * `skipPorts` (i.e. carrying a settled value) are still validated.
 */

import { makeCacheRef, Task } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

type In = { query: string; doc: string };
type Out = { ok: boolean };

class RequiredStreamPortTask extends Task<In, Out> {
  public static override type = "StreamInputValidationSkip_Task";
  public static override category = "Test";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        query: { type: "string" },
        // A streaming input port that is ALSO required — the hardest case for
        // the skip: removing it must clear both the type check and `required`.
        doc: { type: "string", "x-stream": "append" },
      },
      required: ["query", "doc"],
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { ok: { type: "boolean" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(): Promise<Out> {
    return { ok: true };
  }
}

describe("Task.validateInput — stream-wired port skip", () => {
  it("rejects a CacheRef at a required string port with NO skip", async () => {
    const task = new RequiredStreamPortTask();
    const ref = makeCacheRef({ $ref: "inmem://x", port: "doc", mode: "append", size: 3 });
    await expect(task.validateInput({ query: "q", doc: ref as unknown as string })).rejects.toThrow(
      /does not match schema/
    );
  });

  it("accepts the same CacheRef when the streamed port is skipped", async () => {
    const task = new RequiredStreamPortTask();
    const ref = makeCacheRef({ $ref: "inmem://x", port: "doc", mode: "append", size: 3 });
    await expect(
      task.validateInput({ query: "q", doc: ref as unknown as string }, new Set(["doc"]))
    ).resolves.toBe(true);
  });

  it("accepts an absent required port when it is skipped", async () => {
    const task = new RequiredStreamPortTask();
    await expect(task.validateInput({ query: "q" } as In, new Set(["doc"]))).resolves.toBe(true);
  });

  it("still validates the NON-skipped ports (a bad settled value fails)", async () => {
    const task = new RequiredStreamPortTask();
    const ref = makeCacheRef({ $ref: "inmem://x", port: "doc", mode: "append", size: 3 });
    await expect(
      task.validateInput(
        { query: 42 as unknown as string, doc: ref as unknown as string },
        new Set(["doc"])
      )
    ).rejects.toThrow(/does not match schema/);
  });

  it("does not skip when skipPorts is empty (settled value validated normally)", async () => {
    const task = new RequiredStreamPortTask();
    await expect(task.validateInput({ query: "q", doc: "hello" })).resolves.toBe(true);
  });
});
