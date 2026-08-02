import type { IExecuteContext, TaskOutput } from "@workglow/task-graph";
import { Task, TaskGraph, Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";
import { TaskCreatorTask } from "./TestTasks";

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
