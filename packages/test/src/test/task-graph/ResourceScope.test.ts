/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { ResourceScope } from "@workglow/util";
import { IExecuteContext, Task, TaskGraph, Workflow } from "@workglow/task-graph";
import { DataPortSchema } from "@workglow/util/schema";

// A task that registers a disposer on the resource scope
class ResourceAcquiringTask extends Task<{ name: string }, { name: string }> {
  static override readonly type = "ResourceAcquiringTask";
  static override inputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { name: { type: "string", default: "default" } },
    } as const satisfies DataPortSchema;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { name: { type: "string" } },
    } as const satisfies DataPortSchema;
  }
  override async execute(
    input: { name: string },
    context: IExecuteContext
  ): Promise<{ name: string }> {
    context.resourceScope?.register(`test:${input.name}`, async () => {});
    return { name: input.name };
  }
}

describe("ResourceScope threading", () => {
  it("task.run() should thread resourceScope to execute()", async () => {
    const scope = new ResourceScope();
    const task = new ResourceAcquiringTask({ id: "t1", defaults: { name: "hello" } });
    await task.run({}, { resourceScope: scope });
    expect(scope.has("test:hello")).toBe(true);
  });

  it("TaskGraph should thread resourceScope to all tasks", async () => {
    const scope = new ResourceScope();
    const graph = new TaskGraph();
    const t1 = new ResourceAcquiringTask({ id: "t1", defaults: { name: "alpha" } });
    const t2 = new ResourceAcquiringTask({ id: "t2", defaults: { name: "beta" } });
    graph.addTask(t1);
    graph.addTask(t2);
    await graph.run({}, { resourceScope: scope });
    expect(scope.has("test:alpha")).toBe(true);
    expect(scope.has("test:beta")).toBe(true);
  });

  it("Workflow should thread resourceScope to tasks", async () => {
    const scope = new ResourceScope();
    const wf = new Workflow();
    wf.addTask(ResourceAcquiringTask, { name: "gamma" });
    await wf.run({}, { resourceScope: scope });
    expect(scope.has("test:gamma")).toBe(true);
  });

  it("sub-graphs should share the parent ResourceScope", async () => {
    const scope = new ResourceScope();
    const graph = new TaskGraph();

    // Create an inner workflow that contains a resource-acquiring task
    const inner = new Workflow();
    inner.addTask(ResourceAcquiringTask, { name: "inner-resource" });
    const innerTask = inner.toTask();

    graph.addTask(innerTask);
    await graph.run({ name: "inner-resource" }, { resourceScope: scope });
    expect(scope.has("test:inner-resource")).toBe(true);
  });

  it("deduplicates across tasks using the same resource key", async () => {
    const scope = new ResourceScope();
    const graph = new TaskGraph();
    // Two tasks register the same key
    const t1 = new ResourceAcquiringTask({ id: "t1", defaults: { name: "shared" } });
    const t2 = new ResourceAcquiringTask({ id: "t2", defaults: { name: "shared" } });
    graph.addTask(t1);
    graph.addTask(t2);
    await graph.run({}, { resourceScope: scope });
    // Only one entry despite two tasks
    expect(scope.size).toBe(1);
    expect(scope.has("test:shared")).toBe(true);
  });
});

describe("ResourceScope browser pattern", () => {
  it("BrowserSessionTask-style task registers a disposer keyed by session ID", async () => {
    const scope = new ResourceScope();
    const disconnected: string[] = [];

    // Simulates BrowserSessionTask registering a disposer
    class MockBrowserSessionTask extends Task<{}, { sessionId: string }> {
      static override readonly type = "MockBrowserSessionTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { sessionId: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute(_input: {}, context: IExecuteContext): Promise<{ sessionId: string }> {
        const sessionId = "sess-123";
        context.resourceScope?.register(`browser:${sessionId}`, async () => {
          disconnected.push(sessionId);
        });
        return { sessionId };
      }
    }

    const task = new MockBrowserSessionTask({ id: "bs1" });
    await task.run({}, { resourceScope: scope });

    expect(scope.has("browser:sess-123")).toBe(true);
    expect(disconnected).toEqual([]);

    await scope.disposeAll();
    expect(disconnected).toEqual(["sess-123"]);
    expect(scope.size).toBe(0);
  });
});

