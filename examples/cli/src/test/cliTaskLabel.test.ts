/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITask } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";
import { cliTaskLabel } from "../ui/taskGraphCliSubscriptions";

function makeTask(type: string, title?: string): ITask {
  return { type, title } as unknown as ITask;
}

describe("cliTaskLabel", () => {
  it("prefers the instance title over the class type name", () => {
    expect(cliTaskLabel(makeTask("BootstrapDownloadTask", "Download submissions"))).toBe(
      "Download submissions"
    );
  });

  it("distinguishes two instances of the same task class", () => {
    const a = makeTask("BootstrapDownloadTask", "Download submissions");
    const b = makeTask("BootstrapDownloadTask", "Download facts");
    expect([cliTaskLabel(a), cliTaskLabel(b)]).toEqual(["Download submissions", "Download facts"]);
  });

  it("falls back to the type name when no title is set", () => {
    expect(cliTaskLabel(makeTask("BootstrapDownloadTask"))).toBe("BootstrapDownloadTask");
  });

  it("treats the Task base class's empty-string title as unset", () => {
    expect(cliTaskLabel(makeTask("BootstrapDownloadTask", ""))).toBe("BootstrapDownloadTask");
  });

  it("falls back to Unknown for a task-like object with no type", () => {
    expect(cliTaskLabel({} as ITask)).toBe("Unknown");
  });
});
