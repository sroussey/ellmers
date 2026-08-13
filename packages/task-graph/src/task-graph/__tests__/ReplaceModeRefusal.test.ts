/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A refusal is a VALID outcome for a replace-mode stream: the provider
 * declines, delivers no snapshot and an empty finish payload, and the task
 * must COMPLETE with the refusal folded into `output.refusal` — not throw
 * the replace-mode "finished with no value" error. The truly empty case
 * (no value AND no refusal) still throws.
 */

import type { StreamEvent } from "@workglow/task-graph";
import { Task, TaskStatus } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

type ReplaceOut = { answer?: string; refusal?: string; refusalCategory?: string };

class RefusingReplaceTask extends Task<Record<string, never>, ReplaceOut> {
  public static override type = "ReplaceModeRefusal_Refusing";
  public static override category = "Test";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { answer: { type: "string", "x-stream": "replace" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
  async *executeStream(): AsyncIterable<StreamEvent<ReplaceOut>> {
    yield { type: "refusal", refusal: "cannot ", category: "output-refusal" };
    yield { type: "refusal", refusal: "comply" };
    yield { type: "finish", data: {} as ReplaceOut };
  }
}

class EmptyReplaceTask extends RefusingReplaceTask {
  public static override type = "ReplaceModeRefusal_Empty";

  override async *executeStream(): AsyncIterable<StreamEvent<ReplaceOut>> {
    yield { type: "finish", data: {} as ReplaceOut };
  }
}

describe("replace-mode refusal completes with output.refusal", () => {
  it("accumulating run (enrichment branch): COMPLETES and surfaces the refusal", async () => {
    const task = new RefusingReplaceTask();
    const out = await task.run();
    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect(out.refusal).toBe("cannot comply");
    expect(out.refusalCategory).toBe("output-refusal");
  });

  it("non-accumulating run (no-enrichment branch): COMPLETES and surfaces the refusal", async () => {
    const task = new RefusingReplaceTask();
    const out = await task.run({}, { shouldAccumulate: false });
    expect(task.status).toBe(TaskStatus.COMPLETED);
    expect(out.refusal).toBe("cannot comply");
    expect(out.refusalCategory).toBe("output-refusal");
  });

  it("still throws when the stream delivers neither a value nor a refusal", async () => {
    await expect(new EmptyReplaceTask().run()).rejects.toThrow(/finished with no value/);
    await expect(new EmptyReplaceTask().run({}, { shouldAccumulate: false })).rejects.toThrow(
      /finished with no value/
    );
  });
});