describe("ResourceScope AI pattern", () => {
  it("AiTask-style task registers a disposer keyed by model", async () => {
    const scope = new ResourceScope();
    const unloaded: string[] = [];

    class MockAiTask extends Task<{ model: string }, { text: string }> {
      static override readonly type = "MockAiTask";
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { model: { type: "string", default: "test-model" } },
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { text: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute(
        input: { model: string },
        context: IExecuteContext
      ): Promise<{ text: string }> {
        const modelKey = `ai:${input.model}`;
        context.resourceScope?.register(modelKey, async () => {
          unloaded.push(input.model);
        });
        return { text: "result" };
      }
    }

    const task = new MockAiTask({ id: "ai1" });
    await task.run({}, { resourceScope: scope });

    expect(scope.has("ai:test-model")).toBe(true);
    await scope.disposeAll();
    expect(unloaded).toEqual(["test-model"]);
  });
});

describe("TaskGraphRunner.runGraph auto-ownership", () => {
  it("auto-creates and disposes a ResourceScope when none is passed", async () => {
    const disposed: string[] = [];

    class GraphAutoDisposeTask extends Task<{}, { name: string }> {
      static override readonly type = "GraphAutoDisposeTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { name: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute(_input: {}, ctx: IExecuteContext): Promise<{ name: string }> {
        ctx.resourceScope?.register("auto:graph", async () => {
          disposed.push("graph");
        });
        return { name: "ok" };
      }
    }

    const graph = new TaskGraph();
    graph.addTask(new GraphAutoDisposeTask({ id: "t1" }));
    await graph.run();

    // Auto-disposal awaited before graph.run() resolves.
    expect(disposed).toEqual(["graph"]);
  });

  it("does not dispose a caller-passed ResourceScope", async () => {
    const disposed: string[] = [];

    class CallerOwnsGraphTask extends Task<{}, {}> {
      static override readonly type = "CallerOwnsGraphTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: {}, ctx: IExecuteContext): Promise<{}> {
        ctx.resourceScope?.register("caller:graph", async () => {
          disposed.push("graph");
        });
        return {};
      }
    }

    const scope = new ResourceScope();
    const graph = new TaskGraph();
    graph.addTask(new CallerOwnsGraphTask({ id: "t1" }));
    await graph.run({}, { resourceScope: scope });

    expect(disposed).toEqual([]);
    expect(scope.has("caller:graph")).toBe(true);

    await scope.disposeAll();
    expect(disposed).toEqual(["graph"]);
  });
});

describe("TaskGraphRunner terminal-event ordering", () => {
  it("emits 'error' event before auto-disposal fires", async () => {
    const events: string[] = [];

    class FailingResourceTask extends Task<{}, {}> {
      static override readonly type = "FailingResourceTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: {}, ctx: IExecuteContext): Promise<{}> {
        ctx.resourceScope?.register("order:failing", async () => {
          events.push("disposed");
        });
        throw new Error("intentional failure");
      }
    }

    const graph = new TaskGraph();
    graph.addTask(new FailingResourceTask({ id: "t1" }));
    graph.on("error", () => events.push("error-event"));

    await expect(graph.run()).rejects.toThrow("intentional failure");

    expect(events).toEqual(["error-event", "disposed"]);
  });
});

describe("TaskRunner.run auto-ownership", () => {
  it("auto-creates and disposes a ResourceScope when none is passed", async () => {
    const disposed: string[] = [];

    class AutoDisposeTask extends Task<{}, { ok: boolean }> {
      static override readonly type = "AutoDisposeTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { ok: { type: "boolean" } },
        } as const satisfies DataPortSchema;
      }
      override async execute(_input: {}, ctx: IExecuteContext): Promise<{ ok: boolean }> {
        ctx.resourceScope?.register("auto:bare", async () => {
          disposed.push("bare");
        });
        return { ok: true };
      }
    }

    const task = new AutoDisposeTask({ id: "t1" });
    const result = await task.run({}, {});

    expect(result).toEqual({ ok: true });
    // Disposal awaited before run() resolves — so the side effect is visible here.
    expect(disposed).toEqual(["bare"]);
  });

  it("does not dispose a caller-passed ResourceScope", async () => {
    const disposed: string[] = [];

    class CallerOwnsTask extends Task<{}, {}> {
      static override readonly type = "CallerOwnsTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: {}, ctx: IExecuteContext): Promise<{}> {
        ctx.resourceScope?.register("caller:bare", async () => {
          disposed.push("bare");
        });
        return {};
      }
    }

    const scope = new ResourceScope();
    const task = new CallerOwnsTask({ id: "t1" });
    await task.run({}, { resourceScope: scope });

    // Runner did NOT dispose — caller still owns the disposer.
    expect(disposed).toEqual([]);
    expect(scope.has("caller:bare")).toBe(true);

    await scope.disposeAll();
    expect(disposed).toEqual(["bare"]);
  });
});

describe("ResourceScope `await using` integration", () => {
  it("runner does not dispose; block-scoped `await using` does", async () => {
    const disposed: string[] = [];

    class UsingScopeTask extends Task<{}, {}> {
      static override readonly type = "UsingScopeTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: {}, ctx: IExecuteContext): Promise<{}> {
        ctx.resourceScope?.register("using:t1", async () => {
          disposed.push("t1");
        });
        return {};
      }
    }

    {
      await using scope = new ResourceScope();
      const graph = new TaskGraph();
      graph.addTask(new UsingScopeTask({ id: "t1" }));
      await graph.run({}, { resourceScope: scope });

      // Inside the block: runner did NOT dispose. Scope still holds the disposer.
      expect(scope.size).toBeGreaterThan(0);
      expect(disposed).toEqual([]);
    }

    // Block exits → `await using` invokes [Symbol.asyncDispose] → disposeAll runs.
    expect(disposed).toEqual(["t1"]);
  });
});

