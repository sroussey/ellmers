/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, TaskInput, TaskOutput } from "@workglow/task-graph";
import { Task, TaskGraph, Workflow } from "@workglow/task-graph";
import { ResourceScope } from "@workglow/util";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

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

describe("ResourceScope.disposeAll error handling", () => {
  it("runs every disposer and does not throw when one rejects", async () => {
    const scope = new ResourceScope();
    const ran: string[] = [];

    scope.register("ok-1", async () => {
      ran.push("ok-1");
    });
    scope.register("boom", async () => {
      ran.push("boom");
      throw new Error("disposer failed");
    });
    scope.register("ok-2", async () => {
      ran.push("ok-2");
    });

    // Best-effort contract: must not throw even though "boom" rejects.
    await expect(scope.disposeAll()).resolves.toBeUndefined();

    // All disposers ran despite the failure, and the scope is cleared.
    expect(ran.sort()).toEqual(["boom", "ok-1", "ok-2"]);
    expect(scope.size).toBe(0);
  });
});

describe("ResourceScope browser pattern", () => {
  it("BrowserSessionTask-style task registers a disposer keyed by session ID", async () => {
    const scope = new ResourceScope();
    const disconnected: string[] = [];

    // Simulates BrowserSessionTask registering a disposer
    class MockBrowserSessionTask extends Task<TaskInput, { sessionId: string }> {
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
      override async execute(
        _input: TaskInput,
        context: IExecuteContext
      ): Promise<{ sessionId: string }> {
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

    class GraphAutoDisposeTask extends Task<TaskInput, { name: string }> {
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
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<{ name: string }> {
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

    class CallerOwnsGraphTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "CallerOwnsGraphTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
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

    class FailingResourceTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "FailingResourceTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
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

    class AutoDisposeTask extends Task<TaskInput, { ok: boolean }> {
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
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<{ ok: boolean }> {
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

    class CallerOwnsTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "CallerOwnsTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
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

    class UsingScopeTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "UsingScopeTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
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
    let registered: () => void;
    const registeredPromise = new Promise<void>((r) => {
      registered = r;
    });

    class HangingResourceTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "HangingResourceTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
        ctx.resourceScope?.register("abort:t1", async () => {
          events.push("disposed");
        });
        // Signal that registration is complete — replaces a wall-clock sleep
        // so the abort fires deterministically AFTER the disposer is in the Map,
        // regardless of how busy the test runner is.
        registered();
        await new Promise<void>((_resolve, reject) => {
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
    await registeredPromise;
    ctrl.abort();

    await expect(runPromise).rejects.toThrow();

    // Both the abort event and the disposer fired.
    expect(events).toContain("abort-event");
    expect(events).toContain("disposed");
    // Abort event before disposal (handleAbort is awaited in the epilogue).
    expect(events.indexOf("abort-event")).toBeLessThan(events.indexOf("disposed"));
  });

  it("resets this.resourceScope even when handleStart rejects (maxTasks)", async () => {
    class TrivialTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "TrivialTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(): Promise<TaskOutput> {
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

describe("runPreview does not auto-create a ResourceScope", () => {
  it("runGraphPreview leaves resourceScope undefined and does not call disposers", async () => {
    const previewSawScope: boolean[] = [];

    class PreviewResourceTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "PreviewResourceTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
        ctx.resourceScope?.register("preview:t1", async () => {});
        return {};
      }
      // Note: IExecutePreviewContext = Pick<IExecuteContext, "own"> — no resourceScope.
      // The point of this test is that runPreview() does not throw and does not
      // attempt to auto-create or thread a scope.
      override async executePreview(): Promise<TaskOutput> {
        // Can't observe ctx.resourceScope because IExecutePreviewContext excludes it.
        // Record that executePreview ran at all (scope tracking is done externally).
        previewSawScope.push(false); // always false: preview context has no resourceScope
        return {};
      }
    }

    const graph = new TaskGraph();
    graph.addTask(new PreviewResourceTask({ id: "t1" }));
    await graph.runPreview();

    expect(previewSawScope).toEqual([false]);
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

describe("ResourceScope auto-ownership does not leak through context.own()", () => {
  it("auto-owned scope is not stamped into owned tasks' runConfig", async () => {
    const disposed: string[] = [];

    class ChildResourceTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "ChildResourceTaskOwn";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
        ctx.resourceScope?.register("child:resource", async () => {
          disposed.push("child");
        });
        return {};
      }
    }

    let ownedChild: ChildResourceTask | undefined;

    class ParentTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "ParentOwnTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
        // Just adopt — don't run it. We want to inspect the stamped runConfig.
        ownedChild = ctx.own(new ChildResourceTask({ id: "child" }));
        return {};
      }
    }

    const parent = new ParentTask({ id: "parent" });
    await parent.run();

    // Parent's auto-scope was disposed in `finally`. The owned child must NOT
    // hold a reference to that disposed scope — otherwise its next `task.run()`
    // would skip auto-create and silently drop disposers on a cleared Map.
    expect(ownedChild).toBeDefined();
    expect(ownedChild!.runConfig?.resourceScope).toBeUndefined();

    // Running the orphaned child should still work end-to-end: it auto-creates
    // its own fresh scope and disposes it cleanly.
    await ownedChild!.run();
    expect(disposed).toEqual(["child"]);
  });

  it("caller-passed scope IS still propagated through own() (preserves resource sharing)", async () => {
    const disposed: string[] = [];
    const callerScope = new ResourceScope();

    class ChildSharedTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "ChildSharedTaskOwn";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
        ctx.resourceScope?.register("shared:resource", async () => {
          disposed.push("shared");
        });
        return {};
      }
    }

    let ownedChild: ChildSharedTask | undefined;

    class ParentSharedTask extends Task<TaskInput, TaskOutput> {
      static override readonly type = "ParentSharedOwnTask";
      static override inputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      static override outputSchema(): DataPortSchema {
        return { type: "object", properties: {} } as const satisfies DataPortSchema;
      }
      override async execute(_input: TaskInput, ctx: IExecuteContext): Promise<TaskOutput> {
        ownedChild = ctx.own(new ChildSharedTask({ id: "child" }));
        // Run the owned child synchronously inside the parent run. The child
        // pulls `resourceScope` from its (just-stamped) runConfig — so its
        // disposer must land on the caller's scope, not on a per-child
        // auto-scope that would be disposed when the child returns.
        await ownedChild.run();
        return {};
      }
    }

    const parent = new ParentSharedTask({ id: "parent" });
    await parent.run({}, { resourceScope: callerScope });

    // Caller-passed scope IS propagated — owned child's runConfig points at it
    // so that a follow-up `task.run()` on the child shares the same scope and
    // benefits from first-registration-wins / shared-model semantics.
    expect(ownedChild).toBeDefined();
    expect(ownedChild!.runConfig?.resourceScope).toBe(callerScope);
    // The child's disposer landed on the caller's scope, not a per-run scope.
    expect(callerScope.has("shared:resource")).toBe(true);

    // Caller still owns disposal — runner did not dispose at parent's exit.
    expect(disposed).toEqual([]);
    await callerScope.disposeAll();
    expect(disposed).toEqual(["shared"]);
  });
});
