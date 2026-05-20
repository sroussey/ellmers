/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, TaskConfigurationError } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { describe, expect, it } from "vitest";

describe("Task.getCacheVersion", () => {
  it("returns the static version of the leaf class as a string", () => {
    class TaskA extends Task {
      public static override type = "TaskA";
      public static override version = 3;
    }
    const t = new TaskA();
    expect(t.getCacheVersion()).toBe("3.1"); // 1 is the base Task.version default
  });

  it("includes ancestor versions when subclasses set version", () => {
    class Base extends Task {
      public static override type = "Base";
      public static override version = 2;
    }
    class Child extends Base {
      public static override type = "Child";
      public static override version = 5;
    }
    const v = new Child().getCacheVersion();
    expect(v).toBe("5.2.1"); // 1 is the base Task.version default
  });

  it("defaults to '1' when no subclass overrides", () => {
    expect(new Task().getCacheVersion()).toBe("1");
  });
});

describe("__cv reserved input port name", () => {
  it("rejects construction of a Task whose inputSchema declares __cv", () => {
    class BadTask extends Task {
      public static override type = "BadCvTask";
      public static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            __cv: { type: "string" },
            other: { type: "string" },
          },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
    }

    expect(() => new BadTask()).toThrow(TaskConfigurationError);
    expect(() => new BadTask()).toThrow(/__cv/);
  });

  it("permits construction when __cv is absent", () => {
    class OkTask extends Task {
      public static override type = "OkCvTask";
      public static override inputSchema(): DataPortSchema {
        return {
          type: "object",
          properties: {
            q: { type: "string" },
          },
          additionalProperties: false,
        } as const satisfies DataPortSchema;
      }
    }

    expect(() => new OkTask()).not.toThrow();
  });
});
