/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Task, TaskRegistry } from "@workglow/task-graph";
import type { DataPortSchema } from "@workglow/util/schema";
import { afterEach, describe, expect, it } from "vitest";

// Minimal task classes used only for TaskRegistry registration tests

class TaskA extends Task {
  static override readonly type = "TaskRegistryTestA";
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
}

class TaskB extends Task {
  static override readonly type = "TaskRegistryTestA"; // same type as TaskA — used to test conflict
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  static override outputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
}

// Binary-stream port format checks happen at registration time so a typo
// surfaces near the task definition rather than during a streaming run.

class BinaryPortTypoTask extends Task {
  static override readonly type = "TaskRegistryTest_BinaryFormatTypo";
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "Blob", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
}

class BinaryPortValidBlobTask extends Task {
  static override readonly type = "TaskRegistryTest_BinaryValidBlob";
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "blob", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
}

class BinaryPortValidBinaryTask extends Task {
  static override readonly type = "TaskRegistryTest_BinaryValidBinary";
  static override inputSchema(): DataPortSchema {
    return { type: "object", properties: {}, additionalProperties: false } as const;
  }
  static override outputSchema(): DataPortSchema {
    return {
      type: "object",
      properties: { bytes: { type: "object", format: "binary", "x-stream": "binary" } },
      additionalProperties: false,
    } as const satisfies DataPortSchema;
  }
}

describe("TaskRegistry", () => {
  afterEach(() => {
    // Clean up any registrations made during the test
    TaskRegistry.unregisterTask(TaskA.type);
    TaskRegistry.unregisterTask(BinaryPortTypoTask.type);
    TaskRegistry.unregisterTask(BinaryPortValidBlobTask.type);
    TaskRegistry.unregisterTask(BinaryPortValidBinaryTask.type);
  });

  it("registers a task constructor", () => {
    TaskRegistry.registerTask(TaskA);
    expect(TaskRegistry.all.get(TaskA.type)).toBe(TaskA);
  });

  it("re-registering the same class is idempotent (no throw)", () => {
    TaskRegistry.registerTask(TaskA);
    expect(() => TaskRegistry.registerTask(TaskA)).not.toThrow();
    expect(TaskRegistry.all.get(TaskA.type)).toBe(TaskA);
  });

  it("throws when a different constructor is registered for the same type", () => {
    TaskRegistry.registerTask(TaskA);
    expect(() => TaskRegistry.registerTask(TaskB)).toThrow(
      `Task type "${TaskA.type}" is already registered. Unregister it first to replace.`
    );
  });

  it("allows replacement after unregisterTask()", () => {
    TaskRegistry.registerTask(TaskA);
    const removed = TaskRegistry.unregisterTask(TaskA.type);
    expect(removed).toBe(true);
    expect(() => TaskRegistry.registerTask(TaskB)).not.toThrow();
    expect(TaskRegistry.all.get(TaskA.type)).toBe(TaskB);
    // restore state for afterEach
    TaskRegistry.unregisterTask(TaskA.type);
  });

  it("unregisterTask returns false when the type was not registered", () => {
    expect(TaskRegistry.unregisterTask("NonExistentType")).toBe(false);
  });

  it("throws at registration when a binary port uses a typo format like 'Blob'", () => {
    expect(() => TaskRegistry.registerTask(BinaryPortTypoTask)).toThrow(
      /invalid binary stream port/
    );
    // And the task is NOT in the registry afterwards.
    expect(TaskRegistry.all.get(BinaryPortTypoTask.type)).toBeUndefined();
  });

  it("accepts a binary port with format 'blob'", () => {
    expect(() => TaskRegistry.registerTask(BinaryPortValidBlobTask)).not.toThrow();
    expect(TaskRegistry.all.get(BinaryPortValidBlobTask.type)).toBe(BinaryPortValidBlobTask);
  });

  it("accepts a binary port with format 'binary'", () => {
    expect(() => TaskRegistry.registerTask(BinaryPortValidBinaryTask)).not.toThrow();
    expect(TaskRegistry.all.get(BinaryPortValidBinaryTask.type)).toBe(BinaryPortValidBinaryTask);
  });
});
