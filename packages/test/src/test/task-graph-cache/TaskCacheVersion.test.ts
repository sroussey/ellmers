/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

describe("Task.getCacheVersion", () => {
  it("returns the static version of the leaf class as a string", () => {
    class TaskA extends Task {
      public static override type = "TaskA";
      public static override version = 3;
    }
    const t = new TaskA();
    expect(t.getCacheVersion()).toBe("3");
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
