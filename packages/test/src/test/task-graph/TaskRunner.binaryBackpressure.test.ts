/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, Task, TaskRegistry } from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";
import { beforeAll, describe, expect, it } from "vitest";

type CallObserved = { calledType: string; resolvedTo: unknown };

class BackpressureProbe extends Task<Record<string, never>, CallObserved> {
  public static override type = "BackpressureProbe_Execute";
  public static override category = "Test";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: {
        calledType: { type: "string" },
        resolvedTo: {},
      },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    _input: Record<string, never>,
    ctx: IExecuteContext
  ): Promise<CallObserved | undefined> {
    const fn = ctx.binaryBackpressure;
    expect(typeof fn).toBe("function");
    const resolvedTo = await fn!();
    return { calledType: typeof fn, resolvedTo };
  }
}

type PreviewObserved = { ranPreview: boolean };

class PreviewOnlyProbe extends Task<Record<string, never>, PreviewObserved> {
  public static override type = "BackpressureProbe_Preview";
  public static override category = "Test";
  public static override cacheable = false;

  public static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  public static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { ranPreview: { type: "boolean" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }

  override async execute(
    _input: Record<string, never>,
    _ctx: IExecuteContext
  ): Promise<PreviewObserved | undefined> {
    return { ranPreview: false };
  }

  override async executePreview(
    _input: Record<string, never>
  ): Promise<PreviewObserved | undefined> {
    return { ranPreview: true };
  }
}

beforeAll(() => {
  TaskRegistry.registerTask(BackpressureProbe as any);
  TaskRegistry.registerTask(PreviewOnlyProbe as any);
});

describe("TaskRunner - binaryBackpressure default (non-streaming execute path)", () => {
  it("ctx.binaryBackpressure is installed and resolves to undefined", async () => {
    const task = new BackpressureProbe();
    const output = await task.run();
    expect(output).toBeDefined();
    expect(output.calledType).toBe("function");
    expect(output.resolvedTo).toBeUndefined();
  });

  it("calling ctx.binaryBackpressure() repeatedly still resolves cleanly", async () => {
    class RepeatedCaller extends Task<Record<string, never>, { count: number }> {
      public static override type = "BackpressureProbe_Repeat";
      public static override category = "Test";
      public static override cacheable = false;
      public static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { count: { type: "number" } },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
      override async execute(
        _input: Record<string, never>,
        ctx: IExecuteContext
      ): Promise<{ count: number } | undefined> {
        for (let i = 0; i < 50; i++) await ctx.binaryBackpressure!();
        return { count: 50 };
      }
    }
    TaskRegistry.registerTask(RepeatedCaller as any);

    const task = new RepeatedCaller();
    const out = await task.run();
    expect(out.count).toBe(50);
  });

  it("runPreview() still works (preview context omits binaryBackpressure)", async () => {
    const task = new PreviewOnlyProbe();
    const out = await task.runPreview();
    expect(out).toBeDefined();
    expect(out.ranPreview).toBe(true);
  });
});
