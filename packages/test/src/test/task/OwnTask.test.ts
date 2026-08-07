import type { IExecuteContext, TaskOutput } from "@workglow/task-graph";
import { Task, TaskGraph, Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

import { TaskCreatorTask } from "@workglow/task-graph/test";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";

class SimpleTask extends Task {
  public static override readonly type = "SimpleOwnedTask";
  public static override readonly title = "Simple";

  override async execute(): Promise<TaskOutput> {
    return {};
  }
}

describe("Task own functionality", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  describe("TaskCreatorTask", () => {
    it("should add created tasks to subgraph during execution", async () => {
      const task = new TaskCreatorTask();

      // Initially the subgraph should be empty
      expect(task.hasChildren()).toBe(false);

      // Run the task which will create and own other tasks
      await task.run();

      expect(task.hasChildren()).toBe(true);

      // Should have 3 tasks in subgraph:
      // 1. Direct Task
      // 2. TaskGraph wrapped in GraphAsTask
      // 3. Workflow graph wrapped in GraphAsTask
      expect(task.subGraph.getTasks().length).toBe(3);
    });

    it("should properly wrap TaskGraph and Workflow in GraphAsTask", async () => {
      const task = new TaskCreatorTask();
      await task.run();

      const subTasks = task.subGraph.getTasks();

      // First task should be a direct Task instance
      expect(subTasks[0]).toBeInstanceOf(Task);

      // Second and third tasks should be GraphAsTask instances
      expect(subTasks[1].type).toBe("Own[Graph]");
      expect(subTasks[2].type).toBe("Own[Workflow]");

      // Verify the wrapped graphs have their tasks
      expect(subTasks[1].hasChildren()).toBe(true);
      expect(subTasks[2].hasChildren()).toBe(true);
    });
  });

  describe("own(taskish, config)", () => {
    // A graph/workflow is adapted into a wrapper task the caller never sees, so
    // config is the only way to name one. Without it every owned workflow shares
    // the type name "Own[Workflow]" and progress UIs cannot tell them apart.
    class NamingTask extends Task {
      public static override readonly type = "NamingTask";
      public static override readonly title = "Naming";

      override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
        context.own(new Workflow(), { title: "First pass" });
        context.own(new Workflow(), { title: "Second pass" });
        context.own(new TaskGraph(), { title: "A graph" });
        context.own(new Workflow());
        return {};
      }
    }

    it("titles owned graphs and workflows, keeping the wrapper type intact", async () => {
      const task = new NamingTask();
      await task.run();

      const owned = task.subGraph.getTasks();
      expect(owned.map((t) => t.title)).toEqual([
        "First pass",
        "Second pass",
        "A graph",
        // No title passed — falls back to the wrapper class's static title.
        "Workflow",
      ]);
      // `type` stays the wrapper identity; only the display title varies.
      expect(owned.map((t) => t.type)).toEqual([
        "Own[Workflow]",
        "Own[Workflow]",
        "Own[Graph]",
        "Own[Workflow]",
      ]);
    });
  });

  // `own` is add-only and the subgraph is cleared only between graph runs, so a
  // task owning one child per loop iteration retains them all — and everything
  // each child owned in turn — for the whole of its execute(). `disown` is how a
  // sweep over an unbounded worklist stays flat.
  describe("disown(taskish)", () => {
    class LoopingTask extends Task {
      public static override readonly type = "LoopingTask";
      public static override readonly title = "Looping";

      public peakSubgraphSize = 0;

      override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
        for (let i = 0; i < 5; i++) {
          const wf = context.own(new Workflow(), { title: `Item ${i}` });
          wf.pipe(new SimpleTask());
          await wf.run();
          this.peakSubgraphSize = Math.max(this.peakSubgraphSize, this.subGraph.getTasks().length);
          context.disown(wf);
        }
        return {};
      }
    }

    it("keeps a per-iteration owner flat instead of growing with the worklist", async () => {
      const task = new LoopingTask();
      await task.run();

      // One live child at a time across five iterations, none retained after.
      expect(task.peakSubgraphSize).toBe(1);
      expect(task.subGraph.getTasks()).toHaveLength(0);
    });

    it("resolves a workflow to the wrapper task the subgraph actually holds", async () => {
      class DisownWorkflowTask extends Task {
        public static override readonly type = "DisownWorkflowTask";
        public static override readonly title = "Disown workflow";

        override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
          const kept = context.own(new Workflow(), { title: "Kept" });
          const dropped = context.own(new Workflow(), { title: "Dropped" });
          // `own` hands back the Workflow, never the Own[Workflow] wrapper that
          // was added — so disown has to map between them.
          context.disown(dropped);
          expect(this.subGraph.getTasks().map((t) => t.title)).toEqual(["Kept"]);
          expect(kept).toBeDefined();
          return {};
        }
      }

      const task = new DisownWorkflowTask();
      await task.run();
      expect(task.subGraph.getTasks().map((t) => t.title)).toEqual(["Kept"]);
    });

    // A workflow is adapted into a fresh wrapper on every `own`, so a second
    // `own` used to overwrite the recorded wrapper and strand the first in the
    // subgraph with nothing able to name it for `disown`. Owning a plain ITask
    // twice has always thrown on the duplicate subgraph id; both now do.
    it("rejects owning the same workflow twice without disowning", async () => {
      class DoubleOwnTask extends Task {
        public static override readonly type = "DoubleOwnTask";
        public static override readonly title = "Double own";

        public ownError: unknown;

        override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
          const wf = new Workflow();
          context.own(wf, { title: "First" });
          try {
            context.own(wf, { title: "Second" });
          } catch (err) {
            this.ownError = err;
          }
          return {};
        }
      }

      const task = new DoubleOwnTask();
      await task.run();

      expect(task.ownError).toBeInstanceOf(Error);
      expect(String((task.ownError as Error).message)).toContain("already owned");
      // The first registration is intact — not replaced by an unreachable second.
      expect(task.subGraph.getTasks().map((t) => t.title)).toEqual(["First"]);
    });

    it("allows re-owning the same workflow after disowning it", async () => {
      class ReownTask extends Task {
        public static override readonly type = "ReownTask";
        public static override readonly title = "Reown";

        override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
          const wf = new Workflow();
          for (let i = 0; i < 3; i++) {
            context.own(wf, { title: `Pass ${i}` });
            expect(this.subGraph.getTasks()).toHaveLength(1);
            context.disown(wf);
          }
          return {};
        }
      }

      const task = new ReownTask();
      await task.run();
      expect(task.subGraph.getTasks()).toHaveLength(0);
    });

    // A bare second `run()` does NOT reset the subgraph — only a graph run
    // (`TaskGraphRunner.resetGraph`) or an explicit `regenerateGraph()` does —
    // so the first wrapper is still there and the second `own` is a genuine
    // double-`own`. This is the consistency the rejection buys: before it, a
    // plain ITask threw `NodeAlreadyExistsError` here while a workflow silently
    // reached a two-wrapper subgraph, the second of which nothing could name.
    it("rejects owning across bare re-runs the same way for a task and a workflow", async () => {
      const sharedTask = new SimpleTask();
      const sharedWorkflow = new Workflow();

      const makeOwner = (type: string, owned: () => Parameters<IExecuteContext["own"]>[0]) =>
        class extends Task {
          public static override readonly type = type;
          public static override readonly title = "Bare rerun owner";
          public static override cacheable = false;
          override async execute(
            _input: TaskOutput,
            context: IExecuteContext
          ): Promise<TaskOutput> {
            context.own(owned());
            return {};
          }
        };

      for (const [label, Owner] of [
        ["task", makeOwner("BareRerunOwnsTask", () => sharedTask)],
        ["workflow", makeOwner("BareRerunOwnsWorkflow", () => sharedWorkflow)],
      ] as const) {
        const task = new Owner();
        await task.run();
        expect(task.subGraph.getTasks(), label).toHaveLength(1);

        await expect(task.run(), label).rejects.toThrow();
        // Crucially: still one wrapper, not a silently accumulated second.
        expect(task.subGraph.getTasks(), label).toHaveLength(1);
      }
    });

    // `regenerateGraph()` empties the subgraph between runs without touching the
    // wrapper bookkeeping, so a task that owns a long-lived workflow must not be
    // told on its second run that the workflow is still owned.
    it("re-owns a long-lived workflow across runs after the subgraph is reset", async () => {
      const shared = new Workflow();

      class RerunOwnerTask extends Task {
        public static override readonly type = "RerunOwnerTask";
        public static override readonly title = "Rerun owner";
        public static override cacheable = false;

        override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
          context.own(shared, { title: "Shared" });
          return {};
        }
      }

      const task = new RerunOwnerTask();
      await task.run();
      expect(task.subGraph.getTasks().map((t) => t.title)).toEqual(["Shared"]);

      task.regenerateGraph();
      expect(task.subGraph.getTasks()).toHaveLength(0);

      await task.run();
      expect(task.subGraph.getTasks().map((t) => t.title)).toEqual(["Shared"]);
    });

    // A wrapper can leave the subgraph without going through `disown` — a
    // direct `removeTask`, or the `regenerateGraph()` clear between runs. The
    // record is then stale, and disowning it must not try to remove an id the
    // graph no longer has.
    it("is a no-op when the wrapper was already removed by other means", async () => {
      class ExternalRemovalTask extends Task {
        public static override readonly type = "ExternalRemovalTask";
        public static override readonly title = "External removal";

        public thrown: unknown;

        override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
          const a = context.own(new Workflow(), { title: "A" });
          context.own(new Workflow(), { title: "B" });
          // Drop A's wrapper directly. B's remains, so the subgraph is still
          // non-empty and a `hasChildren()`-only guard would wave this through.
          const wrapperA = this.subGraph.getTasks().find((t) => t.title === "A")!;
          this.subGraph.removeTask(wrapperA.id);
          try {
            context.disown(a);
          } catch (err) {
            this.thrown = err;
          }
          return {};
        }
      }

      const task = new ExternalRemovalTask();
      await task.run();

      expect(task.thrown).toBeUndefined();
      expect(task.subGraph.getTasks().map((t) => t.title)).toEqual(["B"]);
    });

    it("is a no-op for a value this context never owned", async () => {
      class StrayDisownTask extends Task {
        public static override readonly type = "StrayDisownTask";
        public static override readonly title = "Stray disown";

        override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
          context.own(new Workflow(), { title: "Kept" });
          // Never owned here — disowning it must not throw or evict anything.
          context.disown(new Workflow());
          context.disown(new SimpleTask());
          return {};
        }
      }

      const task = new StrayDisownTask();
      await task.run();
      expect(task.subGraph.getTasks().map((t) => t.title)).toEqual(["Kept"]);
    });

    // `Taskish` admits a pipe function, and `ensureTask` wraps one in a task like
    // any other — but the wrapper is nameable only if `own` records it, and a
    // function is not `typeof "object"`.
    it("owns and disowns a pipe function", async () => {
      class FnOwnerTask extends Task {
        public static override readonly type = "FnOwnerTask";
        public static override readonly title = "Fn owner";

        public counts: number[] = [];

        override async execute(_input: TaskOutput, context: IExecuteContext): Promise<TaskOutput> {
          const fn = async (input: TaskOutput): Promise<TaskOutput> => input;
          for (let i = 0; i < 3; i++) {
            context.own(fn as never, { title: `Pass ${i}` });
            this.counts.push(this.subGraph.getTasks().length);
            context.disown(fn as never);
            this.counts.push(this.subGraph.getTasks().length);
          }
          return {};
        }
      }

      const task = new FnOwnerTask();
      await task.run();

      // Never accumulates: one wrapper while owned, none once disowned.
      expect(task.counts).toEqual([1, 0, 1, 0, 1, 0]);
      expect(task.subGraph.getTasks()).toHaveLength(0);
    });
  });

  // A task instance reused for a sequence of jobs needs to be relabelled per job,
  // otherwise a progress UI keeps naming the first one.
  describe("setTitle", () => {
    it("overrides the static title and is re-readable", () => {
      const task = new SimpleTask();
      expect(task.title).toBe("Simple");

      task.setTitle("Extract management");
      expect(task.title).toBe("Extract management");

      task.setTitle("Extract beneficial ownership");
      expect(task.title).toBe("Extract beneficial ownership");
    });
  });
});