describe("ResourceScope auto-ownership failure paths", () => {
  it("disposes auto-scope when run is aborted via parentSignal", async () => {
    const events: string[] = [];

    class HangingResourceTask extends Task<{}, {}> {
      static override readonly type = "HangingResourceTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: {}, ctx: IExecuteContext): Promise<{}> {
        ctx.resourceScope?.register("abort:t1", async () => {
          events.push("disposed");
        });
        // Wait for abort
        await new Promise<void>((resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
        return {};
      }
    }

    const graph = new TaskGraph();
    graph.addTask(new HangingResourceTask({ id: "t1" }));
    graph.on("abort", () => events.push("abort-event"));

    const ctrl = new AbortController();
    const runPromise = graph.run({}, { parentSignal: ctrl.signal });
    // Give the task a tick to register its disposer.
    await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();

    await expect(runPromise).rejects.toThrow();

    // Both the abort event and the disposer fired.
    expect(events).toContain("abort-event");
    expect(events).toContain("disposed");
    // Abort event before disposal (handleAbort is awaited in the epilogue).
    expect(events.indexOf("abort-event")).toBeLessThan(events.indexOf("disposed"));
  });

  it("resets this.resourceScope even when handleStart rejects (maxTasks)", async () => {
    class TrivialTask extends Task<{}, {}> {
      static override readonly type = "TrivialTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(): Promise<{}> {
        return {};
      }
    }

    const graph = new TaskGraph();
    graph.addTask(new TrivialTask({ id: "a" }));
    graph.addTask(new TrivialTask({ id: "b" }));

    // maxTasks: 1 forces handleStart to throw before any task runs.
    await expect(graph.run({}, { maxTasks: 1 })).rejects.toThrow();

    // Subsequent run with no maxTasks should succeed — the previous run's
    // auto-scope did not leak into the runner instance.
    await graph.run();
  });
});

describe("ResourceScope nested-run forwarding under auto-ownership", () => {
  it("GraphAsTask: outermost runner disposes exactly once", async () => {
    const disposeCalls: string[] = [];
    const capturedScopes: ResourceScope[] = [];

    class CountingDisposerTask extends Task<{ tag: string }, { tag: string }> {
      static override readonly type = "CountingDisposerTask";
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { tag: { type: "string", default: "default" } },
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { tag: { type: "string" } },
        } as const satisfies DataPortSchema;
      }
      override async execute(
        input: { tag: string },
        ctx: IExecuteContext
      ): Promise<{ tag: string }> {
        if (ctx.resourceScope) capturedScopes.push(ctx.resourceScope);
        ctx.resourceScope?.register(`count:${input.tag}`, async () => {
          disposeCalls.push(input.tag);
        });
        return { tag: input.tag };
      }
    }

    // Outer graph contains an inner Workflow-as-task, which contains the disposer-registering task.
    const inner = new Workflow();
    inner.addTask(CountingDisposerTask, { tag: "nested" });
    const outer = new TaskGraph();
    outer.addTask(inner.toTask());

    await outer.run({ tag: "nested" });

    // Disposer must fire exactly once — not once per nested level.
    expect(disposeCalls).toEqual(["nested"]);
    // All task executions must see the same scope identity (correct forwarding).
    expect(new Set(capturedScopes).size).toBe(1);
  });

  it("MapTask iteration: scope persists across iterations, disposes once at end", async () => {
    const disposeCalls: string[] = [];
    const capturedScopes: ResourceScope[] = [];

    class IteratingDisposerTask extends Task<{ item: number }, { item: number }> {
      static override readonly type = "IteratingDisposerTask";
      static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { item: { type: "number" } },
          required: ["item"],
          additionalProperties: true,
        } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: { item: { type: "number" } },
        } as const satisfies DataPortSchema;
      }
      override async execute(
        input: { item: number },
        ctx: IExecuteContext
      ): Promise<{ item: number }> {
        if (ctx.resourceScope) capturedScopes.push(ctx.resourceScope);
        // Same key across all 3 iterations. With one shared scope (correct
        // forwarding), first-registration-wins keeps only the first; with
        // per-iteration scopes (broken forwarding), each iteration's scope
        // gets its own copy and disposes at iteration end → 3 entries.
        ctx.resourceScope?.register("model:shared", async () => {
          disposeCalls.push("disposed");
        });
        return { item: input.item };
      }
    }

    const workflow = new Workflow();
    workflow
      .map({ maxIterations: "unbounded", concurrencyLimit: 1 })
      .addTask(IteratingDisposerTask)
      .endMap();

    await workflow.run({ item: [1, 2, 3] });

    // First-registration-wins held → exactly one disposer fired.
    expect(disposeCalls).toEqual(["disposed"]);
    // All 3 iterations saw the same scope identity → forwarding works.
    expect(capturedScopes).toHaveLength(3);
    expect(new Set(capturedScopes).size).toBe(1);
  });
});
