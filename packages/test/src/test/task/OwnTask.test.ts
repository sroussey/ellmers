import type { IExecuteContext, TaskOutput } from "@workglow/task-graph";
import { Task, TaskGraph, Workflow } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

import { setLogger } from "@workglow/util";
import { getTestingLogger } from "../../binding/TestingLogger";
import { TaskCreatorTask } from "./TestTasks";

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
});
