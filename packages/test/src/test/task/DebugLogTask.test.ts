/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskStatus } from "@workglow/task-graph";
import { DebugLogTask } from "@workglow/tasks";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("DebugLogTask", () => {
  const logger = getTestingLogger();
  setLogger(logger);
  let task: DebugLogTask;

  beforeEach(() => {
    task = new DebugLogTask({ id: "debuglog-test" });
    vi.restoreAllMocks();
  });

  it("should have correct static properties", () => {
    expect(DebugLogTask.type).toBe("DebugLogTask");
    expect(DebugLogTask.category).toBe("Utility");
    expect(DebugLogTask.cachePolicy.kind).toBe("none");
    expect(DebugLogTask.passthroughInputsToOutputs).toBe(true);
  });

  it("should pass through input to output", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await task.run({ message: "hello", count: 42 });
    expect(result).toEqual({ message: "hello", count: 42 });
    expect(task.status).toBe(TaskStatus.COMPLETED);
    spy.mockRestore();
  });

  it("should use console.log by default", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await task.run({ data: "test" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should use console.dir when log_level is dir", async () => {
    const dirTask = new DebugLogTask({ id: "debuglog-dir", log_level: "dir" });
    const spy = vi.spyOn(console, "dir").mockImplementation(() => {});
    await dirTask.run({ data: "test" });
    expect(spy).toHaveBeenCalledWith({ data: "test" }, { depth: null });
    spy.mockRestore();
  });

  it("should use console.warn when log_level is warn", async () => {
    const warnTask = new DebugLogTask({ id: "debuglog-warn", log_level: "warn" });
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await warnTask.run({ data: "test" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should use console.error when log_level is error", async () => {
    const errorTask = new DebugLogTask({ id: "debuglog-error", log_level: "error" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await errorTask.run({ data: "test" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should use console.info when log_level is info", async () => {
    const infoTask = new DebugLogTask({ id: "debuglog-info", log_level: "info" });
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    await infoTask.run({ data: "test" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should use console.debug when log_level is debug", async () => {
    const debugTask = new DebugLogTask({ id: "debuglog-debug", log_level: "debug" });
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    await debugTask.run({ data: "test" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
